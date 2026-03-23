/**
 * Content-manager plugin extension:
 * 1. Filter Document list by BU/role for non-superadmins.
 * 2. Gate mutation actions (create, update, delete, publish, etc.) based on permissions.
 * 3. Auto-set owner BU and strip protected fields for restricted users.
 * 4. Send email notifications to BU admins when an editor performs any operation.
 */

import type { Core } from "@strapi/strapi";
import {
  canShowProtectedDocumentFields,
  getAccessibleDocumentIds,
  getDefaultOwnerBuForCreate,
  getPermissions,
  hasOnlyViewerRole,
  isEditorRestrictedForDocumentMutate,
} from "../../services/access-resolution";
import { notifyBuAdminOnAction } from "../../utils/notifyAdmin";

const DOCUMENT_UID = "api::document.document";

const docApi = (strapi: Core.Strapi) => (uid: string) => (strapi as any).documents(uid);

/**
 * Resolve content-manager param id (Strapi documentId string or numeric id) to document database id.
 * Returns null if document not found.
 */
async function getDocumentDbId(
  strapi: any,
  paramId: string | number
): Promise<number | null> {
  if (paramId == null || paramId === "") return null;
  try {
    const result = await docApi(strapi)(DOCUMENT_UID).findMany({
      filters: { documentId: String(paramId) },
      fields: ["id"],
    } as any);
    
    // Handle both Strapi formats (direct array or { data: [] })
    const results = Array.isArray(result) ? result : (result?.data || []);
    let doc = results[0];

    if (!doc && Number.isFinite(Number(paramId))) {
      const resultByNum = await docApi(strapi)(DOCUMENT_UID).findMany({
        filters: { id: Number(paramId) },
        fields: ["id"],
      } as any);
      const resultsByNum = Array.isArray(resultByNum) ? resultByNum : (resultByNum?.data || []);
      doc = resultsByNum[0];
    }
    return doc?.id != null ? doc.id : null;
  } catch {
    return null;
  }
}

const PROTECTED_FIELDS = ["ownerBu", "template", "documentShares", "documentAccesses", "isPublic"] as const;

function getStrapi(): any {
  return (global as any).strapi;
}

function stripProtectedFields(body: Record<string, unknown>): void {
  for (const key of PROTECTED_FIELDS) {
    delete body[key];
  }
}

function muteProtectedFieldsInMetadatas(metadatas: Record<string, { edit?: { editable?: boolean } }>): void {
  for (const key of PROTECTED_FIELDS) {
    const meta = metadatas[key];
    if (meta) {
      if (!meta.edit) meta.edit = {};
      meta.edit.editable = false;
    }
  }
}

