# 04 — Templates and BU Structure

This document describes how **templates** and optional **folders** let each business unit (BU) organize and create their own documents in a consistent way.

---

## Goals

- Each BU can have its own document types and structure (templates).
- BUs can optionally organize templates (and documents) in a **folder** hierarchy.
- “Create their own documents” means: when a user creates a document, they pick a template (and optionally a folder); the template defines the structure (e.g. fields, layout) for that document.

---

## Template entity (recap)

From [01-entities-and-database.md](01-entities-and-database.md):

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| businessUnitId | FK (nullable) | Owning BU; null = global template (available to all BUs) |
| folderId | FK (optional) | Optional folder within the BU (or global) |
| name | string | Template name (e.g. "Use Case", "Release notes") |
| structure | JSON | Field definitions or schema (e.g. list of fields, layout) |

- **BU-specific template:** businessUnitId set → only that BU (and users with access to it) can use it to create documents.
- **Global template:** businessUnitId null → any BU can use it (e.g. common “Article” or “FAQ” template).

---

## Folder entity (recap)

| Attribute | Type | Description |
|-----------|------|-------------|
| id | PK | Unique identifier |
| businessUnitId | FK | BU that owns this folder |
| name | string | Folder name |
| parentId | FK (nullable) | Parent folder; null = root |

- Folders form a tree per BU. They can be used to:
  - Group **templates** (e.g. "Use Cases", "Release notes" under "TFB").
  - Optionally group **documents** (e.g. document.folderId) for navigation in the dashboard.

---

## Minimal folder/template schema (proposal)

**Folder:**

- One tree per BU (root folders have parentId = null).
- Templates can reference folderId to appear “under” a folder in the UI.
- Documents can optionally reference folderId (or a “virtual” folder derived from template’s folder).

**Template:**

- structure: JSON object describing the document shape. For example:
  - `{ "fields": [ { "name": "title", "type": "string", "required": true }, { "name": "body", "type": "richtext" } ] }`
  - Or a simpler list of field names if types are fixed.
- When a document is created from a template, its content or schema is validated/rendered according to this structure.

---

## How “create their own documents” uses templates

1. User (Editor, Admin, or Author) initiates “Create document.”
2. Backend returns **available templates** for that user:
   - Global templates (businessUnitId = null).
   - Templates for BUs the user belongs to (or can create for, in the case of Author).
3. User selects a template (and optionally a folder for organization).
4. User fills in the fields defined by the template’s **structure**.
5. On submit, a **Document** is created with ownerBuId, templateId, and content matching the structure. Optional: set document.folderId from template.folderId or user-selected folder.

---

## Example BU folder structure (placeholder)

A possible layout for one BU (e.g. TFB) could look like:

```
TFB (BU root)
├── Use Cases
│   └── (templates: "Use Case", "Integration Use Case")
├── Authentication
│   └── (templates: "Auth Guide", "API Keys")
├── Glossary
│   └── (template: "Glossary Entry")
└── Release notes
    └── (template: "Release note")
```

Another BU (e.g. Wholesale) might have:

```
Wholesale (BU root)
├── Content 1
│   └── (template: "Content 1")
└── Content 2
    └── (template: "Content 2")
```

**Placeholder for your layout:** If you have a desired folder structure (e.g. from an existing system or wireframe), paste it here so the implementation can match it:

```
[ Paste your desired folder structure here ]
```

---

## Implementation notes

- **Strapi:** Templates can be a content type (e.g. `api::template.template`) with a JSON attribute for structure; folders as another content type with parentId self-relation. Document content type has templateId and optional folderId.
- **Simple DB:** Folder and Template tables as in [01-entities-and-database.md](01-entities-and-database.md); document creation API validates content against template.structure.

---

## Next

- [05-strapi-mapping.md](05-strapi-mapping.md) — How this design maps to Strapi and what to add on top of multi-group.
