# 03 — API Design and Edge Cases

This document specifies the client-facing APIs for listing documents, getting a single document, and searching—including request/response shapes, status codes, and edge cases.

---

## Authentication and context

All APIs assume an **authenticated user** (e.g. JWT or session). The backend resolves:

- **User id** and **isSuperadmin**
- **User’s BUs and roles** (UserBuRole)
- **Document-level access** (DocumentShare with targetType=user, DocumentAccess)

From that, the backend computes the set of **document IDs the user may access** (view or edit) and uses it to filter list and search, and to allow/deny get-one.

---

## 1. List documents (dashboard)

**Purpose:** Return documents the current user can see: owned by user’s BU(s), shared to user’s BU(s), shared to user, and optionally “visible to all BUs.”

### Request

```
GET /api/documents
GET /api/documents?bu=slug
GET /api/documents?status=published
GET /api/documents?page=1&pageSize=25&sort=updatedAt:desc
```

| Query param | Required | Description |
|-------------|----------|-------------|
| bu | No | Filter by BU slug (e.g. `tfb`). If present, only documents accessible in that BU are returned. If absent, return all documents the user can access (across BUs). |
| status | No | `draft` \| `published`. If absent, return both (subject to role: viewers see only published; editors/admins see drafts they can edit). |
| page | No | Page number; default 1. |
| pageSize | No | Items per page; default 25, max 100. |
| sort | No | Sort field and direction, e.g. `updatedAt:desc`, `publishedAt:desc`. Default: `updatedAt:desc`. |

### Response (200)

```json
{
  "data": [
    {
      "id": "doc-uuid",
      "title": "Document title",
      "status": "draft",
      "ownerBu": { "id": "bu-id", "name": "TFB", "slug": "tfb" },
      "sharedTo": [
        { "targetType": "bu", "targetId": "wholesale-bu-id", "access": "crud" }
      ],
      "publishedAt": null,
      "updatedAt": "2025-02-20T10:00:00.000Z",
      "permissions": { "canView": true, "canEdit": true, "canDelete": false, "canPublish": false }
    }
  ],
  "meta": {
    "total": 42,
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "pageCount": 2
    }
  }
}
```

- **ownerBu:** The owning business unit (so client can show “yours vs shared”).
- **sharedTo:** List of DocumentShare entries for this document (optional; can be omitted or simplified for list view).
- **permissions:** Derived for the current user (canView, canEdit, canDelete, canPublish).

### Status codes

- **200** — Success (data may be empty).
- **401** — Unauthorized (no valid auth).
- **400** — Invalid query (e.g. invalid sort field).

### Edge cases

- **User in multiple BUs:** Aggregate accessible document IDs from all BUs + docs shared to user; then apply filters (bu, status) and sort/paginate.
- **No BU (e.g. author-only):** Only documents shared directly to the user (targetType=user) and, if implemented, “visible to all BUs” docs.
- **Empty result:** Return 200 with `data: []`, `meta.total: 0`, `meta.pagination.pageCount: 0`.
- **Superadmin:** Ignore BU filter for “who can see”; return all documents (optionally still filter by `bu` query for convenience).
- **Draft vs published:** Apply rules from [02-roles-and-permissions.md](02-roles-and-permissions.md): viewers see only published; editors/admins see drafts of docs they can edit.

---

## 2. Get one document (detail)

**Purpose:** Return a single document by id if the user has at least view access; otherwise 403.

### Request

```
GET /api/documents/:id
```

### Response (200)

```json
{
  "data": {
    "id": "doc-uuid",
    "title": "Document title",
    "content": "...",
    "status": "published",
    "ownerBu": { "id": "bu-id", "name": "TFB", "slug": "tfb" },
    "sharedTo": [
      { "targetType": "bu", "targetId": "wholesale-bu-id", "access": "crud" }
    ],
    "templateId": "template-uuid",
    "createdBy": { "id": "user-id", "email": "user@example.com" },
    "publishedAt": "2025-02-18T12:00:00.000Z",
    "updatedAt": "2025-02-20T10:00:00.000Z",
    "permissions": { "canView": true, "canEdit": true, "canDelete": false, "canPublish": false }
  }
}
```

