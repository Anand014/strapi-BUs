/**
 * Custom document controller: list, findOne with access resolution.
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

/**
 * Resolve numeric document ids to documentIds (strings) for Strapi 5 Document Service.
 * The document service list filters by documentId; filtering by id returns no results.
 */
export async function resolveDocumentIds(
  strapi: Core.Strapi,
  numericIds: number[]
): Promise<string[]> {
  if (numericIds.length === 0) return [];
  const api = docApi(strapi)("api::document.document");
  const result: string[] = [];
  const idSet = new Set(numericIds);
  for (const status of ["published", "draft"] as const) {
    try {
      const docs = await api.findMany({
        status,
        fields: ["id", "documentId"],
        limit: 1000,
      } as any);
      for (const d of docs || []) {
        if (d.id != null && idSet.has(d.id)) {
          if (typeof d.documentId === "string") result.push(d.documentId);
          else result.push(String(d.id));
        }
      }
    } catch {
      // skip
    }
  }
  return [...new Set(result)];
}

export function getUserId(ctx: Context): number | null {
  const user = (ctx.state as any).user;
  if (!user) return null;
  const id = user.id;
  const num = typeof id === "number" ? id : Number(id);
  return Number.isFinite(num) ? num : null;
}

/** Minimal shape for unauthenticated (public) document responses. */
export function formatPublicDocument(doc: any) {
  return {
    id: doc.documentId ?? doc.id,
    title: doc.title,
    content: doc.content,
    status: doc.publishedAt ? "published" : "draft",
    publishedAt: doc.publishedAt ?? null,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  };
}

export async function formatDocumentWithMeta(
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

  /** GET /api/documents/search?q=... - delegates to search controller. */
  async search(ctx: Context) {
    const searchController = (await import("../../search/controllers/search")).default;
    return searchController.search(ctx);
  },

  async find(ctx: Context) {
    const userId = getUserId(ctx);
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

    // Unauthenticated: only published public documents
    if (!userId) {
      const filters: any = { isPublic: true };
      if (buSlug) filters.ownerBu = { slug: buSlug };
      const [sortField, sortOrder] = (
        typeof sort === "string" ? sort : "updatedAt:desc"
      ).split(":");
      const sortObj = {
        [sortField || "updatedAt"]: (sortOrder || "desc").toLowerCase(),
      };
      const allDocs = await docApi(strapi)("api::document.document").findMany({
        filters,
        status: "published",
        sort: sortObj,
        limit: 1000,
      } as any);
      const list = Array.isArray(allDocs) ? allDocs : [];
      const total = list.length;
      const start = (pageNum - 1) * size;
      const paginated = list.slice(start, start + size);
      const data = paginated.map((d) => formatPublicDocument(d));
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
      return;
    }

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

    const documentIds = await resolveDocumentIds(strapi, accessibleIds);
    if (documentIds.length === 0) {
      ctx.body = {
        data: [],
        meta: {
          total: 0,
          pagination: { page: pageNum, pageSize: size, pageCount: 0 },
        },
      };
      return;
    }

    const filters: any = { documentId: { $in: documentIds } };
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
    const docId = ctx.params.documentId ?? ctx.params.id;
    const userId = getUserId(ctx);
    const strapi = (global as any).strapi as Core.Strapi;
    if (!strapi) {
      ctx.throw(503, "Service unavailable");
      return;
    }

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

    // Unauthenticated: only allow published public documents
    if (!userId) {
      if (doc.publishedAt && doc.isPublic === true) {
        ctx.body = { data: formatPublicDocument(doc) };
      } else {
        ctx.unauthorized("Authentication required");
      }
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
};
