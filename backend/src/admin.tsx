const SUPER_ADMIN_CODE = "strapi-super-admin";
const ADMIN_USERS_TABLE = "admin_users";
const BU_ID_COLUMN = "bu_id";
const BU_UID = "api::business-unit.business-unit";

const BU_DEBUG = process.env.BU_DEBUG === "1" || process.env.BU_DEBUG === "true";

interface RoleLike {
  code?: string;
}

function buLogInfo(strapi: Strapi, msg: string, meta?: Record<string, unknown>): void {
  if (!BU_DEBUG) return;
  strapi.log.info(
    meta ? `[BU] ${msg} ${JSON.stringify(meta)}` : `[BU] ${msg}`,
  );
}

function isSuperAdmin(roles: RoleLike[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((r) => r.code === SUPER_ADMIN_CODE);
}

function parseBuId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

interface StrapiRegisterContext {
  strapi: Strapi;
}

interface StrapiBootstrapContext {
  strapi: Strapi;
}

interface Strapi {
  get: (key: string) => { get: (name: string) => ContentTypeLike | undefined; extend: (name: string, fn: (ctrl: AdminUserController) => AdminUserController) => void };
  db: StrapiDb;
  admin?: { routes?: Record<string, AdminRouteGroup> };
  log: { info: (msg: string, ...args: unknown[]) => void; error: (msg: string, err?: unknown) => void };
}

interface ContentTypeLike {
  schema?: { attributes?: Record<string, unknown> };
}

interface AdminUserController {
  create: (ctx: KoaContext) => Promise<void>;
  [key: string]: ((ctx: KoaContext) => Promise<unknown>) | unknown;
}

interface KoaContext {
  request?: { body?: Record<string, unknown> };
  body?: unknown;
  params?: { id?: string };
  badRequest: (msg: string) => unknown;
  notFound: (msg: string) => unknown;
  forbidden: (msg: string) => unknown;
}

type StrapiDbConnection = ((table: string) => {
  where: (col: string, value: number) => {
    update: (data: Record<string, number | null>) => Promise<void>;
  };
  select: (...cols: string[]) => Promise<Record<string, unknown>[]>;
}) & {
  schema: {
    hasTable: (name: string) => Promise<boolean>;
    hasColumn: (table: string, col: string) => Promise<boolean>;
    alterTable: (table: string, fn: (table: KnexTableBuilder) => void) => Promise<void>;
  };
};

interface KnexTableBuilder {
  integer: (name: string) => { nullable: () => void };
}

interface StrapiDb {
  connection: StrapiDbConnection;
  query: (uid: string) => {
    findMany: (opts: { orderBy?: { name: string }; populate?: string[] }) => Promise<BuRecord[] | AdminUserRecord[]>;
    findOne: (opts: { where: { id: number }; populate: string[] }) => Promise<AdminUserRecord | null>;
  };
}

interface AdminRouteGroup {
  type: string;
  routes: Array<{ method: string; path: string; handler: string; config: { policies: string[] } }>;
}

interface BuRecord {
  id: number;
  documentId?: string;
  name?: string;
}

interface AdminUserRecord {
  id: number;
  bu?: { id: number } | null;
  roles?: RoleLike[];
}

export default {
  register({ strapi }: StrapiRegisterContext): void {
    const db = strapi.db;
    buLogInfo(strapi, "register", {
      debug: BU_DEBUG,
      table: ADMIN_USERS_TABLE,
      column: BU_ID_COLUMN,
    });
    // 1. Schema: add bu relation to admin::user
    const adminUserCT = strapi.get("content-types").get("admin::user");
    if (adminUserCT?.schema?.attributes && !(adminUserCT.schema.attributes as Record<string, unknown>).bu) {
      (adminUserCT.schema.attributes as Record<string, unknown>).bu = {
        type: "relation",
        relation: "manyToOne",
        target: BU_UID,
      };
    }

    // 2. Controller: extend admin::user with BU create + custom endpoints
    try {
      strapi.get("controllers").extend("admin::user", (ctrl: AdminUserController) => {
        const originalCreate = ctrl.create.bind(ctrl);

        return {
          ...ctrl,

          async create(ctx: KoaContext): Promise<void> {
            const body = (ctx.request?.body || {}) as Record<string, unknown>;
            const buRaw = body.bu;
            if (
              typeof body === "object" &&
              body !== null &&
              Object.prototype.hasOwnProperty.call(body, "bu")
            ) {
              const { bu: _bu, ...rest } = body;
              ctx.request!.body = rest;
            }
            await originalCreate(ctx);
            const buId = parseBuId(buRaw);
            if (buId === null) return;
            const createdId = (ctx.body as { data?: { id?: number } })?.data?.id;
            if (!createdId) return;
            await db
              .connection(ADMIN_USERS_TABLE)
              .where("id", createdId)
              .update({ [BU_ID_COLUMN]: buId });
          },

          async getBuOptions(ctx: KoaContext): Promise<void> {
            try {
              buLogInfo(strapi, "GET /admin/bu-options hit");
              const rows = await strapi.db
                .query(BU_UID)
                .findMany({ orderBy: { name: "asc" } }) as BuRecord[];
              const seen = new Set<string | number>();
              const unique = (rows || []).filter((d) => {
                const key = d.documentId ?? d.id;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              ctx.body = {
                data: unique.map((d) => ({ id: d.id, name: d.name ?? "" })),
              };
              buLogInfo(strapi, "GET /admin/bu-options ok", {
                count: Array.isArray((ctx.body as { data?: unknown[] })?.data)
                  ? ((ctx.body as { data?: unknown[] }).data as unknown[]).length
                  : 0,
              });
            } catch (err) {
              strapi.log.error("[BU] getBuOptions failed:", err);
              ctx.body = { data: [] };
            }
          },

          async getBuUsersInfo(ctx: KoaContext): Promise<void> {
            try {
              buLogInfo(strapi, "GET /admin/bu-users-info hit");
              const rawUsers = await db
                .connection(ADMIN_USERS_TABLE)
                .select("id", BU_ID_COLUMN);
              const buMap = new Map<number, number | null>(
                (rawUsers || []).map((r) => [
                  Number(r.id),
                  r[BU_ID_COLUMN] != null ? Number(r[BU_ID_COLUMN]) : null,
                ]),
              );
              const users = await strapi.db
                .query("admin::user")
                .findMany({ populate: ["roles"] }) as AdminUserRecord[];
              ctx.body = {
                data: (users || []).map((u) => ({
                  id: u.id,
                  buId: buMap.get(Number(u.id)) ?? (u.bu ? u.bu.id : null),
                  isSuperAdmin: isSuperAdmin(u.roles),
                })),
              };
              buLogInfo(strapi, "GET /admin/bu-users-info ok", {
                count: Array.isArray((ctx.body as { data?: unknown[] })?.data)
                  ? ((ctx.body as { data?: unknown[] }).data as unknown[]).length
                  : 0,
              });
            } catch (err) {
              strapi.log.error("[BU] getBuUsersInfo failed:", err);
              ctx.body = { data: [] };
            }
          },

          async updateBu(ctx: KoaContext): Promise<unknown> {
            const { id } = ctx.params || {};
            const { bu } = (ctx.request?.body || {}) as { bu?: unknown };
            const userId = parseInt(String(id), 10);
            if (Number.isNaN(userId)) return ctx.badRequest("Invalid user ID");

            const targetUser = await strapi.db.query("admin::user").findOne({
              where: { id: userId },
              populate: ["roles"],
            }) as AdminUserRecord | null;
            if (!targetUser) return ctx.notFound("User not found");
            if (isSuperAdmin(targetUser.roles)) {
              return ctx.forbidden(
                "Business Unit cannot be assigned to a Super Admin",
              );
            }

            const buId = parseBuId(bu);
            if (bu !== undefined && bu !== null && bu !== "" && buId === null) {
              return ctx.badRequest("Invalid BU ID");
            }

            await db
              .connection(ADMIN_USERS_TABLE)
              .where("id", userId)
              .update({ [BU_ID_COLUMN]: buId });

            const updated = await strapi.db.query("admin::user").findOne({
              where: { id: userId },
              populate: ["bu"],
            });
            ctx.body = { data: updated };
            return ctx.body;
          },
        };
      });
    } catch (err) {
      strapi.log.error("[BU] Failed to extend controller:", err);
    }

    // 3. Routes
    if (strapi.admin?.routes && !strapi.admin.routes["bu-extension"]) {
      strapi.admin.routes["bu-extension"] = {
        type: "admin",
        routes: [
          {
            method: "GET",
            path: "/bu-options",
            handler: "user.getBuOptions",
            config: { policies: ["admin::isAuthenticatedAdmin"] },
          },
          {
            method: "GET",
            path: "/bu-users-info",
            handler: "user.getBuUsersInfo",
            config: { policies: ["admin::isAuthenticatedAdmin"] },
          },
          {
            method: "PUT",
            path: "/users/:id/bu",
            handler: "user.updateBu",
            config: { policies: ["admin::isAuthenticatedAdmin"] },
          },
        ],
      };
    }
  },

  async bootstrap({ strapi }: StrapiBootstrapContext): Promise<void> {
    const db = strapi.db;
    const hasTable =
      await db.connection.schema.hasTable(ADMIN_USERS_TABLE);
    if (!hasTable) return;
    const hasColumn = await db.connection.schema.hasColumn(
      ADMIN_USERS_TABLE,
      BU_ID_COLUMN,
    );
    if (hasColumn) return;
    strapi.log.info(
      "[BU] Adding column %s.%s",
      ADMIN_USERS_TABLE,
      BU_ID_COLUMN,
    );
    await db.connection.schema.alterTable(ADMIN_USERS_TABLE, (table: KnexTableBuilder) => {
      table.integer(BU_ID_COLUMN).nullable();
    });
  },
};
