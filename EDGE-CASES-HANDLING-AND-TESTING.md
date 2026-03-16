# Edge Cases: How We Handle Them and How to Test

This document lists **all edge cases** for the CM app, **where and how the code handles each**, and **how to test** (manual or automated). Use it with [EDGE-CASES-AND-FLOWS.md](EDGE-CASES-AND-FLOWS.md) and [backend/docs/SEED-AND-TESTING.md](backend/docs/SEED-AND-TESTING.md).

---

## 1. Summary table


| #   | Category | Scenario                                              | Expected                                                                            | Status code / behavior             |
| --- | -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Access   | User in multiple BUs                                  | List/search = union of docs from all BUs + shared to user                           | 200                                |
| 2   | Access   | No BU (author-only)                                   | Only docs shared to user (targetType=user) + public published                       | 200                                |
| 3   | Access   | Draft vs published                                    | Viewers: published only; editors/admins: drafts they can edit                       | 200                                |
| 4   | Access   | Empty result (list)                                   | 200, `data: []`, `meta.total: 0`, `meta.pagination.pageCount: 0`                    | 200                                |
| 5   | Access   | Empty result (search)                                 | 200, empty list                                                                     | 200                                |
| 6   | Access   | Document not found                                    | 404                                                                                 | 404                                |
| 7   | Access   | Document exists but no access                         | 403                                                                                 | 403                                |
| 8   | Access   | Search with no accessible docs                        | 200, empty list                                                                     | 200                                |
| 9   | Access   | Superadmin                                            | List/search over all documents                                                      | 200                                |
| 10  | Params   | Invalid or missing params                             | 400 (e.g. search without q)                                                         | 400                                |
| 11  | Access   | DocumentAccess none                                   | User cannot view that document                                                      | 403                                |
| 12  | Share    | Shared to BU (consume)                                | Viewers/editors: canView only; admins: full per role                                | 200 + permissions                  |
| 13  | Share    | Shared to BU (crud)                                   | Editors: canEdit; admins: full                                                      | 200 + permissions                  |
| 14  | Share    | Shared to user                                        | User gets share access (consume/crud) regardless of BU role                         | 200 + permissions                  |
| 15  | Public   | Unauthenticated list                                  | Only published + `isPublic: true` documents; public response shape                  | 200                                |
| 16  | Public   | Unauthenticated get-one (public doc)                  | 200, public shape (no ownerBu, sharedTo, permissions)                               | 200                                |
| 17  | Public   | Unauthenticated get-one (private or draft)            | 401, do not reveal doc existence                                                    | 401                                |
| 18  | Public   | Unauthenticated search                                | Only published + `isPublic: true`; public shape                                     | 200                                |
| 19  | Mutate   | Third party / API must not set isPublic               | isPublic only settable by privileged users in admin; stripped from body for editors | N/A (no mutation from content API) |
| 20  | Mutate   | Editor cannot set ownerBu, template, shares, accesses | Stripped from create/update body in Content Manager                                 | 200, field unchanged               |
| 21  | Service  | Strapi unavailable                                    | 503                                                                                 | 503                                |
| 22  | Params   | Get-one missing document ID                           | 400                                                                                 | 400                                |


---

## 2. How we handle each edge case (code)

### 2.1 Access and list/search (authenticated)


