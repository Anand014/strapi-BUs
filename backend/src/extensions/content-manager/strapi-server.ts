/**
 * Content-manager plugin extension: filter Document list by BU/role for non-superadmins.
 * When the admin requests the list for api::document.document, only documents
 * the current user can access (getAccessibleDocumentIds) are returned.
 * Editors cannot set ownerBu, template, documentShares, documentAccesses; ownerBu is auto-set on create.
 * Update, delete, publish, unpublish, discard, and bulk actions are gated by getPermissions (read-only for consume-only shares).
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

const DOCUMENT_UID = "api::document.document";

const docApi = (strapi: Core.Strapi) => (uid: string) => (strapi as any).documents(uid);

/**
 * Resolve content-manager param id (Strapi documentId string or numeric id) to document database id.
 * Returns null if document not found.
 */
async function getDocumentDbId(
  strapi: Core.Strapi,
  paramId: string | number
): Promise<number | null> {
  if (paramId == null || paramId === "") return null;
  try {
    const byDocumentId = await docApi(strapi)(DOCUMENT_UID).findMany({
      filters: { documentId: String(paramId) },
      fields: ["id"],
    } as any);
    let doc = Array.isArray(byDocumentId) ? byDocumentId[0] : null;
    if (!doc && Number.isFinite(Number(paramId))) {
      const byNum = await docApi(strapi)(DOCUMENT_UID).findMany({
        filters: { id: Number(paramId) },
        fields: ["id"],
      } as any);
      doc = Array.isArray(byNum) ? byNum[0] : null;
    }
    return doc?.id != null ? doc.id : null;
  } catch {
    return null;
  }
}

const PROTECTED_FIELDS = ["ownerBu", "template", "documentShares", "documentAccesses", "isPublic"] as const;

