# Edge Cases and Flow Verification

This document lists **all edge cases** and **how to check each flow** for the CM Strapi app (list, get-one, search, and role-based access). Use it together with [backend/docs/SEED-AND-TESTING.md](backend/docs/SEED-AND-TESTING.md) for setup.

---

## 1. Edge cases (reference)

| # | Scenario | Expected behavior | How to check |
|---|----------|--------------------|--------------|
| 1 | User in multiple BUs | List/search returns union of docs from all BUs + docs shared to user | Assign user to TFB and Wholesale; create docs in each BU; call GET /api/documents → see docs from both BUs and any shared to user |
| 2 | No BU (author-only) | Only docs shared directly to user (targetType=user) appear | Create user with no businessUnits, no UserBuRole; add DocumentShare targetType=user for one doc; call list → only that doc |
| 3 | Draft vs published | Viewers see only published; editors/admins see drafts they can edit | As viewer, GET /api/documents → only published. As editor/admin, same call → published + drafts of docs they can edit |
| 4 | Empty result (list) | 200, `data: []`, `meta.total: 0`, `meta.pagination.pageCount: 0` | User with no accessible docs; GET /api/documents → 200, empty data |
| 5 | Empty result (search) | 200, empty list, not error | User with no docs or no match; GET /api/documents/search?q=xyznonexistent → 200, data [] |
| 6 | Document not found | 404 | GET /api/documents/invalid-id-or-deleted → 404 |
| 7 | Document exists but no access | 403 | As TFB viewer, request a doc with DocumentAccess(user, none) → 403 |
| 8 | Search with no accessible docs | 200, empty list | User with zero accessible doc IDs; GET /api/documents/search?q=test → 200, data [] |
| 9 | Superadmin | List/search return all documents; no BU filter | Set user isSuperadmin=true; GET /api/documents → all docs. GET /api/documents/search?q=... → search over all |
| 10 | Invalid or missing params | 400 where applicable | GET /api/documents/search (no q or content) → 400 |
| 11 | DocumentAccess none | User cannot view that document even if in same BU | Create DocumentAccess(doc, user, none); as that user GET /api/documents/:id → 403 |
| 12 | Shared to BU (consume) | Viewers/editors in that BU can view only; admins get full access per role | Share doc to BU with consume; as viewer in that BU → canView only; as admin in that BU → full access |
| 13 | Shared to BU (crud) | Editors in that BU can edit; admins full access | Share doc to BU with crud; as editor in that BU → canEdit; as admin → canDelete, canPublish |
| 14 | Shared to user | That user gets the share access (consume or crud) regardless of BU role | DocumentShare targetType=user, targetUser=X, access=crud; as X, get-one → canEdit true |

---

## 2. Flow: List API

**Purpose:** GET /api/documents returns documents the current user can see (owned by user’s BUs, shared to BUs, shared to user), with optional filters.

**Prerequisites**

- At least one BU (e.g. TFB), one admin user with businessUnits=[TFB] and UserBuRole(role=viewer or editor or admin).
- At least one document (ownerBu=TFB), published.

**Steps**

1. Log in as that admin (or send request with admin JWT).
2. `GET /api/documents`
3. Optional: `GET /api/documents?bu=tfb`, `GET /api/documents?status=published`, `GET /api/documents?page=1&pageSize=25&sort=updatedAt:desc`

**Expected**

- 200, body `{ data: [...], meta: { total, pagination: { page, pageSize, pageCount } } }`.
- Each item has `ownerBu`, `permissions` (canView, canEdit, canDelete, canPublish).
- Only documents the user can view appear; draft docs only if user can edit them.
- With `bu=tfb`, only docs accessible in that BU (by ownership or share).

**How to check viewer vs editor**

- As **viewer**: list only published docs they can view; permissions canEdit/canDelete/canPublish false.
- As **editor/admin**: list includes drafts they can edit; canEdit true where applicable.

---

## 3. Flow: Get one API

**Purpose:** GET /api/documents/:id returns one document if the user has view access; otherwise 403. 404 if document does not exist.

**Prerequisites**

- One document, one user with view access (e.g. same BU as owner, or shared to user/BU).

**Steps**

1. `GET /api/documents/:documentId` (or `:id`) with auth.
2. Repeat with a document the user does not have access to (e.g. DocumentAccess none, or doc in other BU with no share).

**Expected**

- With access: 200, `{ data: { id, title, content, ownerBu, sharedTo, permissions, ... } }`.
- No access: 403.
- Invalid/missing id: 404.

---

## 4. Flow: Search API

**Purpose:** GET /api/documents/search?q=... (or content=...) searches only within documents the user can access.

**Prerequisites**

- User with access to a subset of documents (e.g. TFB only). At least one document contains the search term (e.g. "Pricing").

**Steps**

1. `GET /api/documents/search?q=Pricing` (or `content=Pricing`) with auth.
2. Optionally `?bu=tfb&page=1&pageSize=25`.

**Expected**

- 200, `{ data: [...], meta: { total, pagination } }`.
- Only documents that (1) user can access and (2) match the term (title or content) appear.
- If user has no accessible docs: 200, data [].

---

## 5. Flow: Explicit deny (DocumentAccess none)

**Purpose:** An editor in the same BU as the doc owner can be explicitly denied access.

**Prerequisites**

- Doc owned by TFB. User A (TFB editor) and User B (TFB editor). DocumentAccess(doc, user A, none).

**Steps**

1. As User A: GET /api/documents (list) and GET /api/documents/:id for that doc.
2. As User B: same requests.

**Expected**

- User A: doc does not appear in list; get-one returns 403.
- User B: doc appears (and can edit if no other restriction).

---

## 6. Flow: Superadmin sees all

**Purpose:** User with isSuperadmin=true sees and can manage all documents regardless of BU.

**Prerequisites**

- One user with isSuperadmin=true. Documents in multiple BUs.

**Steps**

1. As that user: GET /api/documents, GET /api/documents/search?q=...

**Expected**

- List and search return all documents (no BU filtering by access). Permissions canEdit/canDelete/canPublish true where applicable.

---

## 7. Flow: Shared to user (targetType=user)

**Purpose:** Document shared to a specific user gives that user the share access (consume or crud) even without BU role on that doc.

**Prerequisites**

- Doc owned by TFB. DocumentShare(doc, targetType=user, targetUser=User C, access=crud). User C has no TFB role (or only viewer).

**Steps**

1. As User C: GET /api/documents, GET /api/documents/:id for that doc.

**Expected**

- Doc appears in list; get-one returns it with canEdit true (because share is crud).

---

## 8. Unauthenticated requests

**Steps**

1. GET /api/documents, GET /api/documents/:id, GET /api/documents/search?q=test without auth.

**Expected**

- 401 Unauthorized (all three).

---

## 9. Pagination and sort

**Steps**

1. GET /api/documents?page=2&pageSize=10&sort=updatedAt:desc (with enough data).

**Expected**

- Second page of 10 items; meta.pagination.page=2, pageSize=10, pageCount correct; total in meta.

---

## 10. Summary table: status codes

| Request | Condition | Status |
|---------|-----------|--------|
| List/Search | Success (possibly empty) | 200 |
| List/Search | Unauthenticated | 401 |
| Search | Missing q/content | 400 |
| Get one | Document not found | 404 |
| Get one | No view access | 403 |
| Get one | Unauthenticated | 401 |

Use this file to systematically verify all edge cases and flows after seeding data per [backend/docs/SEED-AND-TESTING.md](backend/docs/SEED-AND-TESTING.md).
