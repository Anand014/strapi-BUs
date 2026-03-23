import type { Context } from 'koa';

const SUPER_ADMIN_CODE = 'strapi-super-admin';
const ADMIN_USERS_TABLE = 'admin_users';
const TENANTS_TABLE = 'tenants';

const TENANT_ID_COLUMN = 'tenant_id';
const TENANT_KEY_COLUMN = 'tenant_key';

interface AdminUserContext {
  userId: number | null;
  isSuperAdmin: boolean;
  tenantKey: string | null;
}

interface ResolvedTenantAccess {
  userId: number | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  tenantKey: string | null;
  tenantId: number | null;
  includePrivateVisibility: boolean;
  visibleContentItemIds: number[];
}

function normalizeTenantKey(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  return v ? v : null;
}

async function getUserId(strapi: any, ctx: Context): Promise<number | null> {
  // If Strapi auth middleware ran, user will already be in ctx.state.user
  const user = (ctx.state as any).user;
  if (user) {
    const id = user.id;
    const num = typeof id === 'number' ? id : Number(id);
    return Number.isFinite(num) ? num : null;
  }

  // Otherwise, try to decode a Bearer token from the Authorization header.
  const authHeader =
    (ctx.request.header as any).authorization ||
    (ctx.request.header as any).Authorization;
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
  if (!token) return null;

  try {
    const jwtService = (strapi as any).plugin?.('users-permissions')?.service('jwt');
    if (!jwtService?.verify) return null;
    const decoded: any = await jwtService.verify(token);
    const id = decoded?.id ?? decoded?.userId ?? decoded?.sub;
    const num = typeof id === 'number' ? id : Number(id);
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

async function getAdminUserContext(strapi: any, ctx: Context): Promise<AdminUserContext> {
  const userId = await getUserId(strapi, ctx);
  if (!userId) return { userId: null, isSuperAdmin: false, tenantKey: null };

  try {
    // Tenant scoping is based on the `tenant_id` column directly because `populate('tenant')`
    // can be unreliable depending on schema hooks.
    const user = await strapi.db.query('admin::user').findOne({
      where: { id: userId },
      populate: ['roles', 'tenant'],
    });

    const roles: Array<{ code?: string }> = user?.roles || [];
    const isSuperAdmin = Array.isArray(roles) && roles.some((r) => r.code === SUPER_ADMIN_CODE);

    let tenantKey: string | null = user?.tenant?.tenant_key ?? null;
    if (!tenantKey) {
      const rawTenantRows = await strapi.db.connection(ADMIN_USERS_TABLE)
        .where('id', userId)
        .select(TENANT_ID_COLUMN);

      const tenantId = rawTenantRows?.[0]?.[TENANT_ID_COLUMN] ?? null;
      if (tenantId != null) {
        const rawTenant = await strapi.db.connection(TENANTS_TABLE)
          .where('id', tenantId)
          .select(TENANT_KEY_COLUMN);
        const rawTenantKey = rawTenant?.[0]?.[TENANT_KEY_COLUMN] ?? null;
        tenantKey = rawTenantKey != null ? String(rawTenantKey) : null;
      }
    }

    return {
      userId,
      isSuperAdmin,
      tenantKey: tenantKey != null ? String(tenantKey) : null,
    };
  } catch {
    return { userId, isSuperAdmin: false, tenantKey: null };
  }
}

async function resolveTenantIdByKey(strapi: any, tenantKey: string): Promise<number | null> {
  const row = (await strapi.db.connection(TENANTS_TABLE)
    .where(TENANT_KEY_COLUMN, tenantKey)
    .select('id')
    .first()) as { id?: number } | undefined;
  const id = row?.id ?? null;
  return id != null && Number.isFinite(Number(id)) ? Number(id) : null;
}

async function resolveVisibleContentItemIds(
  strapi: any,
  tenantId: number | null,
  includePrivateVisibility: boolean,
): Promise<number[]> {
  // Derive visibility from:
  // - owned content-items (content_items linked to tenant via content_items_tenant_lnk)
  // - shared content-items (document_shares linked to tenant via document_shares_tenant_lnk)
  // - global content-items (content_items with no tenant link row)
  // - any tenant's *published* content-items with visibility public (cross-tenant catalog)
  const visibilityCond = includePrivateVisibility ? null : 'public';

  const contentItemsConn = strapi.db.connection('content_items');

  // Special case:
  // - For authenticated superadmins with no assigned tenant, we treat `tenantId=null`
  //   as "all tenants". This avoids both tenant-assignment errors and empty results.
  if (tenantId == null && includePrivateVisibility) {
    const rows = await contentItemsConn
      .clone()
      .select('id')
      .modify((qb: any) => {
        if (visibilityCond) qb.andWhere('visibility', visibilityCond);
      });

    const ids = Array.isArray(rows)
      ? rows.map((r: any) => Number(r.id)).filter((n: number) => Number.isFinite(n))
      : [];
    return ids;
  }

  // Owned: tenant-linked content items.
  const ownedQuery = contentItemsConn
    .clone()
    .distinct('content_items.id as id')
    .join(
      'content_items_tenant_lnk',
      'content_items.id',
      'content_items_tenant_lnk.content_item_id',
    )
    .where('content_items_tenant_lnk.tenant_id', tenantId);
  if (visibilityCond) ownedQuery.andWhere('content_items.visibility', visibilityCond);

  const ownedRows = tenantId != null ? (await ownedQuery) : [];
  const ownedIds = Array.isArray(ownedRows)
    ? ownedRows
        .map((r: any) => Number(r.id))
        .filter((n: number) => Number.isFinite(n))
    : [];

  // Global: content items with no tenant link row.
  const globalQuery = contentItemsConn
    .clone()
    .distinct('content_items.id as id')
    .leftJoin(
      'content_items_tenant_lnk',
      'content_items.id',
      'content_items_tenant_lnk.content_item_id',
    )
    .whereNull('content_items_tenant_lnk.tenant_id');
  if (visibilityCond) globalQuery.andWhere('content_items.visibility', visibilityCond);

  const globalRows = await globalQuery;
  const globalIds = Array.isArray(globalRows)
    ? globalRows
        .map((r: any) => Number(r.id))
        .filter((n: number) => Number.isFinite(n))
    : [];

  const sharedCandidateIds: number[] = [];
  if (tenantId != null) {
    const sharedDocShareRows = await strapi.db
      .connection('document_shares_tenant_lnk')
      .distinct('document_share_id as id')
      .where('tenant_id', tenantId);

    const sharedDocShareIds = Array.isArray(sharedDocShareRows)
      ? sharedDocShareRows
          .map((r: any) => Number(r.id))
          .filter((n: number) => Number.isFinite(n))
      : [];

    if (sharedDocShareIds.length > 0) {
      const sharedContentItemRows = await strapi.db
        .connection('document_shares_content_item_lnk')
        .distinct('content_item_id as id')
        .whereIn('document_share_id', sharedDocShareIds);

      if (Array.isArray(sharedContentItemRows)) {
        sharedCandidateIds.push(
          ...sharedContentItemRows
            .map((r: any) => Number(r.id))
            .filter((n: number) => Number.isFinite(n)),
        );
      }
    }
  }

  let sharedIds: number[] = sharedCandidateIds;
  if (!includePrivateVisibility && sharedCandidateIds.length > 0) {
    const sharedVisible = (await contentItemsConn
      .clone()
      .select('content_items.id as id')
      .whereIn('content_items.id', Array.from(new Set(sharedCandidateIds)))
      .andWhere('content_items.visibility', 'public')) as Array<{ id: number }>;

    sharedIds = Array.isArray(sharedVisible)
      ? sharedVisible.map((r) => Number(r.id)).filter((n) => Number.isFinite(n))
      : [];
  }

  const merged = new Set<number>();
  for (const id of ownedIds) merged.add(id);
  for (const id of globalIds) merged.add(id);
  for (const id of sharedIds) merged.add(id);

  // Published + public: visible to every tenant and to unauthenticated callers (aligns with draftAndPublish).
  const allPublicPublishedRows = await contentItemsConn
    .clone()
    .select('content_items.id as id')
    .where('content_items.visibility', 'public')
    .whereNotNull('content_items.published_at');

  const allPublicPublishedIds = Array.isArray(allPublicPublishedRows)
    ? allPublicPublishedRows
        .map((r: any) => Number(r.id))
        .filter((n: number) => Number.isFinite(n))
    : [];
  for (const id of allPublicPublishedIds) merged.add(id);

  return Array.from(merged);
}

/**
 * Build tenant scoping context for a request.
 *
 * Rules:
 * - Non-superadmin must have an assigned tenant (derived from admin_users -> tenants).
 * - Superadmin can override tenant using `?tenant=<tenantKey>`, otherwise uses their assigned tenant.
 * - Unauthenticated users can optionally provide `?tenant=<tenantKey>`; otherwise they only see global.
 *
 * Returned `visibleContentItemIds` include owned + shared + global + all *published* items with
 * `visibility='public'` (any tenant). Unauthenticated callers still only receive public visibility
 * in that union; private items remain limited to owned/shared/global rules for authenticated tenants.
 */
export async function resolveTenantAccess(strapi: any, ctx: Context): Promise<ResolvedTenantAccess> {
  const cacheKey = '__tenant_access_resolved';
  if ((ctx.state as any)?.[cacheKey]) return (ctx.state as any)[cacheKey] as ResolvedTenantAccess;

  const adminCtx = await getAdminUserContext(strapi, ctx);
  const isAuthenticated = Boolean(adminCtx.userId);

  const requestedTenantKey = normalizeTenantKey(
    (ctx.query as any)?.tenant_key ?? (ctx.query as any)?.tenant,
  );

  let tenantKey: string | null = null;
  if (isAuthenticated) {
    if (adminCtx.isSuperAdmin) {
      // If the superadmin has no assigned tenant and no `?tenant=` override,
      // allow them to proceed without forcing tenant assignment.
      tenantKey = requestedTenantKey ?? adminCtx.tenantKey ?? null;
    } else {
      tenantKey = adminCtx.tenantKey;
      if (!tenantKey) ctx.forbidden('Tenant assignment required');
    }
  } else {
    tenantKey = requestedTenantKey; // may be null => global-only
  }

  const tenantId = tenantKey ? await resolveTenantIdByKey(strapi, tenantKey) : null;
  if (tenantKey && tenantId == null) {
    // Don't leak tenant existence; treat as forbidden.
    ctx.forbidden('Invalid tenant');
  }

  const includePrivateVisibility = isAuthenticated;

  const visibleContentItemIds = await resolveVisibleContentItemIds(
    strapi,
    tenantId,
    includePrivateVisibility,
  );

  const resolved: ResolvedTenantAccess = {
    userId: adminCtx.userId,
    isAuthenticated,
    isSuperAdmin: adminCtx.isSuperAdmin,
    tenantKey,
    tenantId,
    includePrivateVisibility,
    visibleContentItemIds,
  };

  if ((ctx.state as any)) (ctx.state as any)[cacheKey] = resolved;
  return resolved;
}