function getStrapi(): Core.Strapi | undefined {
  return (global as unknown as { strapi?: Core.Strapi }).strapi;
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

export default (plugin: {
  controllers: Record<string, {
    find?: (ctx: unknown) => Promise<void>;
    create?: (ctx: unknown) => Promise<void>;
    update?: (ctx: unknown) => Promise<void>;
    delete?: (ctx: unknown) => Promise<void>;
    publish?: (ctx: unknown) => Promise<void>;
    unpublish?: (ctx: unknown) => Promise<void>;
    discard?: (ctx: unknown) => Promise<void>;
    bulkDelete?: (ctx: unknown) => Promise<void>;
    bulkPublish?: (ctx: unknown) => Promise<void>;
    bulkUnpublish?: (ctx: unknown) => Promise<void>;
    findContentTypeConfiguration?: (ctx: unknown) => Promise<void>;
  }>;
}) => {
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

  plugin.controllers["collection-types"].find = async (ctx: any) => {
    const { model } = ctx.params ?? {};
    const user = ctx.state?.user;

    if (model !== DOCUMENT_UID) {
      return originalFind(ctx);
    }

    if (!user?.id) {
      return originalFind(ctx);
    }

    const strapi = getStrapi();
    if (!strapi) {
      return originalFind(ctx);
    }

    const accessibleIds = await getAccessibleDocumentIds(strapi, user.id);

    if (accessibleIds.length === 0) {
      const query = ctx.request?.query ?? {};
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
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
    const existingFilters = query.filters && typeof query.filters === "object" ? query.filters : {};
    query.filters = {
      $and: [existingFilters, { id: { $in: accessibleIds } }],
    };
    // Viewers only have published entry IDs; the list defaults to draft. Force published so they see docs.
    const requestStatus = query.status ?? "draft";
    if (requestStatus === "draft" && (await hasOnlyViewerRole(strapi, user.id))) {
      query.status = "published";
    }
    ctx.request.query = query;

    return originalFind(ctx);
  };

  plugin.controllers["collection-types"].create = async (ctx: any) => {
    const { model } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) {
      return originalCreate(ctx);
    }
    const strapi = getStrapi();
    if (!strapi) return originalCreate(ctx);

    const body = ctx.request?.body ?? {};
    const restricted = await isEditorRestrictedForDocumentMutate(strapi, user.id);

    if (restricted) {
      stripProtectedFields(body);
    }

    // Auto-set ownerBu on create for any BU user (editor or admin) from their related BU.
    const defaultBu = await getDefaultOwnerBuForCreate(strapi, user.id);
    if (defaultBu) {
      const hasOwnerBu = body.ownerBu != null && body.ownerBu !== '';
      if (restricted || !hasOwnerBu) {
        body.ownerBu = defaultBu.buId;
      }
    }

    ctx.request.body = body;
    return originalCreate(ctx);
  };

  plugin.controllers["collection-types"].update = async (ctx: any) => {
    const { model, id } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) {
      return originalUpdate(ctx);
    }
    const strapi = getStrapi();
    if (!strapi) return originalUpdate(ctx);

    const dbId = await getDocumentDbId(strapi, id);
    if (dbId != null) {
      const perms = await getPermissions(strapi, user.id, dbId);
      if (!perms.canEdit) {
        ctx.status = 403;
        ctx.body = { error: "You do not have permission to edit this document." };
        return;
      }
    }

    const restricted = await isEditorRestrictedForDocumentMutate(strapi, user.id);
    if (restricted) {
      const body = ctx.request?.body ?? {};
      stripProtectedFields(body);
      ctx.request.body = body;
    }
    return originalUpdate(ctx);
  };

  coll.delete = async (ctx: any) => {
    const { model, id } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) {
      return originalDelete(ctx);
    }
    const strapi = getStrapi();
    if (!strapi) return originalDelete(ctx);

    const dbId = await getDocumentDbId(strapi, id);
    if (dbId != null) {
      const perms = await getPermissions(strapi, user.id, dbId);
      if (!perms.canDelete) {
        ctx.status = 403;
        ctx.body = { error: "You do not have permission to delete this document." };
        return;
      }
    }
    return originalDelete(ctx);
  };

  coll.publish = async (ctx: any) => {
    const { model, id } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) {
      return originalPublish(ctx);
    }
    const strapi = getStrapi();
    if (!strapi) return originalPublish(ctx);
    if (id != null && id !== "") {
      const dbId = await getDocumentDbId(strapi, id);
      if (dbId != null) {
        const perms = await getPermissions(strapi, user.id, dbId);
        if (!perms.canPublish) {
          ctx.status = 403;
          ctx.body = { error: "You do not have permission to publish this document." };
          return;
        }
      }
    }
    return originalPublish(ctx);
  };

  coll.unpublish = async (ctx: any) => {
    const { model, id } = ctx.params ?? {};
    const user = ctx.state?.user;
    if (model !== DOCUMENT_UID || !user?.id) {
      return originalUnpublish(ctx);
    }
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
    if (model !== DOCUMENT_UID || !user?.id) {
      return originalDiscard(ctx);
    }
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

  coll.bulkDelete = async (ctx: any) => {
    const { model } = ctx.params ?? {};
    const user = ctx.state?.user;
    const documentIds = ctx.request?.body?.documentIds;
    if (model !== DOCUMENT_UID || !user?.id || !Array.isArray(documentIds) || documentIds.length === 0) {
      return originalBulkDelete(ctx);
    }
    const strapi = getStrapi();
    if (!strapi) return originalBulkDelete(ctx);

    for (const paramId of documentIds) {
      const dbId = await getDocumentDbId(strapi, paramId);
      if (dbId != null) {
        const perms = await getPermissions(strapi, user.id, dbId);
        if (!perms.canDelete) {
          ctx.status = 403;
          ctx.body = { error: "You do not have permission to delete one or more of these documents." };
          return;
        }
      }
    }
    return originalBulkDelete(ctx);
  };

  coll.bulkPublish = async (ctx: any) => {
    const { model } = ctx.params ?? {};
    const user = ctx.state?.user;
    const documentIds = ctx.request?.body?.documentIds;
    if (model !== DOCUMENT_UID || !user?.id || !Array.isArray(documentIds) || documentIds.length === 0) {
      return originalBulkPublish(ctx);
    }
    const strapi = getStrapi();
    if (!strapi) return originalBulkPublish(ctx);

    for (const paramId of documentIds) {
      const dbId = await getDocumentDbId(strapi, paramId);
      if (dbId != null) {
        const perms = await getPermissions(strapi, user.id, dbId);
        if (!perms.canPublish) {
          ctx.status = 403;
          ctx.body = { error: "You do not have permission to publish one or more of these documents." };
          return;
        }
      }
    }
    return originalBulkPublish(ctx);
  };

  coll.bulkUnpublish = async (ctx: any) => {
    const { model } = ctx.params ?? {};
    const user = ctx.state?.user;
    const documentIds = ctx.request?.body?.documentIds;
    if (model !== DOCUMENT_UID || !user?.id || !Array.isArray(documentIds) || documentIds.length === 0) {
      return originalBulkUnpublish(ctx);
    }
    const strapi = getStrapi();
    if (!strapi) return originalBulkUnpublish(ctx);

    for (const paramId of documentIds) {
      const dbId = await getDocumentDbId(strapi, paramId);
      if (dbId != null) {
        const perms = await getPermissions(strapi, user.id, dbId);
        if (!perms.canEdit) {
          ctx.status = 403;
          ctx.body = { error: "You do not have permission to unpublish one or more of these documents." };
          return;
        }
      }
    }
    return originalBulkUnpublish(ctx);
  };

  if (originalFindContentTypeConfiguration) {
    plugin.controllers["content-types"].findContentTypeConfiguration = async (ctx: any) => {
      await originalFindContentTypeConfiguration(ctx);
      const uid = ctx.params?.uid;
      const user = ctx.state?.user;
      if (uid !== DOCUMENT_UID || !user?.id) return;
      const strapi = getStrapi();
      if (!strapi) return;
      const canShow = await canShowProtectedDocumentFields(strapi, user.id);
      if (canShow) return;
      const data = ctx.body?.data;
      const contentType = data?.contentType;
      const metadatas = contentType?.metadatas;
      if (metadatas && typeof metadatas === "object") {
        muteProtectedFieldsInMetadatas(metadatas);
      }
    };
  }

  return plugin;
};
