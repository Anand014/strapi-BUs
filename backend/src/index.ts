import type { Core } from '@strapi/strapi';

const CM_READ = 'plugin::content-manager.explorer.read';
const DOCUMENT_ACCESS_UID = 'api::document-access.document-access';
const ADMIN_USER_UID = 'admin::user';

/**
 * Grant Content Manager read on admin::user to roles that can read document-access,
 * so they can load users in the Document Access relation picker without 403.
 */
async function ensureAdminUserReadForDocumentAccessRoles(strapi: Core.Strapi) {
  const db = (strapi as any).db;
  if (!db?.query) return;

  try {
    const [readPerms, createPerms] = await Promise.all([
      db.query('admin::permission').findMany({
        where: { action: CM_READ, subject: DOCUMENT_ACCESS_UID },
        populate: ['role'],
      }),
      db.query('admin::permission').findMany({
        where: { action: 'plugin::content-manager.explorer.create', subject: DOCUMENT_ACCESS_UID },
        populate: ['role'],
      }),
    ]);
    const roleIds = new Set<number>();
    for (const p of [...(readPerms || []), ...(createPerms || [])]) {
      const roleId = p.role?.id ?? p.role;
      if (roleId != null) roleIds.add(roleId);
    }
    for (const roleId of roleIds) {
      const existing = await db.query('admin::permission').findMany({
        where: { action: CM_READ, subject: ADMIN_USER_UID, role: { id: roleId } },
      });
      if (existing && existing.length > 0) continue;
      await db.query('admin::permission').create({
        data: {
          action: CM_READ,
          subject: ADMIN_USER_UID,
          role: roleId,
          properties: {},
          conditions: [],
        },
      });
    }
  } catch {
    // ignore
  }
}

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureAdminUserReadForDocumentAccessRoles(strapi);
  },
};
