# 05 — Strapi Mapping

This document describes how the content management design (entities, roles, APIs) maps to **Strapi** and what to add or change compared to the existing **multi-group** backend.

---

## Content type mapping

| Design entity | Strapi mapping |
|---------------|----------------|
| **BusinessUnit** | Reuse or extend **Group** (`api::group.group`). Add or keep: name, param/slug, roleNames. Optionally add relations to Document (owner) and UserBuRole equivalent. |
| **User** | `admin::user` (admin panel) or users-permissions User. Extend with `groups` (manyToMany to Group) for BU membership; roles live in Strapi’s admin roles or a custom UserBuRole content type. |
| **UserBuRole** | Option A: Strapi **admin roles** per BU (e.g. "TFB-Viewer", "TFB-Editor", "TFB-Admin") and assign users to groups + roles. Option B: Custom content type `api::user-bu-role.user-bu-role` (user relation, group relation, role enum). |
| **Document** | Single **Document** content type (recommended) with: ownerBuId → relation to Group, title, content (richtext/JSON), status (draft/published via draftAndPublish), templateId → relation to Template, createdBy. Or keep one collection per BU and add a “unified” API that aggregates (like dynamic-documents). |
| **DocumentShare** | Custom content type: document (relation), targetType (enum: bu \| user), targetId (generic or two optional relations), access (enum: consume \| crud). |
| **DocumentAccess** | Custom content type: document (relation), user (relation), access (enum: view \| edit \| none). |
| **Template** | Custom content type: businessUnit (relation, optional), folder (relation, optional), name, structure (JSON). |
| **Folder** | Custom content type: businessUnit (relation), name, parent (relation to self, optional). |

---

## Strapi roles vs UserBuRole

- **Strapi admin roles** today are global (e.g. Super Admin, Editor). To get **per-BU** roles (viewer, editor, admin), either:
  - **Many admin roles:** Create roles like "TFB-Viewer", "TFB-Editor", "TFB-Admin", "Wholesale-Viewer", … and assign users to groups + these roles; then in policies, resolve “user’s role for this BU” from user.roles and user.groups. This is close to multi-group’s **roleNames** per group.
  - **Custom UserBuRole table:** One content type or DB table (user, group, role) and resolve in a shared service used by all document/list/search APIs.
- **Superadmin:** Strapi’s built-in Super Admin, or a flag on admin user. In API logic, check superadmin first and skip BU/share filtering.
- **Author:** Strapi role "Author" or a flag; allow create for specific/shared BUs via custom create endpoint that sets ownerBuId and DocumentShare from request.

---

## Pointers to multi-group

Relevant parts of the **multi-group** backend:

- **Group** (`api::group.group`): `name`, `param`, `roleNames`, `searchContentTypes`. Use as BusinessUnit; extend with relations if needed (e.g. documents owned by this group).
- **dynamic-documents** (`GET /api/dynamic-documents`): Group-scoped search across multiple content types; uses `getGroupSearchConfigByParam` and `getAdminUserIdsWithRoles`. **Extend** to: (1) resolve accessible document IDs from DocumentShare + DocumentAccess + UserBuRole, (2) run search only within those IDs, (3) support a single Document content type or multiple.
- **restrict-by-group** policy: Currently stubbed. **Restore** per `multi-group/backend/docs/RESTORE_GROUPS.md`: filter findMany/findOne by user’s groups (and optionally by document ownerBuId and DocumentShare). Add **document-level** checks using DocumentShare (targetType=user, targetId) and DocumentAccess (allow/deny).
- **Admin user → groups:** Restore admin user extension with `groups` (manyToMany to Group) so “user’s BUs” are known.

---

## What to add on top of multi-group

| Capability | How to implement in Strapi |
|------------|----------------------------|
| **Document-level sharing** | DocumentShare content type; in document lifecycle or policy: allow access if document shared to user’s BU (with consume/crud) or shared to user (targetType=user). Admins of shared BU get full access; editors get access only if share is crud and optionally DocumentAccess allows. |
| **Document-level access (allow/deny)** | DocumentAccess content type. In access resolution: if DocumentAccess(user, document) exists, use it (view / edit / none); else derive from BU role + DocumentShare. |
| **Author role** | Custom role or flag; custom “create document” route that accepts ownerBuId and initial DocumentShare entries; enforce “can create for this BU or shared” by Author scope. |
| **Superadmin** | Check Strapi super admin or custom isSuperadmin; in list/search/get-one, skip BU and share filters and return all documents. |
| **Unified Document** | Prefer one Document content type with ownerBuId (relation to Group) so list/search APIs are simpler; avoid N content types per BU if you want one dashboard and one search. |
| **List API** | Custom route `GET /api/documents` that: resolves user’s BUs and roles + DocumentShare (to user) + DocumentAccess; builds accessible document IDs; queries Document with filters id in [...], optional status/bu/sort/pagination; returns shape from [03-api-design-and-edge-cases.md](03-api-design-and-edge-cases.md). |
| **Search API** | Same resolution of accessible document IDs; then full-text search (Strapi search or DB-level) restricted to those IDs; paginate. Reuse or replace dynamic-documents controller logic with this model. |

---

## Suggested implementation order in Strapi

1. Add **DocumentShare** and **DocumentAccess** content types (and migrations if needed).
2. Extend **Group** with relation to Document (owner) or add ownerBuId on Document.
3. Restore **admin user → groups** and **restrict-by-group** (or equivalent) so list/find are filtered by user’s BUs and document ownership/share.
4. Implement **access-resolution service**: given (userId, documentId) or (userId) return (canView, canEdit, canDelete, canPublish) and list of accessible document IDs.
5. Add **List** and **Get one** custom routes for documents using that service.
6. Extend **dynamic-documents** (or new search route) to use accessible document IDs and single Document content type.
7. Add **Author** and **Superadmin** handling in create/list/search.
8. Add **Template** and **Folder** content types and wire document creation to templates.

---

## Next

After Strapi mapping is implemented, the system will support:

- Multiple BUs with viewer, editor, admin, author, and superadmin.
- Document sharing across BUs and per-user access/deny.
- List, get-one, and search APIs scoped to the current user’s access.
- Templates and optional folder structure per BU.

For the initial implementation phase (before Strapi), use [01–04](01-entities-and-database.md) to build a simple DB and API layer, then align Strapi with [05-strapi-mapping.md] and this doc.
