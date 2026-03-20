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
      const c = obj.connect as unknown;
      if (Array.isArray(c)) return relationValueToId(c[0]);
      if (typeof c === 'object' && c != null) return relationValueToId((c as any).id);
    }
    if (typeof obj.set !== 'undefined') return relationValueToId(obj.set);
  }
  return null;
}

function formatPublicItem(item: any) {
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    summary: item.summary,
    content: item.content,
    metadata: item.metadata,
    visibility: item.visibility,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    tenant: item.tenant
      ? {
          id: item.tenant.id,
          name: item.tenant.name,
          tenant_key: item.tenant.tenant_key,
          // Back-compat: keep `slug` as an alias for tenant_key.
          slug: item.tenant.tenant_key,
        }
      : undefined,
    product: item.product
      ? {
          id: item.product.id,
          name: item.product.name,
        }
      : undefined,
    category: item.category
      ? {
          id: item.category.id,
          name: item.category.name,
        }
      : undefined,
  };
}

export default factories.createCoreController(
  'api::content-item.content-item',
  ({ strapi }) => ({
    async search(ctx: Context) {
      if (!strapi) {
        ctx.throw(503, 'Service unavailable');
        return;
      }

      const { q, page = 1, pageSize = 25, sort = 'updatedAt:desc' } = ctx.query || {};
      const query = typeof q === 'string' ? q.trim() : '';
      if (!query) {
        ctx.badRequest('Search query "q" is required and must be non-empty');
        return;
      }

      const pageNum = Math.max(1, Number(page) || 1);
      const size = Math.min(100, Math.max(1, Number(pageSize) || 25));

      const [sortField, sortOrder] =
        (typeof sort === 'string' ? sort : 'updatedAt:desc').split(':');
      const sortObj = {
        [sortField || 'updatedAt']: (sortOrder || 'desc').toLowerCase(),
      };

      const textFilter = {
        $or: [
          { title: { $containsi: query } },
          { content: { $containsi: query } },
          { summary: { $containsi: query } },
        ],
      };

      const access = await resolveTenantAccess(strapi, ctx);
      const visibleIds = Array.isArray(access.visibleContentItemIds)
        ? access.visibleContentItemIds
        : [];

      if (visibleIds.length === 0) {
        ctx.body = {
          data: [],
          meta: {
            total: 0,
            authenticated: access.isAuthenticated,
            pagination: {
              page: pageNum,
              pageSize: size,
              pageCount: 1,
            },
          },
        };
        return;
      }

      const filters: any = {};
      filters.$and = [
        textFilter,
        {
          id: {
            $in: visibleIds,
          },
        },
      ];

      const allItems = await strapi.entityService.findMany(
        'api::content-item.content-item',
        {
          filters,
          sort: sortObj,
          populate: ['tenant', 'product', 'category'],
          limit: 1000,
        },
      );

      const list = Array.isArray(allItems) ? allItems : [];
      const total = list.length;
      const start = (pageNum - 1) * size;
      const paginated = list.slice(start, start + size);
      const data = paginated.map(formatPublicItem);

      ctx.body = {
        data,
        meta: {
          total,
          authenticated: access.isAuthenticated,
          pagination: {
            page: pageNum,
            pageSize: size,
            pageCount: Math.ceil(total / size) || 1,
          },
        },
      };
    },

    async find(ctx: Context) {
      if (!strapi) {
        ctx.throw(503, 'Service unavailable');
        return;
      }

      const access = await resolveTenantAccess(strapi, ctx);
      const visibleIds = Array.isArray(access.visibleContentItemIds)
        ? access.visibleContentItemIds
        : [];

      const pageNum = Math.max(
        1,
        Number((ctx.query as any)?.pagination?.page ?? (ctx.query as any)?.page ?? 1) || 1,
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

      const queryFilters = (ctx.query as any)?.filters || {};
      const tenantFilters = { id: { $in: visibleIds } };
      const filters =
        queryFilters && Object.keys(queryFilters).length > 0
          ? { $and: [queryFilters, tenantFilters] }
          : tenantFilters;

      const fetchLimit = Math.min(1000, start + pageSize);
      const allItems = await strapi.entityService.findMany(
        'api::content-item.content-item',
        {
          filters,
          sort: sortObj,
          populate: (ctx.query as any)?.populate ?? [
            'tenant',
            'product',
            'category',
          ],
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
      if (!access.visibleContentItemIds.includes(id)) {
        ctx.notFound('Not found');
        return;
      }

      const item = await strapi.entityService.findOne(
        'api::content-item.content-item',
        id,
        {
          populate: (ctx.query as any)?.populate ?? [
            'tenant',
            'product',
            'category',
            'swagger',
          ],
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
      const payload = ctx.request?.body as any;
      const data = payload?.data ?? payload ?? {};

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

        // Editors/admins can not choose tenant; it is auto-assigned from their login.
        data.tenant = access.tenantId;
      }

      const created = await strapi.entityService.create(
        'api::content-item.content-item',
        { data },
      );
      ctx.body = { data: created };
    },

    async update(ctx: Context) {
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
      const payload = ctx.request?.body as any;
      const data = payload?.data ?? payload ?? {};

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

        // Ensure the tenant stays aligned with the editor/admin's tenant.
        data.tenant = access.tenantId;
      }

      const updated = await strapi.entityService.update(
        'api::content-item.content-item',
        id,
        { data },
      );
      ctx.body = { data: updated };
    },
  }),
);
