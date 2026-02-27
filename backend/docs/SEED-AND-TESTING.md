# Seed and testing setup

Use this to create sample data so you can test the document list, get-one, and search APIs and verify edge cases.

## Prerequisites

1. Start Strapi: `npm run develop`
2. Open admin: http://localhost:1337/admin and create the first admin user (this will be your superadmin or you can set flags later).

## 1. Create Business Units

1. Content Manager → Business Unit → Create new entry.
2. Create at least two:
   - **TFB**: name `TFB`, slug `tfb`
   - **Wholesale**: name `Wholesale`, slug `wholesale`

## 2. Set Admin User BU and Flags (businessUnits, isSuperadmin, isAuthor)

The standard **Settings → Administration Panel → Users → Edit user** form does **not** show `businessUnits`, `isSuperadmin`, or `isAuthor`. Those fields exist on the extended admin user model but are not part of the built-in user edit UI. Set them via the database or another mechanism as needed for your tests.

## 3. Create User BU Roles

1. Content Manager → User BU Role → Create new entry.
2. For each (user, BU, role) you need:
   - **user**: select admin user
   - **businessUnit**: select BU (e.g. TFB)
   - **role**: `viewer` | `editor` | `admin`
3. Example:
   - User A (TFB admin): UserBuRole(user=A, businessUnit=TFB, role=admin)
   - User B (TFB editor): UserBuRole(user=B, businessUnit=TFB, role=editor)
   - User C (TFB viewer): UserBuRole(user=C, businessUnit=TFB, role=viewer)
   - User D (Wholesale admin): UserBuRole(user=D, businessUnit=Wholesale, role=admin)

## 4. Create Documents

1. Content Manager → Document → Create new entry.
2. Set **title**, **content**, **ownerBu** (e.g. TFB).
3. Publish (or leave draft to test draft visibility).
4. Create a few documents: e.g. one owned by TFB, one by Wholesale, one shared (see below).

## 5. Document Share (shared to BU or user)

1. Content Manager → Document Share → Create new entry.
2. **document**: select a document.
3. **targetType**: `bu` or `user`.
4. **targetBu**: if targetType=bu, select the BU (e.g. Wholesale).
5. **targetUser**: if targetType=user, select the admin user.
6. **access**: `consume` (view only) or `crud`.
7. Example: Doc1 owned by TFB, shared to Wholesale with crud → Wholesale admins get full access; Wholesale editors get edit if they have access.

## 6. Document Access (explicit allow/deny per user)

1. Content Manager → Document Access → Create new entry.
2. **document**: select document.
3. **user**: select admin user.
4. **access**: `view` | `edit` | `none`.
5. Example: Doc1 + User B (editor) + `edit` → User B can edit. Doc1 + User C (editor) + `none` → User C cannot view (editor1 no access, editor2 access).

## 7. Call the APIs

- **List:** `GET /api/documents?bu=tfb&page=1&pageSize=25`  
  Send with admin auth (e.g. Cookie or `Authorization: Bearer <admin JWT>`).
- **Get one:** `GET /api/documents/:documentId` (or `:id`).
- **Search:** `GET /api/documents/search?q=Pricing&page=1&pageSize=25`.

Use Postman, curl, or the frontend. Ensure the request is authenticated as the admin user whose access you are testing.

## 8. Quick checklist for flows

- Create 2 BUs, 3–4 admin users, assign UserBuRole (viewer, editor, admin) per BU.
- Create 2–3 documents (different ownerBu), publish some, leave one draft.
- Add DocumentShare on one doc to another BU (crud) and optionally to a specific user (crud).
- Add DocumentAccess on one doc: one user `edit`, another user `none`.
- Set one user as isSuperadmin; call list/search as that user → should see all docs.
- Call list as TFB viewer → only published docs they can view.
- Call get-one as user with DocumentAccess none → 403.
