# Content Manager (CM) – Requirements Summary

A concise list of CM behaviour for sharing with stakeholders. For implementation details and how-to steps, see [CM-REQUIREMENTS-AND-HOW-TO.md](CM-REQUIREMENTS-AND-HOW-TO.md).

---

## Superadmin / Back-office

1. **User invites and roles**
  Superadmin can invite users and assign a CM role: **viewer**, **editor**, **admin**, or **author**.
2. **Business units (BUs)**
  Superadmin can create BUs (e.g. TFB, Wholesale, Dev Portal). Each has a name and slug.
3. **Users and BUs**
  Every user is linked to one or more BUs via their role. **Author** is a special role (below superadmin): they can create documents for a single BU or for multiple BUs (shared documents). Viewer, editor, and admin are assigned per BU.
4. **Strapi dashboard scope**
  In the Strapi admin, viewer, editor, and admin only see collection types and documents that belong to their BU(s). They do not see other BUs’ data.
5. **Cross-BU sharing (view-only)**
  A document owned by one BU (e.g. TFB) can be shared with another BU (e.g. Wholesale) with **view-only** access (no edit/delete).
6. **User-level sharing**
  A document from BU1 can be made visible to **specific** users in BU2 (e.g. one admin or one viewer), not to the entire BU2.

---

## Client-side

1. **Get documents**
  A user in a BU can fetch: (a) all documents belonging to their BU(s), and (b) documents from other BUs that have been shared with them or with their BU. One API returns only what they are allowed to see.
2. **Search**
  A user can search (e.g. by keyword like “pricing”) only within documents they have access to. The backend restricts to their BU + shared documents, then matches the query against document content (and optionally title) and returns matching documents.

---

## Still pending / to be decided

- After inviting a user, a clear process (or automation) to assign BU and role (and author flag if needed).
- Whether “author” is a separate role in the BU-role model or a separate flag; implement and document consistently.
- Strapi Settings → Users does not show BU, role, or author/superadmin; need either derivation from “User BU Role” only, or a way to set these (e.g. seed script and/or small admin UI).
- In the Strapi admin, viewer/editor/admin should see only BU-relevant documents; this requires a custom “Documents” view (or similar) that uses the document API, and possibly hiding the default Document list for non-superadmins.
- Client: document that list/get/search require admin authentication (and, if applicable, CORS and token handling for a separate client app).