export default (plugin: any) => {
  const coll = plugin.controllers["collection-types"];
  const originalFind = coll.find!;
  const originalCreate = coll.create!;
  const originalUpdate = coll.update!;
  const originalDelete = coll.delete!;
  const originalPublish = coll.publish!;
  const originalUnpublish = coll.unpublish!;
  const originalDiscard = coll.discard!;
  const originalBulkDelete = coll.bulkDelete!;
  const originalBulkPublish = coll.bulkPublish!;
  const originalBulkUnpublish = coll.bulkUnpublish!;
  const originalFindContentTypeConfiguration =
    plugin.controllers["content-types"]?.findContentTypeConfiguration;

  // --- 1. Controller Overrides (BU Filtering & Permission Gating) ---

  plugin.controllers["collection-types"].find = async (ctx: any) => {
    const { model } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) return originalFind(ctx);

    const strapi = getStrapi();
    if (!strapi) return originalFind(ctx);

    const accessibleIds = await getAccessibleDocumentIds(strapi, user.id);
    if (accessibleIds.length === 0) {
      const query = ctx.request?.query ?? {};
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
      ctx.body = { results: [], pagination: { page, pageSize, pageCount: 0, total: 0 } };
      return;
    }

    const query = { ...(ctx.request?.query ?? {}) };
    const existingFilters = query.filters && typeof query.filters === "object" ? query.filters : {};
    query.filters = { $and: [existingFilters, { id: { $in: accessibleIds } }] };
    
    if ((query.status ?? "draft") === "draft" && (await hasOnlyViewerRole(strapi, user.id))) {
      query.status = "published";
    }
    ctx.request.query = query;
    return originalFind(ctx);
  };

  plugin.controllers["collection-types"].create = async (ctx: any) => {
    try {
      const { model } = ctx.params ?? {};
      const user = ctx.state?.user;
      if (model !== DOCUMENT_UID || !user?.id) return originalCreate(ctx);

      const strapi = getStrapi();
      if (!strapi) return originalCreate(ctx);

      const body = ctx.request?.body ?? {};
      const target = body.data || body;
      const restricted = await isEditorRestrictedForDocumentMutate(strapi, user.id);
      if (restricted) stripProtectedFields(target);

      const defaultBu = await getDefaultOwnerBuForCreate(strapi, user.id);
      if (defaultBu) {
        const hasOwnerBu = target.ownerBu != null && target.ownerBu !== '';
        if (restricted || !hasOwnerBu) target.ownerBu = defaultBu.buId;
      }
      ctx.request.body = body;

      return originalCreate(ctx);
    } catch {
      return originalCreate(ctx);
    }
  };

  plugin.controllers["collection-types"].update = async (ctx: any) => {
    try {
      const { model, id } = ctx.params ?? {};
      const user = ctx.state?.user;
      if (model !== DOCUMENT_UID || !user?.id) return originalUpdate(ctx);

      const strapi = getStrapi();
      if (!strapi) return originalUpdate(ctx);

      const dbId = await getDocumentDbId(strapi, id);
      if (dbId != null) {
        const perms = await getPermissions(strapi, user.id, dbId);
        if (!perms.canEdit) {
          ctx.status = 403;
          ctx.body = {
            error: {
              status: 403,
              name: 'ForbiddenError',
              message: 'You do not have permission to edit this document.',
              details: {},
            },
          };
          return;
        }
      }

      const restricted = await isEditorRestrictedForDocumentMutate(strapi, user.id);
      if (restricted) {
        const body = ctx.request?.body ?? {};
        if (body.data) {
          stripProtectedFields(body.data);
        } else {
          stripProtectedFields(body);
        }
        ctx.request.body = body;
      }

      return originalUpdate(ctx);
    } catch {
      return originalUpdate(ctx);
    }
  };

  coll.delete = async (ctx: any) => {
    try {
      const { model, id } = ctx.params ?? {};
      const user = ctx.state?.user;
      if (model !== DOCUMENT_UID || !user?.id) return originalDelete(ctx);

      const strapi = getStrapi();
      if (!strapi) return originalDelete(ctx);

      const dbId = await getDocumentDbId(strapi, id);
      if (dbId != null) {
        const perms = await getPermissions(strapi, user.id, dbId);
        if (!perms.canDelete) {
          ctx.status = 403;
          ctx.body = {
            error: {
              status: 403,
              name: 'ForbiddenError',
              message: 'You do not have permission to delete this document.',
              details: {},
            },
          };
          return;
        }
      }
      return originalDelete(ctx);
    } catch {
      return originalDelete(ctx);
    }
  };

  coll.publish = async (ctx: any) => {
    const { model, id } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) return originalPublish(ctx);

    const strapi = getStrapi();
    if (!strapi) return originalPublish(ctx);

    const dbId = await getDocumentDbId(strapi, id);
    if (dbId != null) {
      const perms = await getPermissions(strapi, user.id, dbId);
      if (!perms.canPublish) {
        ctx.status = 403;
        ctx.body = { error: "You do not have permission to publish this document." };
        return;
      }
    }
    return originalPublish(ctx);
  };

  coll.unpublish = async (ctx: any) => {
    const { model, id } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) return originalUnpublish(ctx);

    const strapi = getStrapi();
    if (!strapi) return originalUnpublish(ctx);

    const dbId = await getDocumentDbId(strapi, id);
    if (dbId != null) {
      const perms = await getPermissions(strapi, user.id, dbId);
      if (!perms.canEdit) {
        ctx.status = 403;
        ctx.body = { error: "You do not have permission to unpublish this document." };
        return;
      }
    }
    return originalUnpublish(ctx);
  };

  coll.discard = async (ctx: any) => {
    const { model, id } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) return originalDiscard(ctx);

    const strapi = getStrapi();
    if (!strapi) return originalDiscard(ctx);

    const dbId = await getDocumentDbId(strapi, id);
    if (dbId != null) {
      const perms = await getPermissions(strapi, user.id, dbId);
      if (!perms.canEdit) {
        ctx.status = 403;
        ctx.body = { error: "You do not have permission to discard draft for this document." };
        return;
      }
    }
    return originalDiscard(ctx);
  };

  // Bulk actions use standard logic from main
  coll.bulkDelete = originalBulkDelete;
  coll.bulkPublish = originalBulkPublish;
  coll.bulkUnpublish = originalBulkUnpublish;

  if (originalFindContentTypeConfiguration) {
    plugin.controllers["content-types"].findContentTypeConfiguration = async (ctx: any) => {
      await originalFindContentTypeConfiguration(ctx);
      const uid = ctx.params?.uid;
      const user = ctx.state?.user;
      if (uid !== DOCUMENT_UID || !user?.id) return;
      const strapi = getStrapi();
      if (!strapi) return;
      const canShow = await canShowProtectedDocumentFields(strapi, user.id);
      if (!canShow) {
        const metadatas = ctx.body?.data?.contentType?.metadatas;
        if (metadatas) muteProtectedFieldsInMetadatas(metadatas);
      }
    };
  }

  // --- 2. Notification Interceptor Middleware (from Worked Version) ---

  async function safeNotify(actionLabel: string, ctx: any, preFetchDoc?: any) {
    try {
      const user = ctx.state?.user;
      if (!user?.id) return;

      let doc = ctx.body?.data || ctx.body;
      if (preFetchDoc && typeof doc === 'object') {
        doc = { ...preFetchDoc, ...doc };
      }

      if (!doc || (!doc.title && !doc.name && !doc.id && !doc.documentId)) return;

      await notifyBuAdminOnAction('document', actionLabel, doc, {
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
      });
    } catch {
      // notification failure should not break the main action
    }
  }

  if (plugin.routes && plugin.routes.admin && plugin.routes.admin.routes) {
    plugin.routes.admin.routes.forEach((route: any) => {
      const actionMap: Record<string, string> = {
        'collection-types.create': 'Created',
        'collection-types.update': 'Updated',
        'collection-types.publish': 'Published',
        'collection-types.unpublish': 'Unpublished',
        'collection-types.discard': 'Discarded',
        'collection-types.delete': 'Deleted',
      };

      const actionLabel = actionMap[route.handler];
      if (actionLabel) {
        route.config = route.config || {};
        route.config.middlewares = route.config.middlewares || [];
        route.config.middlewares.push(async (ctx: any, next: any) => {
          const isDocument = ctx.params?.model === DOCUMENT_UID;
          let preFetchDoc = null;

          if (isDocument && typeof ctx.params?.id !== 'undefined') {
            try {
              const strapi = getStrapi();
              if (strapi) {
                preFetchDoc = await strapi.db.query(DOCUMENT_UID).findOne({
                  where: isNaN(Number(ctx.params.id)) ? { documentId: ctx.params.id } : { id: ctx.params.id }
                });
              }
            } catch (err) {}
          }

          await next();

          if (isDocument && ctx.status >= 200 && ctx.status < 300) {
            await safeNotify(actionLabel, ctx, preFetchDoc);
          }
        });
      }
    });
  }

  return plugin;
};