| Scenario                           | Where                                              | How we handle it                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User in multiple BUs**           | `backend/src/services/access-resolution.ts`        | `getAccessibleDocumentIds()` aggregates: docs owned by each of the user’s BUs (by `ownerBu`), docs from `getSharedDocumentIds()`, docs from `getDocumentAccessOverrides()` (view/edit), plus `getPublicPublishedDocumentIds()`. Explicit `none` is removed. Result is one set of viewable document IDs.                                      |
| **No BU (author-only)**            | Same                                               | Same resolution: user’s `businessUnitIds` may be empty; they still get shared-to-user docs (targetType=user) and DocumentAccess view/edit, plus public published.                                                                                                                                                                            |
| **Draft vs published**             | `access-resolution.ts` + content-manager           | `getAccessibleDocumentIds()` returns IDs from both published and draft queries; draft is included only for BUs where user has editor/admin role. Content-manager list uses `getAccessibleDocumentIds()` and for viewers forces `status: "published"` via `hasOnlyViewerRole()`. Document API list uses same IDs and applies `status` filter. |
| **Empty result (list)**            | `backend/src/api/document/controllers/document.ts` | After `getAccessibleDocumentIds()`, if `accessibleIds.length === 0` we return 200 with `data: []`, `meta.total: 0`, `pagination.pageCount: 0` (lines 183–191). Same when `documentIds.length === 0` after `resolveDocumentIds()`.                                                                                                            |
| **Empty result (search)**          | `backend/src/api/search/controllers/search.ts`     | If `accessibleIds.length === 0` or `documentIds.length === 0`, we return 200 with `data: []`, `meta.total: 0`, `pagination.pageCount: 0` (lines 83–104).                                                                                                                                                                                     |
| **Document not found**             | `document.ts` (findOne)                            | After loading by documentId or numeric id, if `!doc` we call `ctx.notFound("Document not found")` (lines 282–285).                                                                                                                                                                                                                           |
| **Document exists but no access**  | `document.ts` (findOne)                            | For authenticated user we call `getPermissions(strapi, userId, doc.id)`; if `!perms.canView` we call `ctx.forbidden("Access denied")` (lines 297–301).                                                                                                                                                                                       |
| **Search with no accessible docs** | `search.ts`                                        | Same as empty result: we return 200 with empty data (lines 83–92).                                                                                                                                                                                                                                                                           |
| **Superadmin**                     | `access-resolution.ts`                             | In `getAccessibleDocumentIds()`, if `user.isSuperadmin` we load all document IDs (published + draft) without BU/share filters (lines 321–335). List and search then use this full set.                                                                                                                                                       |
| **DocumentAccess none**            | `access-resolution.ts`                             | `getDocumentAccessOverrides()` returns per-doc access; `getPermissions()` returns all false when override is `none`; `getAccessibleDocumentIds()` excludes docs with override `none` (lines 389–392, 424–425).                                                                                                                               |
| **Shared to BU (consume/crud)**    | `access-resolution.ts`                             | `getShareAccessForDocument()` and `getPermissions()` apply share access (consume → canView only; crud → canEdit). Owner BU role (viewer/editor/admin) is combined with share access in `getPermissions()`.                                                                                                                                   |
| **Shared to user**                 | `access-resolution.ts`                             | `getSharedDocumentIds()` includes docs shared to user (targetType=user). `getShareAccessForDocument()` returns that user’s share access; `getPermissions()` uses it so canView/canEdit reflect the share.                                                                                                                                    |


### 2.2 Public content (unauthenticated)


| Scenario                                       | Where                                                     | How we handle it                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unauthenticated list**                       | `backend/src/api/document/controllers/document.ts` (find) | When `!userId` we use `filters: { isPublic: true }`, `status: "published"`, and return only `formatPublicDocument(d)` (no ownerBu, sharedTo, permissions) (lines 147–179).  |
| **Unauthenticated get-one (public doc)**       | `document.ts` (findOne)                                   | When `!userId` we return data only if `doc.publishedAt && doc.isPublic === true`, using `formatPublicDocument(doc)` (lines 287–295).                                        |
| **Unauthenticated get-one (private or draft)** | `document.ts` (findOne)                                   | When `!userId` and doc is not (published and isPublic), we call `ctx.unauthorized("Authentication required")` so we do not reveal that the document exists (lines 291–293). |
| **Unauthenticated search**                     | `backend/src/api/search/controllers/search.ts`            | When `!userId` we use `filters: { isPublic: true, ...textFilter }`, `status: "published"`, and return `formatPublicDocument(d)` (lines 51–78).                              |


