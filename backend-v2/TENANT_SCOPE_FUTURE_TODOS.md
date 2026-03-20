# Backend-v2 tenant scope - future work

This file tracks follow-up tenant-isolation tasks that are not fully implemented yet.
Later, you can say **work 1**–**work 5** (or a specific number) and I’ll pick up exactly that task.

## Work 1: Tenant-scope `tags` and `versions`
### Goal
TFB users should only see:
- `tag` records that are linked to **tenant-visible** `content-items`
- `version` records that belong to **tenant-visible** `content-items`

### Expected behavior
- Relation dropdowns on the `content-item` form (`tags`, `current_version`) should only list tenant-visible options.
- Direct API calls for `GET /api/tags`, `GET /api/versions`, and `GET /api/tags/:id`, `GET /api/versions/:id` should be tenant-scoped server-side.

### Implementation notes (server-side)
- Derive `allowedTagIds` / `allowedVersionIds` from the tenant’s `visibleContentItemIds` set:
  - `tag` is allowed if it is connected to at least one allowed `content-item`
  - `version` is allowed if its `content_item` is in the allowed set

## Work 2: Restrict `document-share` by target tenant (TFB-only)
### Goal
When a TFB admin/editor logs in:
- they can **only see** `document-share` records where `document-share.tenant` == their tenant
- they can **only create/update** shares whose `tenant` target equals their tenant

### Expected behavior
- `GET /api/document-shares` and `GET /api/document-shares/:id` are tenant-scoped by the `document-share.tenant` relation for non-superadmins.
- Non-superadmins cannot create/update a share with `tenant` pointing to another tenant.

### Implementation notes (server-side)
- Extend `document-share` controller:
  - enforce on `create`/`update` that `data.tenant` (target tenant) matches `access.tenantKey` for non-superadmins
  - tenant-scope `find`/`findOne` for non-superadmins by filtering `document_shares.tenant_id`

## Work 3: Require tenant before inviting people
### Goal
Users must create/select their tenant before they can invite other people.

### Expected behavior
- Invite endpoints should fail (or redirect) when the inviter has no tenant context yet.
- The invite flow should not allow targeting a tenant that the inviter has not established/been assigned.

### Implementation notes
- Add/verify server-side guard(s) in the invite/create endpoints to require `access.tenantKey` (or equivalent tenant context) before proceeding.

## Work 4: Tenant key for unauthenticated requests
### Goal
When a request has **no auth** (no user/session/API token), callers should still be able to scope data to a tenant by passing an explicit **tenant key** (e.g. query param or header), so public or anonymous clients receive the correct tenant’s data instead of everything or nothing.

### Expected behavior
- Unauthenticated `GET` (and any other relevant) endpoints that are tenant-scoped for logged-in users should accept a tenant key when there is no auth and resolve tenant context from it.
- Reject or ignore invalid/missing tenant keys according to product rules (e.g. 400 vs empty list).

### Implementation notes
- Align with existing tenant resolution: same precedence as authenticated flows where possible (`X-Tenant-Key`, query param, etc. — match `tenant-access` / middleware conventions).
- Document which routes support anonymous + tenant key vs require auth.

## Work 5: Tenant-scope relation field dropdowns (admin UI)
### Goal
When picking a **relation** in the admin (e.g. creating **content category** and selecting **content item**), the dropdown / search should list **only records tied to the current user’s tenant**. **Super admins** see the full set (all tenants).

### Expected behavior
- Non-superadmin: relation pickers for tenant-owned entities only show targets that belong to that user’s tenant (same rules as `visibleContentItemIds` / tenant-access where applicable).
- Superadmin: no tenant filter on these lists (or optional “all tenants” behavior if you add a toggle later).
- Applies broadly to relation fields that cross tenant boundaries — not only content category → content item; implement consistently for other relations that need isolation.

### Implementation notes
- Usually enforced via **Content API / admin list** queries filtered by tenant (Strapi entity service or custom controllers) and/or **content-manager** extensions that pass tenant context into relation queries.
- Mirror server-side rules so direct API calls cannot list other tenants’ records for relation resolution.

