const SUPER_ADMIN_CODE = "strapi-super-admin";
const ADMIN_USERS_TABLE = "admin_users";
const TENANT_ID_COLUMN = "tenant_id";
const TENANT_UID = "api::tenant.tenant";

const TENANT_DEBUG =
  process.env.TENANT_DEBUG === "1" || process.env.TENANT_DEBUG === "true";

interface RoleLike {
  code?: string;
}

function tenantLogInfo(
  strapi: any,
  msg: string,
  meta?: Record<string, unknown>,
): void {
  if (!TENANT_DEBUG) return;
  strapi.log.info(meta ? `[TENANT] ${msg} ${JSON.stringify(meta)}` : `[TENANT] ${msg}`);
}

function isSuperAdmin(roles: RoleLike[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((r) => r.code === SUPER_ADMIN_CODE);
}

function parseTenantId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

export default {
  register({ strapi }: { strapi: any }) {
    const db = strapi.db;

    tenantLogInfo(strapi, "register", {
      debug: TENANT_DEBUG,
      table: ADMIN_USERS_TABLE,
      column: TENANT_ID_COLUMN,
    });

    // 1) Schema: add tenant relation to admin::user (for admin UI metadata / populate)
    const adminUserCT = strapi.get("content-types")?.get?.("admin::user");
    if (adminUserCT?.schema?.attributes && !adminUserCT.schema.attributes.tenant) {
      adminUserCT.schema.attributes.tenant = {
        type: "relation",
        relation: "manyToOne",
        target: TENANT_UID,
      };
    }

    // 2) Controller: persist tenant on create + add endpoints
    try {
      strapi.get("controllers").extend("admin::user", (ctrl: any) => {
        const originalCreate = ctrl.create.bind(ctrl);

        return {
          ...ctrl,

          async create(ctx: any): Promise<void> {
            const body = (ctx.request?.body || {}) as Record<string, unknown>;
            const tenantRaw = body.tenant;

            if (
              typeof body === "object" &&
              body !== null &&
              Object.prototype.hasOwnProperty.call(body, "tenant")
            ) {
              const { tenant: _tenant, ...rest } = body;
              ctx.request!.body = rest;
            }

            await originalCreate(ctx);

            const tenantId = parseTenantId(tenantRaw);
            if (tenantId === null) return;

            const createdId = (ctx.body as { data?: { id?: number } })?.data?.id;
            if (!createdId) return;

            await db.connection(ADMIN_USERS_TABLE).where("id", createdId).update({
              [TENANT_ID_COLUMN]: tenantId,
            });
          },

          async getTenantOptions(ctx: any): Promise<void> {
            try {
              tenantLogInfo(strapi, "GET /admin/tenant-options hit");
              const rows = (await strapi.db.query(TENANT_UID).findMany({
                orderBy: { name: "asc" },
              })) as any[];

              ctx.body = {
                data: Array.isArray(rows)
                  ? rows.map((d) => ({ id: d.id, name: d.name ?? "" }))
                  : [],
              };
            } catch (err) {
              strapi.log.error("[TENANT] getTenantOptions failed:", err);
              ctx.body = { data: [] };
            }
          },

          async getTenantUsersInfo(ctx: any): Promise<void> {
            try {
              tenantLogInfo(strapi, "GET /admin/tenant-users-info hit");

              const rawUsers = await db.connection(ADMIN_USERS_TABLE).select(
                "id",
                TENANT_ID_COLUMN,
              );

              const tenantMap = new Map<number, number | null>(
                (rawUsers || []).map((r: any) => [
                  Number(r.id),
                  r[TENANT_ID_COLUMN] != null
                    ? Number(r[TENANT_ID_COLUMN])
                    : null,
                ]),
              );

              const users = (await strapi.db.query("admin::user").findMany({
                populate: ["roles"],
              })) as any[];

              ctx.body = {
                data: (users || []).map((u: any) => ({
                  id: u.id,
                  tenantId:
                    tenantMap.get(Number(u.id)) ??
                    (u.tenant ? u.tenant.id : null),
                  isSuperAdmin: isSuperAdmin(u.roles),
                })),
              };
            } catch (err) {
              strapi.log.error("[TENANT] getTenantUsersInfo failed:", err);
              ctx.body = { data: [] };
            }
          },

          async updateTenant(ctx: any): Promise<unknown> {
            const { id } = ctx.params || {};
            const { tenant } = (ctx.request?.body || {}) as { tenant?: unknown };

            const userId = parseInt(String(id), 10);
            if (Number.isNaN(userId)) return ctx.badRequest("Invalid user ID");

            const targetUser = await strapi.db.query("admin::user").findOne({
              where: { id: userId },
              populate: ["roles"],
            });

            if (!targetUser) return ctx.notFound("User not found");
            if (isSuperAdmin(targetUser.roles)) {
              return ctx.forbidden("Tenant cannot be assigned to a Super Admin");
            }

            const tenantId = parseTenantId(tenant);
            if (
              tenant !== undefined &&
              tenant !== null &&
              tenant !== "" &&
              tenantId === null
            ) {
              return ctx.badRequest("Invalid tenant ID");
            }

            await db.connection(ADMIN_USERS_TABLE).where("id", userId).update({
              [TENANT_ID_COLUMN]: tenantId,
            });

            const updated = await strapi.db.query("admin::user").findOne({
              where: { id: userId },
              populate: ["tenant"],
            });

            ctx.body = { data: updated };
            return ctx.body;
          },
        };
      });
    } catch (err) {
      strapi.log.error("[TENANT] Failed to extend controller:", err);
    }

    // 3) Routes (admin scope)
    if (strapi.admin?.routes && !strapi.admin.routes["tenant-extension"]) {
      strapi.admin.routes["tenant-extension"] = {
        type: "admin",
        routes: [
          {
            method: "GET",
            path: "/tenant-options",
            handler: "user.getTenantOptions",
            config: { policies: ["admin::isAuthenticatedAdmin"] },
          },
          {
            method: "GET",
            path: "/tenant-users-info",
            handler: "user.getTenantUsersInfo",
            config: { policies: ["admin::isAuthenticatedAdmin"] },
          },
          {
            method: "PUT",
            path: "/users/:id/tenant",
            handler: "user.updateTenant",
            config: { policies: ["admin::isAuthenticatedAdmin"] },
          },
        ],
      };
    }
  },

  async bootstrap({ strapi }: { strapi: any }) {
    const db = strapi.db;
    const hasTable = await db.connection.schema.hasTable(ADMIN_USERS_TABLE);
    if (!hasTable) return;

    const hasColumn = await db.connection.schema.hasColumn(
      ADMIN_USERS_TABLE,
      TENANT_ID_COLUMN,
    );
    if (hasColumn) return;

    strapi.log.info(
      "[TENANT] Adding column %s.%s",
      ADMIN_USERS_TABLE,
      TENANT_ID_COLUMN,
    );

    await db.connection.schema.alterTable(
      ADMIN_USERS_TABLE,
      (table: any) => {
        table.integer(TENANT_ID_COLUMN).nullable();
      },
    );
  },
};