Public document shape is defined in `formatPublicDocument()` in `document.ts`: `id`, `title`, `content`, `status`, `publishedAt`, `updatedAt`, `createdAt` (no ownerBu, sharedTo, permissions).

### 2.3 Protected fields (no mutation from outside)


| Scenario                                                                      | Where                                                     | How we handle it                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **isPublic / ownerBu / template / shares / accesses not settable by editors** | `backend/src/extensions/content-manager/strapi-server.ts` | `PROTECTED_FIELDS = ["ownerBu", "template", "documentShares", "documentAccesses", "isPublic"]`. On create and update, if `isEditorRestrictedForDocumentMutate(strapi, user.id)` is true we call `stripProtectedFields(body)` so these keys are removed from the request body before Strapi persists (lines 51, 56–60, 164–165, 200–204).                                  |
| **Third party API cannot mutate documents**                                   | Routes + Content Manager                                  | Public document API only exposes `find` and `findOne` (`backend/src/api/document/routes/document.ts`: `only: ['find', 'findOne']`). There is no create/update route on the content API, so external callers cannot set isPublic or any field. All document create/update go through the Content Manager plugin, where protected fields are stripped for restricted users. |
| **Privileged users (superadmin/author) can set protected fields**             | `access-resolution.ts` + content-manager                  | `canShowProtectedDocumentFields()` is true for superadmin or author; only then are protected fields not stripped. Content-manager also uses `muteProtectedFieldsInMetadatas()` so non-privileged users see those fields as non-editable in the admin UI.                                                                                                                  |


### 2.4 Params and service


| Scenario                                              | Where                                          | How we handle it                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Invalid or missing params (e.g. search without q)** | `backend/src/api/search/controllers/search.ts` | We require a non-empty `q`; if missing we call `ctx.badRequest('Search query "q" is required and must be non-empty')` (lines 26–30). |
| **Get-one missing document ID**                       | `document.ts` (findOne)                        | If `!docId` we call `ctx.badRequest("Document ID required")` (lines 261–264).                                                        |
| **Strapi unavailable**                                | `document.ts`, `search.ts`                     | If `!strapi` we call `ctx.throw(503, "Service unavailable")` (e.g. document.ts lines 128–131, 254–257; search.ts lines 19–22).       |


---

## 3. How to test each edge case

### 3.1 Prerequisites

- Backend running; seed data per [backend/docs/SEED-AND-TESTING.md](backend/docs/SEED-AND-TESTING.md).
- At least one BU (e.g. TFB), users with viewer/editor/admin roles, and documents (some public, some private, some shared).

### 3.2 Access and list/search (authenticated)


| #     | Test                               | Steps                                                                                               | Expected                                                                             |
| ----- | ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1     | User in multiple BUs               | Assign user to TFB and Wholesale; create docs in each BU; `GET /api/documents` with that user’s JWT | 200; data includes docs from both BUs and any shared to user                         |
| 2     | No BU                              | User with no businessUnits, DocumentShare targetType=user for one doc; `GET /api/documents`         | 200; only that doc (and any public published)                                        |
| 3     | Draft vs published                 | As viewer: `GET /api/documents`. As editor: same                                                    | Viewer: only published. Editor: published + drafts they can edit                     |
| 4     | Empty list                         | User with no accessible docs; `GET /api/documents`                                                  | 200, `data: []`, `meta.total: 0`, `meta.pagination.pageCount: 0`                     |
| 5     | Empty search                       | `GET /api/documents/search?q=xyznonexistent` or user with no docs                                   | 200, `data: []`                                                                      |
| 6     | Document not found                 | `GET /api/documents/invalid-id-or-deleted` (no auth or with auth)                                   | 404                                                                                  |
| 7     | No access                          | As user with DocumentAccess(doc, user, none); `GET /api/documents/:id` for that doc                 | 403                                                                                  |
| 8     | Search no accessible docs          | User with zero accessible doc IDs; `GET /api/documents/search?q=test`                               | 200, `data: []`                                                                      |
| 9     | Superadmin                         | User with isSuperadmin=true; `GET /api/documents`, `GET /api/documents/search?q=...`                | 200; all documents in list and search                                                |
| 11    | DocumentAccess none                | DocumentAccess(doc, userA, none); as userA: list and get-one for that doc                           | Doc not in list; get-one → 403                                                       |
| 12–14 | Share consume/crud, shared to user | Create shares; call list and get-one as viewer/editor in target BU or as shared user                | 200; permissions match (canView only for consume; canEdit for crud where applicable) |


