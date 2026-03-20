import type { Core } from '@strapi/strapi';

const CM_READ = 'plugin::content-manager.explorer.read';
const DOCUMENT_ACCESS_UID = 'api::document-access.document-access';
const ADMIN_USER_UID = 'admin::user';
const BU_UID = 'api::business-unit.business-unit';
const ADMIN_USERS_TABLE = 'admin_users';
const BU_ID_COLUMN = 'bu_id';
const SUPER_ADMIN_CODE = 'strapi-super-admin';

function parseBuId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'object' && value !== null && 'id' in value) {
    value = (value as any).id;
  }

  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

function isSuperAdmin(roles: any[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((r) => r.code === SUPER_ADMIN_CODE);
}

/**
 * Grant Content Manager read on admin::user to roles that can read document-access,
 * so they can load users in the Document Access relation picker without 403.
 */
async function ensureAdminUserReadForDocumentAccessRoles(strapi: Core.Strapi) {
  console.log("ensureAdminUserReadForDocumentAccessRoles");
  const ct = strapi.contentType('admin::user');
console.log("ATTRIBUTES:", ct.attributes);
  
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
  register({ strapi }: { strapi: Core.Strapi }) {
    const db = strapi.db;
    console.log("Called.exntension.regster");
    
    // 1. Add businessUnit attribute to admin::user schema (fallback at runtime)
    try {
      const adminUserCT = strapi.get('content-types').get('admin::user');
      console.log("called.extension.adminUserCT", adminUserCT);
      if (adminUserCT?.schema?.attributes) {
        const attrs = adminUserCT.schema.attributes as Record<string, unknown>;
        // if (!attrs.businessUnit) {
        //   attrs.businessUnit = {
        //     type: 'relation',
        //     relation: 'manyToOne',
        //     target: BU_UID,
        //   };
        //   strapi.log.info('[BU] Added businessUnit attribute to admin::user schema');
        // }
      }
    } catch (err: any) {
      strapi.log.warn('[BU] Could not add bu to schema:', err.message);
    }

    // 2. Extend admin::user controller to handle bu field
    try {
      (strapi as any).get('controllers').extend('admin::user', (ctrl: any) => {
        const originalCreate = ctrl.create.bind(ctrl);

        return {
          ...ctrl,
          async create(ctx: any) {
            const body = (ctx.request?.body || {}) as Record<string, unknown>;
            const buRaw = body.businessUnit;
            
            strapi.log.info(`[BU] Creating user. Has businessUnit field: ${!!buRaw}`);

            // Remove businessUnit field before default validation (admin user core may not accept it yet)
            if (
              typeof body === 'object' &&
              body !== null &&
              Object.prototype.hasOwnProperty.call(body, 'businessUnit')
            ) {
              const { businessUnit: _bu, ...rest } = body;
              ctx.request.body = rest;
              strapi.log.info('[BU] Stripped businessUnit field from request');
            }

            // Call original create
            await originalCreate(ctx);

            // Update relation after successful creation
            const buId = parseBuId(buRaw);
            if (buId !== null) {
              const createdId = (ctx.body as any)?.data?.id;
              if (createdId) {
                try {
                  await (strapi.entityService as any).update('admin::user', createdId, {
                    data: {
                      businessUnit: buId,
                    },
                  });
                  strapi.log.info(`[BU] Set businessUnit=${buId} for user ${createdId}`);
                } catch (err: any) {
                  strapi.log.error('[BU] Failed to set businessUnit:', err);
                }
              }
            }
          },
        };
      });
      strapi.log.info('[BU] Admin user controller extended');
    } catch (err: any) {
      strapi.log.error('[BU] Failed to extend admin::user controller:', err);
    }
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureAdminUserReadForDocumentAccessRoles(strapi);
  },
};
