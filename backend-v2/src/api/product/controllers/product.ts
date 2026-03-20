import type { Context } from 'koa';
import { factories } from '@strapi/strapi';
import { resolveTenantAccess } from '../../../services/tenant-access';
import { resolveAllowedProductIds } from '../../../services/tenant-visible-ids';

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

export default factories.createCoreController('api::product.product', ({ strapi }) => ({
  async find(ctx: Context) {
    if (!strapi) {
      ctx.throw(503, 'Service unavailable');
      return;
    }

    const access = await resolveTenantAccess(strapi, ctx);
    const allowedIds = await resolveAllowedProductIds(strapi, access.visibleContentItemIds);

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
    const tenantFilters = { id: { $in: allowedIds } };
    const filters =
      queryFilters && Object.keys(queryFilters).length > 0
        ? { $and: [queryFilters, tenantFilters] }
        : tenantFilters;

    const fetchLimit = Math.min(1000, start + pageSize);
    const allItems = await strapi.entityService.findMany('api::product.product', {
      filters,
      sort: sortObj,
      limit: fetchLimit,
      populate: (ctx.query as any)?.populate,
    });

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
    const allowedIds = await resolveAllowedProductIds(strapi, access.visibleContentItemIds);

    if (!allowedIds.includes(id)) {
      ctx.notFound('Not found');
      return;
    }

    const item = await strapi.entityService.findOne('api::product.product', id, {
      populate: (ctx.query as any)?.populate,
    });

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

      data.tenant = access.tenantId;
    }

    const created = await strapi.entityService.create(
      'api::product.product',
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

      data.tenant = access.tenantId;
    }

    const updated = await strapi.entityService.update(
      'api::product.product',
      id,
      { data },
    );
    ctx.body = { data: updated };
  },
}));
