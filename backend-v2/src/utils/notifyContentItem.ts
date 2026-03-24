import { contentItemNotificationEmailTemplate } from './contentItemEmailTemplates';

const CONTENT_ITEM_UID = 'api::content-item.content-item';

// Admin role code can be random in Strapi (custom role), so resolve by role name.
const TENANT_EDITOR_ROLE_CODE = 'strapi-editor';
const SUPER_ADMIN_ROLE_CODE = 'strapi-super-admin';

const ADMIN_TO_EDITOR_ACTIONS = ['Published', 'Deleted', 'Discarded'];

async function getActingUserTenantAndRoleCodes(
  actingUserId: number,
): Promise<{
  tenantId: number | null;
  roleCodes: string[];
}> {
  try {
    const user = await (strapi as any).db.query('admin::user').findOne({
      where: { id: actingUserId },
      populate: ['roles', 'tenant'],
    });

    const roleCodes: string[] = Array.isArray(user?.roles)
      ? user.roles.map((r: any) => r?.code).filter((c: any) => typeof c === 'string' && c.length > 0)
      : [];

    // Prefer the relation if present.
    let tenantId: number | null = user?.tenant?.id ?? null;

    // Fallback to raw column (tenant-access service does the same).
    if (tenantId == null) {
      const raw = await (strapi as any).db.connection('admin_users').where('id', actingUserId).first();
      tenantId = raw?.tenant_id != null ? Number(raw.tenant_id) : null;
      tenantId = Number.isFinite(tenantId as number) ? tenantId : null;
    }

    return { tenantId, roleCodes };
  } catch {
    return { tenantId: null, roleCodes: [] };
  }
}

async function findActiveAdminEmailsByTenantAndRole(
  tenantId: number | null,
  roleCodes: string[],
): Promise<string[]> {
  if (tenantId == null) return [];
  if (!Array.isArray(roleCodes) || roleCodes.length === 0) return [];

  try {
    const rows = await (strapi as any).db
      .connection('admin_users')
      .distinct('admin_users.email as email')
      .join(
        'admin_users_roles_lnk',
        'admin_users.id',
        'admin_users_roles_lnk.user_id',
      )
      .join('admin_roles', 'admin_users_roles_lnk.role_id', 'admin_roles.id')
      .where('admin_users.tenant_id', tenantId)
      .andWhere('admin_users.is_active', 1)
      .whereIn('admin_roles.code', roleCodes);

    const emails: string[] = Array.isArray(rows)
      ? rows.map((r: any) => r?.email).filter((e: any) => typeof e === 'string' && e.length > 0)
      : [];

    return [...new Set(emails)];
  } catch {
    return [];
  }
}

async function resolveTenantAdminRoleCodes(): Promise<string[]> {
  try {
    const rows = await (strapi as any).db
      .connection('admin_roles')
      .select('code', 'name');

    const codes = Array.isArray(rows)
      ? rows
          .filter((r: any) => {
            const name = typeof r?.name === 'string' ? r.name.toLowerCase() : '';
            const code = typeof r?.code === 'string' ? r.code : '';
            if (!code) return false;
            // Strict: only Admin role(s), do not include Author.
            return (
              name === 'admin' || code === 'strapi-admin'
            );
          })
          .map((r: any) => String(r.code))
      : [];

    return [...new Set(codes)];
  } catch {
    return ['strapi-admin'];
  }
}

async function resolveItemTenantId(item: any): Promise<number | null> {
  const fromRelation = item?.tenant?.id;
  if (fromRelation != null && Number.isFinite(Number(fromRelation))) {
    return Number(fromRelation);
  }

  const itemId = item?.id;
  if (itemId == null || !Number.isFinite(Number(itemId))) return null;

  try {
    const row = await (strapi as any).db
      .connection('content_items_tenant_lnk')
      .where('content_item_id', Number(itemId))
      .select('tenant_id')
      .first();
    const tenantId = row?.tenant_id;
    return tenantId != null && Number.isFinite(Number(tenantId))
      ? Number(tenantId)
      : null;
  } catch {
    return null;
  }
}

function buildAdminUrl(itemId: number | string): string {
  const baseUrl = process.env.STRAPI_ADMIN_URL || 'http://localhost:1338';
  return `${baseUrl}/admin/content-manager/collection-types/${CONTENT_ITEM_UID}/${itemId}`;
}

export async function notifyContentItemOnAction(
  actionLabel: string,
  item: any,
  actingUser: { id: number; firstname?: string; lastname?: string; email?: string },
) {
  try {
    const itemId = item?.documentId ?? item?.id;
    if (itemId == null) return;

    const title: string =
      item?.title || item?.slug || itemId || 'content-item';

    const actingUserName =
      [actingUser.firstname, actingUser.lastname].filter(Boolean).join(' ') || 'Unknown';
    const actingUserEmail = actingUser.email || 'unknown';

    const { tenantId, roleCodes } = await getActingUserTenantAndRoleCodes(actingUser.id);
    const tenantAdminRoleCodes = await resolveTenantAdminRoleCodes();
    const isSuperAdmin = roleCodes.includes(SUPER_ADMIN_ROLE_CODE);

    // Mirror backend-v1 routing logic:
    // - acting user is tenant-admin and action in Published/Delete/Discard => notify editors
    // - otherwise => notify admins
    const actorIsTenantAdmin =
      roleCodes.some((code) => tenantAdminRoleCodes.includes(code)) ||
      isSuperAdmin;
    const isAdminAction = actorIsTenantAdmin && ADMIN_TO_EDITOR_ACTIONS.includes(actionLabel);

    const targetRoleCodes = isAdminAction
      ? [TENANT_EDITOR_ROLE_CODE]
      : tenantAdminRoleCodes;
    const itemTenantId = await resolveItemTenantId(item);
    const recipientTenantId =
      tenantId != null ? tenantId : (isAdminAction ? itemTenantId : null);

    let recipientEmails = await findActiveAdminEmailsByTenantAndRole(recipientTenantId, targetRoleCodes);

    recipientEmails = recipientEmails.filter((email) => email !== actingUserEmail);

    if (recipientEmails.length === 0) return;

    const roleLabel = isAdminAction ? 'Admin' : 'Editor';

    const defaultFrom = process.env.SMTP_USERNAME || '';
    const senderFrom =
      isAdminAction && actingUserEmail !== 'unknown' && defaultFrom
        ? `"${actingUserName}" <${defaultFrom}>`
        : undefined;
    const senderReplyTo =
      isAdminAction && actingUserEmail !== 'unknown' ? actingUserEmail : undefined;

    const adminUrl = buildAdminUrl(itemId);

    for (const email of recipientEmails) {
      try {
        await (strapi as any).plugin('email').service('email').send({
          to: email,
          ...(senderFrom ? { from: senderFrom } : {}),
          ...(senderReplyTo ? { replyTo: senderReplyTo } : {}),
          subject: `[Notification] Content Item ${actionLabel}: ${title}`,
          html: contentItemNotificationEmailTemplate({
            actionLabel,
            title: String(title),
            adminUrl,
            roleLabel: roleLabel as 'Admin' | 'Editor',
            actingUserName,
            actingUserEmail,
          }),
        });

        (strapi as any)?.log?.info?.(
          `Content-item notification sent: ${email} (${actionLabel})`,
        );
      } catch (err: any) {
        (strapi as any)?.log?.error?.(
          `Failed to send content-item notification to ${email}: ${err?.message || String(err)}`,
        );
      }
    }
  } catch (err: any) {
    (strapi as any)?.log?.error?.(
      `notifyContentItemOnAction failed: ${err?.message || String(err)}`,
    );
  }
}

