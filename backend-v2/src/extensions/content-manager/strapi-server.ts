import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';

import { resolveTenantAccess } from '../../services/tenant-access';
import {
  resolveAllowedCategoryIds,
  resolveAllowedNavigationIds,
  resolveAllowedProductIds,
  resolveAllowedSwaggerIds,
} from '../../services/tenant-visible-ids';

const MODEL_UIDS = {
  contentItem: 'api::content-item.content-item',
  contentCategory: 'api::content-category.content-category',
  product: 'api::product.product',
  swagger: 'api::swagger.swagger',
  navigationItem: 'api::navigation-item.navigation-item',
  documentShare: 'api::document-share.document-share',
} as const;

function getStrapi(): Core.Strapi | undefined {
  return (global as unknown as { strapi?: Core.Strapi }).strapi;
}

function relationValueToId(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(value)) {
    return value.length ? relationValueToId(value[0]) : null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id !== 'undefined') return relationValueToId(obj.id);
    if (typeof obj.connect !== 'undefined') {
      const c = obj.connect as unknown;
      if (Array.isArray(c)) return relationValueToId(c[0]);
      if (typeof c === 'object' && c != null)
        return relationValueToId((c as any).id);
    }
    if (typeof obj.set !== 'undefined') return relationValueToId(obj.set);
  }
  return null;
}

function relationValueToIds(value: unknown): number[] {
  if (value == null) return [];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [value] : [];
  }
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? [n] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => relationValueToIds(v));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id !== 'undefined') {
      const id = relationValueToId(obj.id);
      return id != null ? [id] : [];
    }
    if (typeof obj.connect !== 'undefined') return relationValueToIds(obj.connect);
    if (typeof obj.set !== 'undefined') return relationValueToIds(obj.set);
  }
  return [];
}

function getPageAndSize(ctx: any): { page: number; pageSize: number } {
  const query = ctx.request?.query ?? {};
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  return { page, pageSize };
}

async function resolveAllowedIdsForModel(
  strapi: Core.Strapi,
  ctx: Context,
  model: string,
  access: Awaited<ReturnType<typeof resolveTenantAccess>>,
): Promise<number[]> {
  const visible = access.visibleContentItemIds;
  switch (model) {
    case MODEL_UIDS.contentItem:
      return visible;
    case MODEL_UIDS.contentCategory:
      return resolveAllowedCategoryIds(strapi, visible);
    case MODEL_UIDS.navigationItem:
      return resolveAllowedNavigationIds(strapi, visible);
    case MODEL_UIDS.product:
      return resolveAllowedProductIds(strapi, visible);
    case MODEL_UIDS.swagger:
      return resolveAllowedSwaggerIds(strapi, visible);
    case MODEL_UIDS.documentShare: {
      // document-shares are tenant-scoped by their tenant relation.
      // We query the tenant link table so we don't accidentally include shares
      // from other tenants that reference the same content-items.
      const conn = (strapi as any).db.connection('document_shares_tenant_lnk');
      const rows =
        access.tenantId != null
          ? await conn
              .clone()
              .distinct('document_share_id as id')
              .where('tenant_id', access.tenantId)
          : await conn.clone().distinct('document_share_id as id');

      return Array.isArray(rows)
        ? rows
            .map((r: any) => Number(r?.id))
            .filter((n: number) => Number.isFinite(n))
        : [];
    }
    default:
      return [];
  }
}

function normalizeRequestData(ctx: any): Record<string, unknown> {
  const payload = ctx.request?.body as any;
  return (payload?.data ?? payload ?? {}) as Record<string, unknown>;
}

