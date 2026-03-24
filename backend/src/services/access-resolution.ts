/**
 * Access resolution for CM: given a user, compute which documents they can view/edit
 * and their permissions on a specific document. Follows 02-roles-and-permissions.md.
 */

import type { Core } from '@strapi/strapi';

export interface Permissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
}

const docApi = (strapi: Core.Strapi) => (uid: string) => (strapi as any).documents(uid);

/** Check if user has Strapi's built-in Super Admin role (so we treat them as superadmin even without custom isSuperadmin flag). */
async function hasStrapiSuperAdminRole(strapi: Core.Strapi, userRoles: { id: number; code?: string }[]): Promise<boolean> {
  try {
    // 1. Check for the standard Super Admin code directly
    if (userRoles.some(r => r.code === 'strapi-super-admin')) return true;

    // 2. Fallback to Strapi's internal service check
    const roleService = (strapi as any).service?.('admin::role');
    const superAdminRole = roleService && (await roleService.getSuperAdmin?.());
    if (!superAdminRole?.id || !Array.isArray(userRoles)) return false;
    return userRoles.some((r: { id: number }) => r.id === superAdminRole.id);
  } catch {
    return false;
  }
}

const DEBUG_DOCUMENT_ACCESS = process.env.DEBUG_DOCUMENT_ACCESS === '1';

/** Load admin user by id with businessUnits, roles, and flags. Prefers UserBuRole for BU list so API and CM panel agree. */
async function getAdminUser(strapi: Core.Strapi, userId: number) {
  try {
    const u = await (strapi as any).db.query('admin::user').findOne({
      where: { id: userId },
      populate: ['businessUnits', 'roles'],
    });
    if (DEBUG_DOCUMENT_ACCESS) {
      console.warn('[doc-access] getAdminUser findOne', { userId, found: !!u, businessUnitsLength: (u?.businessUnits || []).length });
    }
    if (!u) return null;

    const userBuRoles = await getUserBuRoles(strapi, userId);
    const buIdsFromRoles = userBuRoles.map((r) => r.businessUnitId).filter((id): id is number => id != null);
    const buIdsFromRelation = (u.businessUnits || []).map((bu: any) => bu?.id ?? bu).filter((id: unknown) => id != null && Number.isFinite(Number(id))).map(Number);
    const businessUnitIds = [...new Set([...buIdsFromRoles, ...buIdsFromRelation])];
    if (DEBUG_DOCUMENT_ACCESS) {
      console.warn('[doc-access] getAdminUser BUs', { userId, buIdsFromRoles, buIdsFromRelation, businessUnitIds });
    }

    const isStrapiSuperAdmin = await hasStrapiSuperAdminRole(strapi, u.roles || []);
    const isSuperadmin = !!u.isSuperadmin || isStrapiSuperAdmin;

    return {
      id: u.id,
      isSuperadmin,
      isAuthor: !!u.isAuthor,
      businessUnitIds,
    };
  } catch {
    return null;
  }
}

/** Load UserBuRole entries for a user. Returns [{ businessUnitId, role }]. */
async function getUserBuRoles(strapi: Core.Strapi, userId: number): Promise<{ businessUnitId: number; role: string }[]> {
  try {
    const rows = await (strapi as any).db.query('api::user-bu-role.user-bu-role').findMany({
      where: { user: { id: userId } },
      populate: ['businessUnit'],
    });
    return (rows || []).map((r: any) => ({
      businessUnitId: r.businessUnit?.id,
      role: r.role,
    })).filter((r: { businessUnitId: number }) => r.businessUnitId != null);
  } catch {
    return [];
  }
}

/**
 * Returns true if the user has only viewer role(s) in their BUs (no editor, no admin).
 * Used by the admin list extension so viewers get status=published (they only see published docs).
 */
export async function hasOnlyViewerRole(strapi: Core.Strapi, userId: number): Promise<boolean> {
  const user = await getAdminUser(strapi, userId);
  if (!user || user.isSuperadmin) return false;
  const roles = await getUserBuRoles(strapi, userId);
  if (roles.length === 0) return true;
  return roles.every((r) => r.role === 'viewer');
}

/**
 * Returns true when the user may see and edit protected document fields (ownerBu, template,
 * documentShares, documentAccesses) in the admin. Only superadmin and author get true.
 * Used by the content-manager extension to mute those fields for editors/admins/viewers.
 */
export async function canShowProtectedDocumentFields(
  strapi: Core.Strapi,
  userId: number
): Promise<boolean> {
  const user = await getAdminUser(strapi, userId);
  return !!(user?.isSuperadmin || user?.isAuthor);
}

