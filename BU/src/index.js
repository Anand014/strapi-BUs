'use strict';

const SUPER_ADMIN_CODE = 'strapi-super-admin';
const ADMIN_USERS_TABLE = 'admin_users';
const BU_ID_COLUMN = 'bu_id';

function isSuperAdmin(roles) {
  return Array.isArray(roles) && roles.some((r) => r.code === SUPER_ADMIN_CODE);
}

function parseBuId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

module.exports = {
  register({ strapi }) {
    // 1. Schema: add `bu` relation to admin::user
    const adminUserCT = strapi.get('content-types').get('admin::user');
    if (adminUserCT?.schema?.attributes && !adminUserCT.schema.attributes.bu) {
      adminUserCT.schema.attributes.bu = {
        type: 'relation',
        relation: 'manyToOne',
        target: 'api::bu.bu',
      };
    }

    // 2. Controller: extend admin::user with BU create + custom endpoints
    try {
      strapi.get('controllers').extend('admin::user', (ctrl) => {
        const originalCreate = ctrl.create.bind(ctrl);

        return {
          ...ctrl,

          async create(ctx) {
            const body = ctx.request?.body || {};
            const buRaw = body.bu;
            if (
              typeof body === 'object' &&
              body !== null &&
              Object.prototype.hasOwnProperty.call(body, 'bu')
            ) {
              const { bu: _bu, ...rest } = body;
              ctx.request.body = rest;
            }
            await originalCreate(ctx);
            const buId = parseBuId(buRaw);
            if (buId === null) return;
            const createdId = ctx.body?.data?.id;
            if (!createdId) return;
            await strapi.db
              .connection(ADMIN_USERS_TABLE)
              .where('id', createdId)
              .update({ [BU_ID_COLUMN]: buId });
          },

          async getBuOptions(ctx) {
            try {
              const rows = await strapi.db
                .query('api::bu.bu')
                .findMany({ orderBy: { name: 'asc' } });
              const seen = new Set();
              const unique = (rows || []).filter((d) => {
                const key = d.documentId ?? d.id;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              ctx.body = {
                data: unique.map((d) => ({ id: d.id, name: d.name ?? '' })),
              };
            } catch (err) {
              ctx.body = { data: [] };
            }
          },

          async getBuUsersInfo(ctx) {
            try {
              const rawUsers = await strapi.db
                .connection(ADMIN_USERS_TABLE)
                .select('id', BU_ID_COLUMN);
              const buMap = new Map(
                (rawUsers || []).map((r) => [
                  Number(r.id),
                  r[BU_ID_COLUMN] != null ? Number(r[BU_ID_COLUMN]) : null,
                ]),
              );
              const users = await strapi.db
                .query('admin::user')
                .findMany({ populate: ['roles'] });
              ctx.body = {
                data: (users || []).map((u) => ({
                  id: u.id,
                  buId: buMap.get(Number(u.id)) ?? (u.bu ? u.bu.id : null),
                  isSuperAdmin: isSuperAdmin(u.roles),
                })),
              };
            } catch (err) {
              strapi.log.error('[BU] getBuUsersInfo failed:', err);
              ctx.body = { data: [] };
            }
          },

          async updateBu(ctx) {
            const { id } = ctx.params;
            const { bu } = ctx.request.body || {};
            const userId = parseInt(id, 10);
            if (Number.isNaN(userId)) return ctx.badRequest('Invalid user ID');

            const targetUser = await strapi.db.query('admin::user').findOne({
              where: { id: userId },
              populate: ['roles'],
            });
            if (!targetUser) return ctx.notFound('User not found');
            if (isSuperAdmin(targetUser.roles)) {
              return ctx.forbidden(
                'Business Unit cannot be assigned to a Super Admin',
              );
            }

            const buId = parseBuId(bu);
            if (bu !== undefined && bu !== null && bu !== '' && buId === null) {
              return ctx.badRequest('Invalid BU ID');
            }

            await strapi.db
              .connection(ADMIN_USERS_TABLE)
              .where('id', userId)
              .update({ [BU_ID_COLUMN]: buId });

            const updated = await strapi.db.query('admin::user').findOne({
              where: { id: userId },
              populate: ['bu'],
            });
            ctx.body = { data: updated };
          },
        };
      });
    } catch (err) {
      strapi.log.error('[BU] Failed to extend controller:', err);
    }

    // 3. Routes
    if (strapi.admin?.routes && !strapi.admin.routes['bu-extension']) {
      strapi.admin.routes['bu-extension'] = {
        type: 'admin',
        routes: [
          {
            method: 'GET',
            path: '/bu-options',
            handler: 'user.getBuOptions',
            config: { policies: ['admin::isAuthenticatedAdmin'] },
          },
          {
            method: 'GET',
            path: '/bu-users-info',
            handler: 'user.getBuUsersInfo',
            config: { policies: ['admin::isAuthenticatedAdmin'] },
          },
          {
            method: 'PUT',
            path: '/users/:id/bu',
            handler: 'user.updateBu',
            config: { policies: ['admin::isAuthenticatedAdmin'] },
          },
        ],
      };
    }
  },

  async bootstrap({ strapi }) {
    const hasTable =
      await strapi.db.connection.schema.hasTable(ADMIN_USERS_TABLE);
    if (!hasTable) return;
    const hasColumn = await strapi.db.connection.schema.hasColumn(
      ADMIN_USERS_TABLE,
      BU_ID_COLUMN,
    );
    if (hasColumn) return;
    strapi.log.info(
      '[BU] Adding column %s.%s',
      ADMIN_USERS_TABLE,
      BU_ID_COLUMN,
    );
    await strapi.db.connection.schema.alterTable(ADMIN_USERS_TABLE, (table) => {
      table.integer(BU_ID_COLUMN).nullable();
    });
  },
};
