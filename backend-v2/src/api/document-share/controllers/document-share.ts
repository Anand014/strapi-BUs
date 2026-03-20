/**
 * document-share controller
 */

import type { Context } from 'koa';
import { factories } from '@strapi/strapi';
import { resolveTenantAccess } from '../../../services/tenant-access';

function relationValueToId(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(value)) {
    return value.length ? relationValueToId(value[0]) : null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id !== 'undefined') return relationValueToId(obj.id);
    if (typeof obj.connect !== 'undefined') {
      // Common Strapi shape: { connect: [ { id } ] } or { connect: { id } }
      const c = obj.connect as unknown;
      if (Array.isArray(c)) return relationValueToId(c[0]);
      if (typeof c === 'object' && c != null) return relationValueToId((c as any).id);
    }
    if (typeof obj.set !== 'undefined') return relationValueToId(obj.set);
  }
  return null;
}

async function resolveAllowedDocumentShareIds(
  strapi: any,
  tenantId: number | null,
): Promise<number[]> {
  // document-shares are tenant-scoped by the tenant relation (link table).
  const conn = strapi.db.connection('document_shares_tenant_lnk');
  const rows =
    tenantId != null
      ? await conn.clone().distinct('document_share_id as id').where('tenant_id', tenantId)
      : await conn.clone().distinct('document_share_id as id');

  return Array.isArray(rows)
    ? rows.map((r: any) => Number(r?.id)).filter((n: number) => Number.isFinite(n))
    : [];
}

async function getContentItemTenantKey(
  strapi: any,
  contentItemId: number,
): Promise<string | null> {
  const row = (await strapi.db.connection('content_items')
    .leftJoin('tenants', 'content_items.tenant_id', 'tenants.id')
    .where('content_items.id', contentItemId)
    .select('tenants.tenant_key as tenant_key')
    .first()) as { tenant_key?: string } | null;

  const k = row?.tenant_key ?? null;
  return typeof k === 'string' && k ? k.toLowerCase() : null;
}

async function getContentItemVisibility(
  strapi: any,
  contentItemId: number,
): Promise<string | null> {
  const row = (await strapi.db.connection('content_items')
    .select('visibility')
    .where('id', contentItemId)
    .first()) as { visibility?: string } | null;

  const v = row?.visibility ?? null;
  return typeof v === 'string' ? v : null;
}