/**
 * Result for editor default owner BU when creating a document.
 * Used so editors get ownerBu set automatically (e.g. TFB editor → tfb BU).
 */
export interface EditorDefaultOwnerBu {
  buId: number;
  slug: string;
}

/**
 * Returns true if the user should be restricted from setting ownerBu, template,
 * documentShares, documentAccesses on document create/update. Only users whose
 * highest role in their BUs is editor (not admin/superadmin/author) are restricted.
 */
export async function isEditorRestrictedForDocumentMutate(
  strapi: Core.Strapi,
  userId: number
): Promise<boolean> {
  const user = await getAdminUser(strapi, userId);
  if (!user || user.isSuperadmin || user.isAuthor) return false;
  const roles = await getUserBuRoles(strapi, userId);
  const hasAdmin = roles.some((r) => r.role === 'admin');
  const hasEditor = roles.some((r) => r.role === 'editor');
  return !hasAdmin && hasEditor;
}

/**
 * Returns the BU to use as ownerBu when an editor creates a document. Single BU
 * where they have role editor; if multiple, first by business unit id (deterministic).
 * Returns null if not editor-restricted or no editor BU found.
 */
export async function getEditorDefaultOwnerBu(
  strapi: Core.Strapi,
  userId: number
): Promise<EditorDefaultOwnerBu | null> {
  const restricted = await isEditorRestrictedForDocumentMutate(strapi, userId);
  if (!restricted) return null;
  const roles = await getUserBuRoles(strapi, userId);
  const editorBuIds = roles
    .filter((r) => r.role === 'editor' && r.businessUnitId != null)
    .map((r) => r.businessUnitId as number);
  if (editorBuIds.length === 0) return null;
  const buId = editorBuIds.sort((a, b) => a - b)[0];
  return loadBuIdAndSlug(strapi, buId);
}

/**
 * Returns the default owner BU when any non-superadmin user (editor or admin) creates a document.
 * Used so ownerBu is auto-populated on create for "any user from the BU" (e.g. TFB admin → tfb, Wholesale editor → wholesale).
 * Picks first BU by id (deterministic). Returns null for superadmins or users with no BU.
 */
export async function getDefaultOwnerBuForCreate(
  strapi: Core.Strapi,
  userId: number
): Promise<EditorDefaultOwnerBu | null> {
  const user = await getAdminUser(strapi, userId);
  if (!user || user.isSuperadmin) return null;
  const roles = await getUserBuRoles(strapi, userId);
  const buIds = [...new Set(roles.map((r) => r.businessUnitId).filter((id): id is number => id != null))];
  if (buIds.length === 0) return null;
  const buId = buIds.sort((a, b) => a - b)[0];
  return loadBuIdAndSlug(strapi, buId);
}

async function loadBuIdAndSlug(
  strapi: Core.Strapi,
  buId: number
): Promise<EditorDefaultOwnerBu> {
  try {
    const bus = await (strapi as any).db.query('api::business-unit.business-unit').findMany({
      where: { id: buId },
      fields: ['id', 'slug'],
    });
    const bu = Array.isArray(bus) ? bus[0] : null;
    if (!bu?.slug) return { buId, slug: String(buId) };
    return { buId, slug: bu.slug };
  } catch {
    return { buId, slug: String(buId) };
  }
}

/** Load document IDs shared to given BU ids (targetType=bu) or to user (targetType=user). */
async function getSharedDocumentIds(
  strapi: Core.Strapi,
  buIds: number[],
  userId: number
): Promise<Set<number>> {
  const docIds = new Set<number>();
  try {
    const shares = await (strapi as any).db.query('api::document-share.document-share').findMany({
      where: {
        $or: [
          { targetType: 'bu', targetBu: { id: { $in: buIds } } },
          { targetType: 'user', targetUser: { id: userId } },
        ],
      },
      populate: ['document'],
    });
    for (const s of shares || []) {
      if (s.document?.id) docIds.add(s.document.id);
    }
  } catch {
    // ignore
  }
  return docIds;
}

/** Load DocumentAccess for user: documentId -> access (view | edit | none). */
async function getDocumentAccessOverrides(
  strapi: Core.Strapi,
  userId: number
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const rows = await (strapi as any).db.query('api::document-access.document-access').findMany({
      where: { user: { id: userId } },
      populate: ['document'],
    });
    for (const r of rows || []) {
      if (r.document?.id) map.set(r.document.id, r.access);
    }
  } catch {
    // ignore
  }
  return map;
}

/**
 * Get share access for document: 'consume' | 'crud' for BU or user share.
 * When a document is shared to a different BU (targetBu !== document ownerBu), access is forced to 'consume' (view-only).
 */
