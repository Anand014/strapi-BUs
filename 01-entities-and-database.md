# 01 — Entities and Database

This document describes the core entities and their relationships for the content management system. The model is implementation-agnostic so it can be implemented in a simple DB first and later mapped to Strapi.

---

## Entities

### BusinessUnit

Represents a business unit (e.g. TFB, Wholesale, Broadband-fibre, devportal).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| name | string | Display name (e.g. "TFB", "Wholesale") |
| slug | string | URL-safe identifier (e.g. `tfb`, `wholesale`). Unique. |

Same idea as **Group** in the multi-group project; slug is used like `param` for API scoping.

---

### User

Represents a user (admin or front-end). In Strapi this will map to `admin::user` or users-permissions.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| email | string | Login / identity |
| isSuperadmin | boolean | If true, user bypasses BU scope and has full access to all documents. Optional; can be represented by absence of UserBuRole rows instead. |

Other fields (name, createdAt, etc.) as needed by the implementation.

---

### UserBuRole

Assigns a user to a business unit with a specific role. One row per user per BU.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| userId | FK → User | User |
| businessUnitId | FK → BusinessUnit | Business unit |
| role | enum | `viewer` \| `editor` \| `admin` |

- **Viewer:** Can view documents (subject to document access).
- **Editor:** Can create and edit documents (subject to document access).
- **Admin:** Can create, edit, delete, and publish documents for that BU.

Superadmin: either no UserBuRole rows (global flag on User) or a special handling rule. Author is a separate capability (see Author below).

**Unique constraint:** (userId, businessUnitId) at most one row per user per BU.

---

### Author (optional / capability)

Author is a user who can **create** documents for a specific BU or for “shared” (multiple BUs), without necessarily being an editor or admin in those BUs. Can be modeled as:

- A **flag** on User (e.g. `isAuthor`) plus scope stored on the document at creation, or
- A separate **Author** or **UserAuthorScope** entity (e.g. userId, allowedBuIds or “shared” flag).

Subsequent management (edit, delete, publish) is governed by DocumentShare, DocumentAccess, and UserBuRole as usual.

---

### Document

A content item owned by one BU, with optional sharing and access rules.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| ownerBuId | FK → BusinessUnit | Owning business unit |
| title | string | Document title |
| content | text / ref | Body or reference to content (e.g. rich text, JSON) |
| status | enum | `draft` \| `published` |
| templateId | FK → Template (optional) | Template used to create this document |
| createdById | FK → User | Creator |
| publishedAt | datetime (optional) | When published; null if draft |
| updatedAt | datetime | Last update |

Documents belong to exactly one BusinessUnit (owner). Visibility and edit rights for other BUs or users are defined via DocumentShare and DocumentAccess.

---

### DocumentShare

Defines how a document is shared with a BU or with a specific user (for “editor1 no access, editor2 access” style rules).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| documentId | FK → Document | Document |
| targetType | enum | `bu` \| `user` |
| targetId | FK | BusinessUnit id if targetType=bu, User id if targetType=user |
| access | enum | `consume` (view only) \| `crud` (create/read/update/delete in context of that share) |

- **Shared to BU (targetType=bu):** All admins of that BU get full access; viewers get view; editors get access only if they also have a document-level grant (see DocumentAccess) or if you define a rule (e.g. “editors get view by default, edit only if granted”).
- **Shared to user (targetType=user):** That user gets the given access (consume or crud) regardless of BU role.

**Unique constraint:** (documentId, targetType, targetId) at most one share per document per target.

---

### DocumentAccess (optional)

Explicit per-user allow/deny for a document. Use when BU-level role and DocumentShare are not enough (e.g. editor1 denied, editor2 allowed within the same BU).

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| documentId | FK → Document | Document |
| userId | FK → User | User |
| access | enum | `view` \| `edit` \| `none` |

- `view`: User can view the document (overrides no access).
- `edit`: User can view and edit (and possibly delete/publish depending on role).
- `none`: Explicit deny (e.g. editor in the BU who should not see this doc).

If a row exists, it overrides or refines the default derived from DocumentShare + UserBuRole. Evaluation order: DocumentAccess first; if no row or not `none`, then derive from DocumentShare and role.

---

### Template (optional)

Defines a document structure or “folder” so each BU can create their own document types.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| businessUnitId | FK → BusinessUnit (nullable) | Owning BU; null = global template |
| folderId | FK → Folder (optional) | Optional folder/category |
| name | string | Template name |
| structure | JSON / schema | Field definitions or structure (e.g. list of fields, layout). |

See [04-templates-and-bu-structure.md](04-templates-and-bu-structure.md) for folder hierarchy and usage.

---

### Folder (optional)

Optional hierarchy for organizing templates and possibly documents per BU.

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| businessUnitId | FK → BusinessUnit | BU that owns this folder |
| name | string | Folder name |
| parentId | FK → Folder (nullable) | Parent folder; null = root. |

---

## Relationships summary

- **Document** belongs to one **BusinessUnit** (owner).
- **Document** is shared via **DocumentShare** to many BUs or many Users.
- **Document** can have per-user **DocumentAccess** overrides.
- **User** has **UserBuRole** per **BusinessUnit** (viewer / editor / admin).
- **User** may be **Superadmin** (no BU scope) or **Author** (create for specific/shared BUs).
- **Document** may reference a **Template**; **Template** may belong to a **BusinessUnit** and optionally a **Folder**; **Folder** belongs to a **BusinessUnit** and can form a tree via parentId.

---

## ER diagram (Mermaid)

```mermaid
erDiagram
  BusinessUnit ||--o{ UserBuRole : "has"
  User ||--o{ UserBuRole : "has"
  BusinessUnit ||--o{ Document : "owns"
  User ||--o{ Document : "createdBy"
  Document ||--o{ DocumentShare : "shared via"
  Document ||--o{ DocumentAccess : "access override"
  User ||--o{ DocumentAccess : "user"
  BusinessUnit ||--o{ Template : "optional"
  Folder ||--o{ Template : "optional"
  BusinessUnit ||--o{ Folder : "owns"

  BusinessUnit {
    id PK
    name string
    slug string
  }

  User {
    id PK
    email string
    isSuperadmin boolean
  }

  UserBuRole {
    id PK
    userId FK
    businessUnitId FK
    role enum
  }

  Document {
    id PK
    ownerBuId FK
    title string
    content ref
    status enum
    templateId FK
    createdById FK
    publishedAt datetime
  }

  DocumentShare {
    id PK
    documentId FK
    targetType enum
    targetId FK
    access enum
  }

  DocumentAccess {
    id PK
    documentId FK
    userId FK
    access enum
  }

  Template {
    id PK
    businessUnitId FK
    folderId FK
    name string
    structure JSON
  }

  Folder {
    id PK
    businessUnitId FK
    parentId FK
    name string
  }
```

---

## Next

- [02-roles-and-permissions.md](02-roles-and-permissions.md) — Who can view, edit, delete, publish; permission matrix and decision flow.
