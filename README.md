# Content Management — Scalable Structure

This folder holds the **design and documentation** for a multi–business-unit (BU) content management system. The goal is to define a scalable structure first (entities, roles, APIs, templates), then implement it—with Strapi integration to follow once the simple DB and flows are fixed.

## Purpose

- **Multiple BUs:** e.g. TFB, Wholesale, Broadband-fibre, devportal—each with its own viewers, editors, and admins.
- **Roles:** Viewer, Editor, Admin, Superadmin, Author—with clear capabilities per BU and per document.
- **Document sharing:** Documents can be owned by one BU and shared with others (consume or CRUD), with document-level access so that e.g. one editor has access and another does not.
- **Client needs:** List documents (dashboard), get one document, and search (e.g. by content) scoped to what the current user can access.

## Documentation (read in order)

| Doc | Description |
|-----|-------------|
| [01-entities-and-database.md](01-entities-and-database.md) | Entities (BusinessUnit, User, UserBuRole, Document, DocumentShare, DocumentAccess, Template), relationships, and ER diagram. |
| [02-roles-and-permissions.md](02-roles-and-permissions.md) | Roles and who can do what per BU and per document; permission matrix and decision flow. |
| [03-api-design-and-edge-cases.md](03-api-design-and-edge-cases.md) | List, get-one, and search APIs; request/response shapes; edge cases and status codes. |
| [04-templates-and-bu-structure.md](04-templates-and-bu-structure.md) | Template and folder model for BUs; how each BU creates its own documents. |
| [05-strapi-mapping.md](05-strapi-mapping.md) | How this design maps to Strapi later (content types, roles, multi-group patterns). |

## Approach: DB first, then Strapi

1. **Design** — Document entities, roles, APIs, and templates here (no code yet).
2. **Implement** — Build a simple DB (e.g. SQL or Prisma) and access-resolution logic, then List / Get one / Search APIs.
3. **Strapi** — Use [05-strapi-mapping.md](05-strapi-mapping.md) and the existing multi-group backend patterns to implement or adapt in Strapi (document-level access, author, superadmin).

Reference implementation (for patterns only): the **multi-group** project, which uses Group + roleNames + searchContentTypes and creator-based filtering. This design adds document-level sharing and explicit per-document access control.

## Strapi backend

The **backend** folder contains a Strapi 5 app that implements the CM flow: content types (Business Unit, User BU Role, Document, Document Share, Document Access, Template, Folder), admin user extension (businessUnits, isSuperadmin, isAuthor), access-resolution service, and custom list / get-one / search APIs. See [backend/docs/SEED-AND-TESTING.md](backend/docs/SEED-AND-TESTING.md) for how to seed and run the app.

## Testing

To verify all edge cases and flows (list, get-one, search, roles, shared access, DocumentAccess none, superadmin, etc.), use **[EDGE-CASES-AND-FLOWS.md](EDGE-CASES-AND-FLOWS.md)**. It lists each edge case and step-by-step how to check every flow with the Strapi APIs.
# strapi-BUs