async function getShareAccessForDocument(
  strapi: Core.Strapi,
  documentId: number,
  buIds: number[],
  userId: number
): Promise<'consume' | 'crud' | null> {
  try {
    const shares = await (strapi as any).db.query('api::document-share.document-share').findMany({
      where: {
        document: { id: documentId },
        $or: [
          { targetType: 'bu', targetBu: { id: { $in: buIds } } },
          { targetType: 'user', targetUser: { id: userId } },
        ],
      },
      populate: ['targetBu'],
    });
    if (!shares?.length) return null;

    let documentOwnerBuId: number | null = null;
    const hasBuShare = (shares as any[]).some((s) => s.targetType === 'bu');
    if (hasBuShare) {
      const docList = await docApi(strapi)('api::document.document').findMany({
        filters: { id: documentId },
        fields: ['id'],
        populate: ['ownerBu'],
      } as any);
      const doc = Array.isArray(docList) ? docList[0] : null;
      documentOwnerBuId = doc?.ownerBu?.id ?? doc?.ownerBu ?? null;
    }

    const effectiveAccess = (s: any): 'consume' | 'crud' => {
      if (s.access === 'crud' && s.targetType === 'bu' && documentOwnerBuId != null) {
        const targetBuId = s.targetBu?.id ?? s.targetBu;
        if (targetBuId != null && targetBuId !== documentOwnerBuId) {
          return 'consume';
        }
      }
      return s.access === 'crud' ? 'crud' : 'consume';
    };

    for (const s of shares || []) {
      if (effectiveAccess(s) === 'crud') return 'crud';
    }
    for (const s of shares || []) {
      if (effectiveAccess(s) === 'consume') return 'consume';
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Returns the set of document IDs (database id) for published documents with isPublic true.
 * Used for unauthenticated controller and for merging into logged-in viewable set.
 */
export async function getPublicPublishedDocumentIds(strapi: Core.Strapi): Promise<number[]> {
  try {
    const docs = await docApi(strapi)('api::document.document').findMany({
      status: 'published',
      filters: { isPublic: true },
      fields: ['id'],
    } as any);
    const ids: number[] = [];
    for (const d of docs || []) {
      if (d.id != null) ids.push(d.id);
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * Returns the set of document IDs (database id) the user can view.
 * Used for list and search filtering.
 */
export async function getAccessibleDocumentIds(strapi: Core.Strapi, userId: number): Promise<number[]> {
  const user = await getAdminUser(strapi, userId);
  if (DEBUG_DOCUMENT_ACCESS) {
    console.warn('[doc-access] getAccessibleDocumentIds', { userId, user: user ? { id: user.id, isSuperadmin: user.isSuperadmin, businessUnitIds: user.businessUnitIds } : null });
  }
  if (!user) return [];

  if (user.isSuperadmin) {
    const docs = await docApi(strapi)('api::document.document').findMany({
      status: 'published',
      fields: ['id'],
    } as any);
    const draftDocs = await docApi(strapi)('api::document.document').findMany({
      status: 'draft',
      fields: ['id'],
    } as any);
    const ids = new Set<number>();
    for (const d of [...(docs || []), ...(draftDocs || [])]) {
      if (d.id != null) ids.add(d.id);
    }
    return Array.from(ids);
  }

  const buIds = user.businessUnitIds;
  const userBuRoles = await getUserBuRoles(strapi, userId);
  const roleByBu = new Map<number, string>();
  for (const r of userBuRoles) {
    roleByBu.set(r.businessUnitId, r.role);
  }
  const sharedDocIds = await getSharedDocumentIds(strapi, buIds, userId);
  const accessOverrides = await getDocumentAccessOverrides(strapi, userId);

  if (DEBUG_DOCUMENT_ACCESS) {
    console.warn('[doc-access] non-superadmin', { userId, buIds, sharedDocIds: sharedDocIds.size, accessOverridesCount: accessOverrides.size });
  }

  const viewableIds = new Set<number>();

  // Documents owned by user's BUs
  for (const buId of buIds) {
    const docs = await docApi(strapi)('api::document.document').findMany({
      filters: { ownerBu: { id: buId } },
      status: 'published',
      fields: ['id'],
    } as any);
    if (DEBUG_DOCUMENT_ACCESS) {
      console.warn('[doc-access] docs for buId', { buId, count: (docs || []).length, docIds: (docs || []).map((d: any) => d.id) });
    }
    for (const d of docs || []) {
      if (d.id != null) viewableIds.add(d.id);
    }
    const draftDocs = await docApi(strapi)('api::document.document').findMany({
      filters: { ownerBu: { id: buId } },
      status: 'draft',
      fields: ['id'],
    } as any);
    for (const d of draftDocs || []) {
      const role = roleByBu.get(buId);
      if (role === 'admin' || role === 'editor') viewableIds.add(d.id);
    }
  }

  // Documents shared to user's BUs or to user (also targetType=user when buIds is empty)
  for (const docId of sharedDocIds) {
    const override = accessOverrides.get(docId);
    if (override === 'none') continue;
    viewableIds.add(docId);
  }

  // Documents with explicit DocumentAccess view or edit (and not none).
  // Users with no BU see only these + shared-to-user docs above.
  for (const [docId, access] of accessOverrides) {
    if (access === 'view' || access === 'edit') viewableIds.add(docId);
  }

  // Remove explicit none
  for (const [docId, access] of accessOverrides) {
    if (access === 'none') viewableIds.delete(docId);
  }

  // Published public documents are viewable by everyone
  const publicIds = await getPublicPublishedDocumentIds(strapi);
  for (const id of publicIds) viewableIds.add(id);

  return Array.from(viewableIds);
}

/**
 * Returns permissions for a user on a document. 404/403 handling is done by the route.
 */
export async function getPermissions(
  strapi: Core.Strapi,
  userId: number,
  documentId: number
): Promise<Permissions> {
  const out: Permissions = { canView: false, canEdit: false, canDelete: false, canPublish: false };

  const user = await getAdminUser(strapi, userId);
  if (!user) return out;

  if (user.isSuperadmin) {
    return { canView: true, canEdit: true, canDelete: true, canPublish: true };
  }

  const buIds = user.businessUnitIds;
  const userBuRoles = await getUserBuRoles(strapi, userId);
  const roleByBu = new Map<number, string>();
  for (const r of userBuRoles) {
    roleByBu.set(r.businessUnitId, r.role);
  }
  const override = (await getDocumentAccessOverrides(strapi, userId)).get(documentId);
  const shareAccess = await getShareAccessForDocument(strapi, documentId, buIds, userId);

  if (override === 'none') return out;

  let doc: any = null;
  try {
    const list = await docApi(strapi)('api::document.document').findMany({
      filters: { id: documentId },
      status: 'published',
      populate: ['ownerBu'],
    } as any);
    doc = Array.isArray(list) ? list[0] : (list?.data?.[0] || null);
    if (!doc) {
      const draftList = await docApi(strapi)('api::document.document').findMany({
        filters: { id: documentId },
        status: 'draft',
        populate: ['ownerBu'],
      } as any);
      doc = Array.isArray(draftList) ? draftList[0] : (draftList?.data?.[0] || null);
    }
  } catch {
    return out;
  }
  if (!doc) return out;

  // Published public documents are viewable by everyone
  if (doc.isPublic === true && doc.publishedAt) {
    out.canView = true;
  }

  const ownerBuId = doc.ownerBu?.id ?? doc.ownerBu;
  const role = ownerBuId != null ? roleByBu.get(ownerBuId) : null;
  const isOwnerBu = ownerBuId != null && buIds.includes(ownerBuId);
  const hasShareCrud = shareAccess === 'crud';
  const hasShareConsume = shareAccess === 'consume' || hasShareCrud;
  const isSharedToUser = shareAccess != null;

  if (override === 'view') {
    out.canView = true;
    return out;
  }
  if (override === 'edit') {
    out.canView = true;
    out.canEdit = true;
    return out;
  }

  if (isOwnerBu) {
    if (role === 'viewer') {
      out.canView = true;
      return out;
    }
    if (role === 'editor') {
      out.canView = true;
      out.canEdit = true;
      return out;
    }
    if (role === 'admin') {
      out.canView = true;
      out.canEdit = true;
      out.canDelete = true;
      out.canPublish = true;
      return out;
    }
  }

  if (isSharedToUser) {
    if (hasShareConsume) out.canView = true;
    if (hasShareCrud) {
      if (role === 'admin') {
        out.canEdit = true;
        out.canDelete = true;
        out.canPublish = true;
      } else if (role === 'editor') {
        out.canEdit = true;
      } else if (buIds.some((id) => roleByBu.get(id) === 'admin' || roleByBu.get(id) === 'editor')) {
        const sharedBuRole = userBuRoles.find((r) => buIds.includes(r.businessUnitId));
        if (sharedBuRole?.role === 'admin') {
          out.canEdit = true;
          out.canDelete = true;
          out.canPublish = true;
        } else if (sharedBuRole?.role === 'editor') {
          out.canEdit = true;
        }
      }
    }
  }

  return out;
}