export default factories.createCoreController(
  'api::document-share.document-share',
  ({ strapi }) => ({
    async find(ctx: Context) {
      if (!strapi) {
        ctx.throw(503, 'Service unavailable');
        return;
      }

      const access = await resolveTenantAccess(strapi, ctx);
      if (!access.isAuthenticated) {
        ctx.forbidden('Authentication required');
        return;
      }

      const allowedIds = await resolveAllowedDocumentShareIds(
        strapi,
        access.tenantId,
      );
      if (!allowedIds.length) {
        ctx.body = {
          data: [],
          meta: {
            total: 0,
            authenticated: access.isAuthenticated,
            pagination: { page: 1, pageSize: 25, pageCount: 1 },
          },
        };
        return;
      }

      const pageNum = Math.max(
        1,
        Number(
          (ctx.query as any)?.pagination?.page ??
            (ctx.query as any)?.page ??
            1,
        ) || 1,
      );
      const pageSize = Math.min(
        100,
        Math.max(
          1,
          Number(
            (ctx.query as any)?.pagination?.pageSize ??
              (ctx.query as any)?.pageSize ??
              25,
          ) || 25,
        ),
      );
      const start = (pageNum - 1) * pageSize;

      const sortParam = (ctx.query as any)?.sort ?? 'updatedAt:desc';
      const [sortField, sortOrder] =
        (typeof sortParam === 'string' ? sortParam : 'updatedAt:desc').split(':');
      const sortObj = {
        [sortField || 'updatedAt']: (sortOrder || 'desc').toLowerCase(),
      };

      const filters = { id: { $in: allowedIds } };
      const fetchLimit = Math.min(1000, start + pageSize);
      const allItems = await strapi.entityService.findMany(
        'api::document-share.document-share',
        {
          filters,
          sort: sortObj,
          populate:
            (ctx.query as any)?.populate ?? ['tenant', 'content_item'],
          limit: fetchLimit,
        },
      );

      const list = Array.isArray(allItems) ? allItems : [];
      const total = list.length;
      const paginated = list.slice(start, start + pageSize);

      ctx.body = {
        data: paginated,
        meta: {
          total,
          authenticated: access.isAuthenticated,
          pagination: {
            page: pageNum,
            pageSize,
            pageCount: Math.ceil(total / pageSize) || 1,
          },
        },
      };
    },

    async findOne(ctx: Context) {
      if (!strapi) {
        ctx.throw(503, 'Service unavailable');
        return;
      }

      const idRaw = (ctx.params as any)?.id;
      const id = idRaw != null ? Number(idRaw) : NaN;
      if (!Number.isFinite(id)) {
        ctx.notFound('Not found');
        return;
      }

      const access = await resolveTenantAccess(strapi, ctx);
      if (!access.isAuthenticated) {
        ctx.forbidden('Authentication required');
        return;
      }

      const allowedIds = await resolveAllowedDocumentShareIds(
        strapi,
        access.tenantId,
      );
      if (!allowedIds.includes(id)) {
        ctx.notFound('Not found');
        return;
      }

      const item = await strapi.entityService.findOne(
        'api::document-share.document-share',
        id,
        {
          populate:
            (ctx.query as any)?.populate ?? ['tenant', 'content_item'],
        },
      );

      if (!item) {
        ctx.notFound('Not found');
        return;
      }

      ctx.body = { data: item };
    },

    async create(ctx: Context) {
      if (!strapi) {
        ctx.throw(503, 'Service unavailable');
        return;
      }

      const access = await resolveTenantAccess(strapi, ctx);
      if (!access.isAuthenticated) {
        ctx.forbidden('Authentication required');
        return;
      }

      const payload = ctx.request?.body as any;
      const data = payload?.data ?? payload ?? {};
      const contentItemId = relationValueToId(data?.content_item);
      if (!contentItemId) {
        ctx.badRequest('content_item is required');
        return;
      }

      const contentVisibility = await getContentItemVisibility(
        strapi,
        contentItemId,
      );
      if (contentVisibility !== 'private') {
        ctx.forbidden('Only private content items can be shared');
        return;
      }

      if (!access.isSuperAdmin) {
        if (!access.tenantId) {
          ctx.forbidden('Tenant assignment required');
          return;
        }
        const requestedTenantId = relationValueToId(data?.tenant);
        if (
          requestedTenantId != null &&
          requestedTenantId !== access.tenantId
        ) {
          ctx.forbidden('Tenant cannot be changed');
          return;
        }
        data.tenant = access.tenantId;
      }

      if (!access.isSuperAdmin) {
        const sourceTenantKey = await getContentItemTenantKey(strapi, contentItemId);
        if (!sourceTenantKey || sourceTenantKey !== access.tenantKey) {
          ctx.forbidden('Not allowed to share this content item');
          return;
        }
      }

      const created = await strapi.entityService.create(
        'api::document-share.document-share',
        { data },
      );
      ctx.body = { data: created };
    },

    async update(ctx: Context) {
      if (!strapi) {
        ctx.throw(503, 'Service unavailable');
        return;
      }

      const access = await resolveTenantAccess(strapi, ctx);
      if (!access.isAuthenticated) {
        ctx.forbidden('Authentication required');
        return;
      }

      const shareIdRaw = (ctx.params as any)?.id;
      const shareId = shareIdRaw != null ? Number(shareIdRaw) : NaN;
      if (!Number.isFinite(shareId)) {
        ctx.badRequest('Invalid id');
        return;
      }

      const payload = ctx.request?.body as any;
      const data = payload?.data ?? payload ?? {};

      // Determine which content_item we're effectively assigning.
      const newContentItemId = relationValueToId(data?.content_item);
      const effectiveContentItemId =
        newContentItemId ??
        (await strapi.db.connection('document_shares')
          .where('id', shareId)
          .select('content_item_id')
          .first())?.content_item_id;

      if (!effectiveContentItemId) {
        ctx.notFound('Not found');
        return;
      }

      const contentVisibility = await getContentItemVisibility(
        strapi,
        Number(effectiveContentItemId),
      );
      if (contentVisibility !== 'private') {
        ctx.forbidden('Only private content items can be shared');
        return;
      }

      const effectiveContentItemKey = !access.isSuperAdmin
        ? await getContentItemTenantKey(strapi, Number(effectiveContentItemId))
        : null;

      if (!access.isSuperAdmin) {
        if (
          !effectiveContentItemKey ||
          effectiveContentItemKey !== access.tenantKey
        ) {
          ctx.forbidden('Not allowed to share/update this content item');
          return;
        }

        if (!access.tenantId) {
          ctx.forbidden('Tenant assignment required');
          return;
        }

        const requestedTenantId = relationValueToId(data?.tenant);
        if (
          requestedTenantId != null &&
          requestedTenantId !== access.tenantId
        ) {
          ctx.forbidden('Tenant cannot be changed');
          return;
        }
        data.tenant = access.tenantId;
      }

      const updated = await strapi.entityService.update(
        'api::document-share.document-share',
        shareId,
        { data },
      );
      ctx.body = { data: updated };
    },

    async delete(ctx: Context) {
      if (!strapi) {
        ctx.throw(503, 'Service unavailable');
        return;
      }

      const access = await resolveTenantAccess(strapi, ctx);
      if (!access.isAuthenticated) {
        ctx.forbidden('Authentication required');
        return;
      }

      const shareIdRaw = (ctx.params as any)?.id;
      const shareId = shareIdRaw != null ? Number(shareIdRaw) : NaN;
      if (!Number.isFinite(shareId)) {
        ctx.badRequest('Invalid id');
        return;
      }

      if (!access.isSuperAdmin) {
        const shareRow = (await strapi.db.connection('document_shares')
          .where('id', shareId)
          .select('content_item_id')
          .first()) as { content_item_id?: number } | null;

        const effectiveContentItemId = shareRow?.content_item_id;
        if (!effectiveContentItemId) {
          ctx.notFound('Not found');
          return;
        }

        const sourceTenantKey = await getContentItemTenantKey(
          strapi,
          Number(effectiveContentItemId),
        );
        if (!sourceTenantKey || sourceTenantKey !== access.tenantKey) {
          ctx.forbidden('Not allowed to delete this share');
          return;
        }
      }

      const deleted = await strapi.entityService.delete(
        'api::document-share.document-share',
        shareId,
      );
      ctx.body = { data: deleted };
    },
  }),
);