### 3.3 Public content (unauthenticated)


| #   | Test                                    | Steps                                                                        | Expected                                                                                                                                                         |
| --- | --------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | Unauthenticated list                    | `GET /api/documents` with no auth                                            | 200; only docs with isPublic true and published; each item has id, title, content, status, publishedAt, updatedAt, createdAt (no ownerBu, sharedTo, permissions) |
| 16  | Unauthenticated get-one (public)        | `GET /api/documents/:id` for a doc with isPublic true and published, no auth | 200; same public shape                                                                                                                                           |
| 17  | Unauthenticated get-one (private/draft) | `GET /api/documents/:id` for a doc with isPublic false or draft, no auth     | 401                                                                                                                                                              |
| 18  | Unauthenticated search                  | `GET /api/documents/search?q=something` no auth                              | 200; only published + isPublic docs; public shape                                                                                                                |


### 3.4 Protected fields (no mutation from outside)


| #   | Test                                      | Steps                                                                                                                                 | Expected                                                                       |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 19  | API cannot set isPublic                   | Confirm no POST/PUT on `/api/documents` for document create/update                                                                    | Only find/findOne exist; no mutation via content API                           |
| 19  | Editor cannot set isPublic in admin       | As editor, create or update a document in Content Manager with isPublic: true in body (e.g. via API or custom client that sends body) | Document’s isPublic unchanged (stripped); only superadmin/author can change it |
| 20  | Editor cannot set ownerBu/shares in admin | As editor, create/update with ownerBu or documentShares in body                                                                       | Those fields stripped; ownerBu may be auto-set from default BU for create      |


### 3.5 Params and errors


| #   | Test             | Steps                                               | Expected                    |
| --- | ---------------- | --------------------------------------------------- | --------------------------- |
| 10  | Search missing q | `GET /api/documents/search` (no q)                  | 400                         |
| 21  | Strapi down      | Stop Strapi; call any document or search endpoint   | 503 (if app still responds) |
| 22  | Get-one no id    | `GET /api/documents/` or route that has no id param | 400 (Document ID required)  |


---

## 4. Status code reference


| Request                | Condition                                            | Status |
| ---------------------- | ---------------------------------------------------- | ------ |
| List (authenticated)   | Success (possibly empty)                             | 200    |
| List (unauthenticated) | Success; only public published                       | 200    |
| List                   | Unauthenticated (if you later require auth for list) | 401    |
| Get one                | Document not found                                   | 404    |
| Get one                | No view access (authenticated)                       | 403    |
| Get one                | Unauthenticated, doc not public                      | 401    |
| Get one                | Unauthenticated, doc public + published              | 200    |
| Get one                | Missing document ID                                  | 400    |
| Search                 | Success (possibly empty)                             | 200    |
| Search                 | Missing or empty q                                   | 400    |
| Any                    | Strapi unavailable                                   | 503    |


---

## 5. Related docs

- [03-api-design-and-edge-cases.md](03-api-design-and-edge-cases.md) — API design and edge case summary
- [EDGE-CASES-AND-FLOWS.md](EDGE-CASES-AND-FLOWS.md) — Step-by-step flow verification
- [backend/docs/SEED-AND-TESTING.md](backend/docs/SEED-AND-TESTING.md) — Seed data and setup
- [02-roles-and-permissions.md](02-roles-and-permissions.md) — Roles and permissions model

