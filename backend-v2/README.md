# backend-v2

Strapi-based developer portal (multi-tenant). Alternative architecture to compare with `backend/`.

## Model

- **Tenants** – Multi-tenant isolation
- **Products** – API groups per tenant
- **Content Categories** – Hierarchical folders
- **Content Items** – Doc pages (Markdown, embedded media, PlantUML)
- **Tags** – Search and grouping
- **Versions** – Per-item version history
- **Navigation Items** – Sidebar/top menus

Media: Strapi Upload plugin; reference files in Markdown (e.g. `![Diagram](/uploads/architecture.svg)`). Visibility: `public` | `private` (tenant-scoped).

### Admin: Content Item media uploads

- The `Content Item` type includes a `media` field of type **Media** configured for **multiple** assets (images and files).
- In the Content Manager, when editing a content item, editors can use the `media` field's **Add assets** button to upload new images/files directly from the form or select existing ones.

## Setup

```bash
cp .env.example .env
# Edit .env and set APP_KEYS, secrets
npm install
npm run develop
```

Admin: http://localhost:1338/admin (default port 1338 to avoid clash with `backend`).

If `npm install` fails building `better-sqlite3`, use PostgreSQL (`DATABASE_CLIENT=postgres` and set DB env vars) or run install outside the sandbox.