export default (plugin: {
  controllers: Record<string, any>;
}) => {
  const coll = plugin.controllers['collection-types'];
  if (!coll) return plugin;

  const originalFind = coll.find;
  const originalFindOne = coll.findOne;
  const originalCreate = coll.create;
  const originalUpdate = coll.update;
  const originalDelete = coll.delete;

  plugin.controllers['collection-types'].find = async (ctx: any) => {
    const { model } = ctx.params ?? {};
    if (!model || !Object.values(MODEL_UIDS).includes(model)) {
      return originalFind?.(ctx);
    }

    if (!ctx.state?.user?.id) {
      return originalFind?.(ctx);
    }

    const strapi = getStrapi();
    if (!strapi) return originalFind?.(ctx);

    const access = await resolveTenantAccess(strapi, ctx);
    const allowedIds = await resolveAllowedIdsForModel(strapi, ctx, model, access);

    if (!allowedIds.length) {
      const { page, pageSize } = getPageAndSize(ctx);
      ctx.body = {
        results: [],
        pagination: {
          page,
          pageSize,
          pageCount: 0,
          total: 0,
        },
      };
      return;
    }

    const query = { ...(ctx.request?.query ?? {}) };
    const existingFilters =
      query.filters && typeof query.filters === 'object' ? query.filters : {};

    query.filters = {
      $and: [existingFilters, { id: { $in: allowedIds } }],
    };

    ctx.request.query = query;
    return originalFind?.(ctx);
  };

  if (typeof originalFindOne === 'function') {
    plugin.controllers['collection-types'].findOne = async (ctx: any) => {
      const { model, id: idParam } = ctx.params ?? {};
      if (!model || !Object.values(MODEL_UIDS).includes(model)) {
        return originalFindOne?.(ctx);
      }

      const strapi = getStrapi();
      if (!strapi) return originalFindOne?.(ctx);

      if (!ctx.state?.user?.id) return originalFindOne?.(ctx);

      const id = idParam != null ? Number(idParam) : NaN;
      if (!Number.isFinite(id)) return originalFindOne?.(ctx);

      const access = await resolveTenantAccess(strapi, ctx);
      const allowedIds = await resolveAllowedIdsForModel(strapi, ctx, model, access);
      if (!allowedIds.includes(id)) {
        ctx.notFound('Not found');
        return;
      }

      return originalFindOne?.(ctx);
    };
  }

  // Writes: enforce tenant assignment for tenant-scoped models, and block mutations
  // for records outside the tenant-visible set.
  plugin.controllers['collection-types'].create = async (ctx: any) => {
    const { model } = ctx.params ?? {};
    if (!model || !Object.values(MODEL_UIDS).includes(model)) {
      return originalCreate?.(ctx);
    }

    if (!ctx.state?.user?.id) return originalCreate?.(ctx);

    const strapi = getStrapi();
    if (!strapi) return originalCreate?.(ctx);

    const access = await resolveTenantAccess(strapi, ctx);
    const data = normalizeRequestData(ctx);

    if (!access.isSuperAdmin) {
      if (!access.tenantId) {
        ctx.forbidden('Tenant assignment required');
        return;
      }

      if (model === MODEL_UIDS.swagger) {
        // swagger is allowed to be created only if it links to tenant-visible content-items.
        const contentItemIds = relationValueToIds(data.content_items);
        if (!contentItemIds.length) {
          ctx.forbidden('Content items required');
          return;
        }
        const visibleSet = new Set(access.visibleContentItemIds);
        if (!contentItemIds.every((id) => visibleSet.has(id))) {
          ctx.forbidden('Not allowed to link invisible content items');
          return;
        }
      }

      const requestedTenantId = relationValueToId(data.tenant);
      if (requestedTenantId != null && requestedTenantId !== access.tenantId) {
        ctx.forbidden('Tenant cannot be changed');
        return;
      }
      data.tenant = access.tenantId;
    }

    ctx.request.body = { ...(ctx.request?.body ?? {}), data };
    return originalCreate?.(ctx);
  };

  plugin.controllers['collection-types'].update = async (ctx: any) => {
    const { model, id: idParam } = ctx.params ?? {};
    if (!model || !Object.values(MODEL_UIDS).includes(model)) {
      return originalUpdate?.(ctx);
    }

    if (!ctx.state?.user?.id) return originalUpdate?.(ctx);

    const strapi = getStrapi();
    if (!strapi) return originalUpdate?.(ctx);

    const id = idParam != null ? Number(idParam) : NaN;
    if (!Number.isFinite(id)) return originalUpdate?.(ctx);

    const access = await resolveTenantAccess(strapi, ctx);
    const allowedIds = await resolveAllowedIdsForModel(strapi, ctx, model, access);
    if (!allowedIds.includes(id)) {
      ctx.notFound('Not found');
      return;
    }

    const data = normalizeRequestData(ctx);

    if (!access.isSuperAdmin) {
      if (!access.tenantId) {
        ctx.forbidden('Tenant assignment required');
        return;
      }
      const requestedTenantId = relationValueToId(data.tenant);
      if (requestedTenantId != null && requestedTenantId !== access.tenantId) {
        ctx.forbidden('Tenant cannot be changed');
        return;
      }
      data.tenant = access.tenantId;
    }

    ctx.request.body = { ...(ctx.request?.body ?? {}), data };
    return originalUpdate?.(ctx);
  };

  plugin.controllers['collection-types'].delete = async (ctx: any) => {
    const { model, id: idParam } = ctx.params ?? {};
    if (!model || !Object.values(MODEL_UIDS).includes(model)) {
      return originalDelete?.(ctx);
    }

    if (!ctx.state?.user?.id) return originalDelete?.(ctx);

    const strapi = getStrapi();
    if (!strapi) return originalDelete?.(ctx);

    const id = idParam != null ? Number(idParam) : NaN;
    if (!Number.isFinite(id)) return originalDelete?.(ctx);

    const access = await resolveTenantAccess(strapi, ctx);
    const allowedIds = await resolveAllowedIdsForModel(strapi, ctx, model, access);
    if (!allowedIds.includes(id)) {
      ctx.notFound('Not found');
      return;
    }

    return originalDelete?.(ctx);
  };

  // UI: disable editing the `tenant` relation for all non-superadmins.
  // This is required because content-manager otherwise renders a tenant dropdown
  // for any collection type that defines a `tenant` attribute in its schema.
  const contentTypesCtrl = plugin.controllers['content-types'];
  const originalFindContentTypeConfiguration =
    contentTypesCtrl?.findContentTypeConfiguration;
  if (typeof originalFindContentTypeConfiguration === 'function') {
    contentTypesCtrl.findContentTypeConfiguration = async (ctx: any) => {
      await originalFindContentTypeConfiguration(ctx);

      const strapi = getStrapi();
      if (!strapi) return;

      const userId = ctx.state?.user?.id;
      if (!userId) return;

      const access = await resolveTenantAccess(strapi, ctx);
      if (access.isSuperAdmin) return;

      const metadatas = ctx.body?.data?.contentType?.metadatas;
      if (!metadatas || typeof metadatas !== 'object') return;

      const tenantMeta = metadatas.tenant;
      if (!tenantMeta) return;
      if (!tenantMeta.edit) tenantMeta.edit = {};
      tenantMeta.edit.editable = false;

      // Prefill tenant for tenant-scoped users so the UI renders the dropdown
      // with the correct selection on create (backend will also enforce).
      if (access.tenantId != null) {
        // Strapi uses `defaultValue` on field metadata to initialize form state.
        // Keep it duplicated defensively since exact nesting may vary by Strapi version.
        (tenantMeta as any).defaultValue = access.tenantId;
        if ((tenantMeta as any).edit) {
          (tenantMeta as any).edit.defaultValue = access.tenantId;
        }
      }
    };
  }

  return plugin;
};