### Status codes

- **200** — Success; user has view access.
- **401** — Unauthorized.
- **403** — Forbidden; document exists but user has no access.
- **404** — Not found; invalid id or document deleted.

### Edge cases

- **Document not found vs no access:** 404 when id is invalid or document is soft-deleted and not visible; 403 when document exists but user has no view permission.
- **Draft:** Return draft only if user has edit access; otherwise 403 for draft documents.

---

## 3. Search documents

**Purpose:** Full-text (or content) search over documents, restricted to documents the user can access.

### Request

```
GET /api/documents/search?q=Pricing
GET /api/documents/search?content=Pricing
GET /api/documents/search?q=Pricing&page=1&pageSize=25&sort=publishedAt:desc
```

| Query param | Required | Description |
|-------------|----------|-------------|
| q or content | Yes* | Search term (e.g. "Pricing"). Search across document title and content (and optionally other searchable fields). *At least one of q or content; can be aliased. |
| bu | No | Restrict search to documents accessible in this BU (same as list). |
| page | No | Default 1. |
| pageSize | No | Default 25, max 100. |
| sort | No | Default e.g. `publishedAt:desc` or relevance if supported. |

### Response (200)

```json
{
  "data": [
    {
      "id": "doc-uuid",
      "title": "Pricing guide",
      "excerpt": "...snippet containing match...",
      "status": "published",
      "ownerBu": { "id": "bu-id", "name": "TFB", "slug": "tfb" },
      "publishedAt": "2025-02-18T12:00:00.000Z",
      "permissions": { "canView": true, "canEdit": false, "canDelete": false, "canPublish": false }
    }
  ],
  "meta": {
    "total": 5,
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "pageCount": 1
    }
  }
}
```

- **excerpt:** Optional snippet of content that matches the search term.
- Search is performed **only within the set of document IDs the user can access** (same resolution as list). So a TFB user with limited doc access only sees results from that subset.

### Status codes

- **200** — Success (data may be empty).
- **400** — Missing q/content or invalid params.
- **401** — Unauthorized.

### Edge cases

- **Search with no accessible docs:** Return 200 with `data: []`, `meta.total: 0`. Do not return an error.
- **Empty search term:** Return 400 or treat as “no search term” and return list (implementation choice; document the chosen behavior).
- **User in multiple BUs:** Same as list—aggregate accessible doc IDs from all BUs + shared-to-user, then run search within that set.
- **Superadmin:** Search over all documents (no BU filter unless `bu` query is provided).
- **Pagination and sort:** Same as list—consistent `page`, `pageSize`, `pageCount`, `total`; sort defined (e.g. by relevance or publishedAt).

---

## Pagination (all list/search APIs)

- **page:** 1-based.
- **pageSize:** Clamped to 1–100; default 25.
- **total:** Total number of items matching the request (before pagination).
- **pageCount:** `ceil(total / pageSize)`.

---

## Summary of edge cases (reference)

| Scenario | Behavior |
|----------|----------|
| User in multiple BUs | Aggregate accessible doc IDs from all BUs + shared-to-user. |
| No BU (author-only) | Only docs shared to user (and “all BUs” if implemented). |
| Draft vs published | Viewers: published only. Editors/Admins: drafts of docs they can edit. |
| Empty result (list/search) | 200, `data: []`, meta total 0. |
| Document not found | 404. |
| Document exists but no access | 403. |
| Search with no accessible docs | 200, empty list. |
| Superadmin | List/search over all documents; no BU filter unless `bu` query. |
| Invalid or missing params | 400. |

---

## Next

- [04-templates-and-bu-structure.md](04-templates-and-bu-structure.md) — Template and folder model for BUs.
