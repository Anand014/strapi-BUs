# Backend-v2 tenant scope - future work

This file tracks follow-up tenant-isolation tasks that are not fully implemented yet.
Later, you can say **work 1** / **work 2** and I’ll pick up exactly that task.

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

