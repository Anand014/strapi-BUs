/**
 * Custom document controller: list, findOne, search with access resolution.
 * Follows 03-api-design-and-edge-cases.md.
 */

import type { Context } from "koa";
import type { Core } from "@strapi/strapi";
import {
  getAccessibleDocumentIds,
  getPermissions,
} from "../../../services/access-resolution";

const docApi = (strapi: Core.Strapi) => (uid: string) =>
  (strapi as any).documents(uid);

function getUserId(ctx: Context): number | null {
  const user = (ctx.state as any).user;
  if (user && typeof user.id === "number") return user.id;
  return null;
}

async function formatDocumentWithMeta(
  strapi: Core.Strapi,
  doc: any,
  userId: number,
) {
  const perms = await getPermissions(strapi, userId, doc.id);
  const ownerBu = doc.ownerBu;
  let sharedTo: any[] = [];
  try {
    const shares = await (strapi as any).db
      .query("api::document-share.document-share")
      .findMany({
        where: { document: { id: doc.id } },
        populate: ["targetBu", "targetUser"],
      });
    sharedTo = (shares || []).map((s: any) => ({
      targetType: s.targetType,
      targetId: s.targetBu?.id ?? s.targetUser?.id,
      access: s.access,
    }));
  } catch {
    // ignore
  }
  return {
    id: doc.documentId ?? doc.id,
    title: doc.title,
    content: doc.content,
    status: doc.publishedAt ? "published" : "draft",
    ownerBu: ownerBu
      ? {
          id: ownerBu.documentId ?? ownerBu.id,
          name: ownerBu.name,
          slug: ownerBu.slug,
        }
      : undefined,
    sharedTo,
    publishedAt: doc.publishedAt ?? null,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    permissions: perms,
  };
}

import { factories } from "@strapi/strapi";

const defaultController = factories.createCoreController(
  "api::document.document",
);

export default {
  ...defaultController,
  async find(ctx: Context) {
    const userId = getUserId(ctx);
    if (!userId) {
      ctx.unauthorized("Authentication required");
      return;
    }
    const strapi = (global as any).strapi as Core.Strapi;
    if (!strapi) {
      ctx.throw(503, "Service unavailable");
      return;
    }

    const {
      bu,
      status,
      page = 1,
      pageSize = 25,
      sort = "updatedAt:desc",
    } = ctx.query || {};
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const buSlug = typeof bu === "string" ? bu.trim().toLowerCase() : "";
    const statusFilter =
      status === "draft" || status === "published" ? status : null;

    const accessibleIds = await getAccessibleDocumentIds(strapi, userId);
    if (accessibleIds.length === 0) {
      ctx.body = {
        data: [],
        meta: {
          total: 0,
          pagination: { page: pageNum, pageSize: size, pageCount: 0 },
        },
      };
      return;
    }

    const filters: any = { id: { $in: accessibleIds } };
    if (buSlug) filters.ownerBu = { slug: buSlug };
    const statusParam =
      statusFilter === "published"
        ? "published"
        : statusFilter === "draft"
          ? "draft"
          : undefined;

    const [sortField, sortOrder] = (
      typeof sort === "string" ? sort : "updatedAt:desc"
    ).split(":");
    const sortObj = {
      [sortField || "updatedAt"]: (sortOrder || "desc").toLowerCase(),
    };

    const allDocs = await docApi(strapi)("api::document.document").findMany({
      filters,
      status: statusParam,
      sort: sortObj,
      populate: ["ownerBu"],
      limit: 1000,
    } as any);
    const list = Array.isArray(allDocs) ? allDocs : [];
    const total = list.length;
    const start = (pageNum - 1) * size;
    const paginated = list.slice(start, start + size);
    const data = await Promise.all(
      paginated.map((d) => formatDocumentWithMeta(strapi, d, userId)),
    );

    ctx.body = {
      data,
      meta: {
        total,
        pagination: {
          page: pageNum,
          pageSize: size,
          pageCount: Math.ceil(total / size) || 1,
        },
      },
    };
  },

  async findOne(ctx: Context) {
    // Support both documentId and id param
    const userId = getUserId(ctx);
    if (!userId) {
      ctx.unauthorized("Authentication required");
      return;
    }
    const strapi = (global as any).strapi as Core.Strapi;
    if (!strapi) {
      ctx.throw(503, "Service unavailable");
      return;
    }

    const docId = ctx.params.documentId ?? ctx.params.id;
    if (!docId) {
      ctx.badRequest("Document ID required");
      return;
    }

    let doc: any = null;
    try {
      const byId = await docApi(strapi)("api::document.document").findMany({
        filters: { documentId: docId },
        populate: ["ownerBu", "template"],
      } as any);
      doc = Array.isArray(byId) ? byId[0] : null;
      if (!doc) {
        const byNum = await docApi(strapi)("api::document.document").findMany({
          filters: { id: Number(docId) },
          populate: ["ownerBu", "template"],
        } as any);
        doc = Array.isArray(byNum) ? byNum[0] : null;
      }
    } catch {
      // ignore
    }
    if (!doc) {
      ctx.notFound("Document not found");
      return;
    }

    const perms = await getPermissions(strapi, userId, doc.id);
    if (!perms.canView) {
      ctx.forbidden("Access denied");
      return;
    }

    const formatted = await formatDocumentWithMeta(strapi, doc, userId);
    ctx.body = { data: formatted };
  },

  async search(ctx: Context) {
    const userId = getUserId(ctx);
    if (!userId) {
      ctx.unauthorized("Authentication required");
      return;
    }
    const strapi = (global as any).strapi as Core.Strapi;
    if (!strapi) {
      ctx.throw(503, "Service unavailable");
      return;
    }

    const {
      q,
      content,
      bu,
      page = 1,
      pageSize = 25,
      sort = "publishedAt:desc",
    } = ctx.query || {};
    const term = (
      typeof q === "string" ? q : typeof content === "string" ? content : ""
    ).trim();
    if (!term) {
      ctx.badRequest("Search term (q or content) required");
      return;
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const buSlug = typeof bu === "string" ? bu.trim().toLowerCase() : "";

    const accessibleIds = await getAccessibleDocumentIds(strapi, userId);
    if (accessibleIds.length === 0) {
      ctx.body = {
        data: [],
        meta: {
          total: 0,
          pagination: { page: pageNum, pageSize: size, pageCount: 0 },
        },
      };
      return;
    }

    const filters: any = {
      id: { $in: accessibleIds },
      $or: [{ title: { $containsi: term } }, { content: { $containsi: term } }],
    };
    if (buSlug) filters.ownerBu = { slug: buSlug };

    const [sortField, sortOrder] = (
      typeof sort === "string" ? sort : "publishedAt:desc"
    ).split(":");
    const sortObj = {
      [sortField || "publishedAt"]: (sortOrder || "desc").toLowerCase(),
    };

    const allDocs = await docApi(strapi)("api::document.document").findMany({
      filters,
      status: "published",
      sort: sortObj,
      populate: ["ownerBu"],
      limit: 1000,
    } as any);
    const list = Array.isArray(allDocs) ? allDocs : [];
    const total = list.length;
    const start = (pageNum - 1) * size;
    const paginated = list.slice(start, start + size);
    const data = await Promise.all(
      paginated.map((d) => formatDocumentWithMeta(strapi, d, userId)),
    );

    ctx.body = {
      data,
      meta: {
        total,
        pagination: {
          page: pageNum,
          pageSize: size,
          pageCount: Math.ceil(total / size) || 1,
        },
      },
    };
  },
};
