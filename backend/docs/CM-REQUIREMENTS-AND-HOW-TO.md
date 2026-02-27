# CM requirements and how to achieve them

This document is the single place for CM behaviour (roles, BU, sharing, client APIs) and how to set them up. For step-by-step seed and test data, see [SEED-AND-TESTING.md](SEED-AND-TESTING.md).

---

## Admin / Superadmin setup

### 1. As superadmin I can invite users as viewer, editor, admin, or author

**Point:** Invite users and assign CM role (viewer / editor / admin / author).

**Right step:**

- Use **Settings → Administration Panel → Users** to invite (or create) admin users.
- Assign **BU and CM role** via **Content Manager → User BU Role**: create an entry per (user, BU, role) with `role` = `viewer` | `editor` | `admin`. For **author**, use the **isAuthor** flag on the admin user (there is no "author" in the User BU Role enum today); set it via DB/seed or a small admin-only control (see [Settings → Admin Panel → Users](#settings--admin-panel--users-current-situation) below).
- Optional: after invite acceptance, auto-create User BU Role from invite metadata, or add an "Assign to BU" step in a custom flow.

---

### 2. Create BUs (e.g. TFB, Wholesale, Dev Portal)

**Point:** Create business units like TFB, Wholesale, Dev Portal.

**Right step:** **Content Manager → Business Unit → Create new entry.** Set name and slug (e.g. `tfb`, `wholesale`, `devportal`). No code change needed.

---

### 3. Each user has a BU; Author is like superadmin but with fewer privileges

**Point:** Every user is tied to at least one BU via their role. Author can create documents for a specific BU or shared (multiple BUs).

**Right step:**

- **Viewer / editor / admin:** Assign via **User BU Role** (user + businessUnit + role). A user can have multiple entries (e.g. TFB admin + Wholesale viewer).
- **Author:** Set **isAuthor** on the admin user. Author can create documents and choose owner BU and Document Share (which BUs/users get consume/crud). Edit/delete/publish after creation follow normal rules (editor/admin in that BU or share). The create flow should let Author pick owner BU and optional shares (supported by Document + Document Share model).

---

### 4. Viewer, editor, admin in Strapi dashboard only see their BU-related collection types and documents

**Point:** In the Strapi admin, non-superadmin users should only see collection types and documents relevant to their BU(s).

**Right step:**

- **Today:** The **custom document API** (`GET /api/documents`, get-one, search) already returns only documents the user can access (by BU and role). Any **custom admin "Documents" view** that uses this API automatically shows only their BU-related documents.
- **Default Content Manager** (Content Manager → Collection Types → Document) does **not** filter by BU/role; it shows all documents. So either: (a) add a **custom admin page** "Documents" that uses `GET /api/documents` (recommended), or (b) extend the content-manager plugin for the Document type to filter by current user's access. **Pending:** implement custom admin list/detail view or plugin override, and optionally hide the default Document list for non-superadmins.

---

### 5. Document created by TFB shared with Wholesale view-only

**Point:** TFB-owned document shared to Wholesale so Wholesale can only view (no edit).

**Right step:** **Content Manager → Document Share → Create:** select the document, `targetType` = `bu`, `targetBu` = Wholesale, `access` = `consume` (view only). Use `crud` only if you want Wholesale to edit/delete; `consume` = view only.

---

### 6. Document of BU1 accessible to a specific admin or viewer of BU2, not the whole BU2

**Point:** Restrict access so only certain users in BU2 (e.g. one admin or one viewer) can see the document, not everyone in BU2.

**Right step:**

- **Option A:** **Document Share** with `targetType` = `user` and select the specific user. Only that user gets access (consume or crud). Do not share to the whole BU2.
- **Option B:** Share to BU2 with `targetType` = `bu` and `targetBu` = BU2, then use **Document Access** to set `access` = `none` for every other user in BU2 who must be denied. The intended users keep access via the BU share; the rest are explicitly denied.

---

## Client-side

### 1. Get document – BU1 user gets their BU's documents plus any document shared from other BUs

**Point:** A user in BU1 can fetch documents that belong to BU1 or are shared to them (or to their BU).

**Right step:** Client calls **`GET /api/documents`** (and **`GET /api/documents/:id`** for one) with **admin auth** (e.g. `Authorization: Bearer <admin JWT>` or session cookie). The API uses the authenticated user to compute accessible document IDs (own BU + shared to BU + shared to user + Document Access) and returns only those. No extra client logic.

---

### 2. Search – user can search only within documents they have access to; match query in content

**Point:** Search (e.g. `q="pricing"`): among documents the user can access, find those whose content (or title) contains the query.

**Right step:** Client calls **`GET /api/documents/search?q=pricing&page=1&pageSize=25`** with admin auth. The backend (1) restricts to accessible document IDs for the user, (2) filters by `title` / `content` containing the search term. Behaviour matches "iterate over docs available to that BU user and check content."

---

## Extras

- **Draft visibility:** Viewers see only published docs; editors/admins see drafts for BUs where they have editor/admin role (already in [access-resolution](../src/services/access-resolution.ts)).
- **Document Access:** Use **Document Access** (document + user + access: view | edit | none) to grant or explicitly deny access per user when share-to-BU is too broad.
- **Superadmin:** One user with **isSuperadmin** = true sees and manages all documents; set via DB/seed or a future small admin control.

---

## Settings → Admin Panel → Users (current situation)

**Current situation:** The **Settings → Administration Panel → Users → Edit user** form does **not** show:

- **businessUnits** (relation to BUs),
- **isSuperadmin**,
- **isAuthor**

These exist on the extended admin user model ([schema](../src/extensions/admin/content-types/user/schema.json)) but are not part of the built-in Strapi user edit UI.

**Why it's mentioned:** [SEED-AND-TESTING.md](SEED-AND-TESTING.md) says to set these "via the database or another mechanism" because without them, access-resolution cannot treat a user as superadmin or author, and (in current code) cannot know which BUs the user belongs to.

**Why BU on user is (optionally) not required:** Access-resolution currently uses **both** (1) `user.businessUnits` and (2) **User BU Role**. The list of BUs a user belongs to could be **derived only from User BU Role** (all distinct BUs from their User BU Role entries). If the code is changed to derive the BU list from User BU Role only, then **businessUnits** on the user does not need to be set at all; **Content Manager → User BU Role** would be the single place to assign BU and role (viewer/editor/admin).

**What is still needed:**

- **isSuperadmin** and **isAuthor** must be set somewhere (they are not in User BU Role): today via **database** or **seed script**; later via a small **admin-only API + UI** (e.g. "CM flags" section or modal) or by extending the user edit form.
- If we **do not** refactor to derive BUs from User BU Role: then we also need a way to set **businessUnits** (same options: DB, seed, or custom UI).
- **Recommendation:** (1) Refactor access-resolution to derive `buIds` from User BU Role so BU assignment is only via User BU Role. (2) Add a seed script and/or small admin control for **isSuperadmin** and **isAuthor** only.

---

## Requirements still pending / needed

- **Invite + role assignment:** After inviting a user, ensure they get **User BU Role** entries (and optionally **isAuthor**) via a documented process; optional: automate from invite or add "Assign to BU" in admin.
- **Author in UI:** Decide whether "author" stays a flag (**isAuthor**) or is added as a role in User BU Role; document and implement consistently.
- **Settings → Users:** No BU/role in the built-in form. Either: (a) derive BUs from User BU Role in code and document that User BU Role is the only place to assign BU + viewer/editor/admin, or (b) add a way to set **businessUnits** (and document it). In both cases, add a way to set **isSuperadmin** and **isAuthor** (seed script and/or small admin API + UI).
- **Admin dashboard scope:** Viewer/editor/admin should see only BU-relevant collection types and documents. **Pending:** custom admin "Documents" view that uses `GET /api/documents` (and get-one/search), and optionally hide or restrict the default Content Manager Document list for non-superadmins.
- **Client:** List/get-one/search must be called with admin auth; optional: document CORS and token handling if the client is a separate app.
