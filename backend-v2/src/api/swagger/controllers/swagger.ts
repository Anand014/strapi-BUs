/**
 * swagger controller
 */

import type { Context } from 'koa';
import { factories } from '@strapi/strapi';
import { resolveTenantAccess } from '../../../services/tenant-access';
import { resolveAllowedSwaggerIds } from '../../../services/tenant-visible-ids';

async function resolveTenantOwnedSwaggerIds(
  strapi: any,
  tenantId: number | null,
): Promise<number[]> {
  if (tenantId == null) return [];
  const rows = await strapi.db
    .connection('swaggers_tenant_lnk')
    .distinct('swagger_id as id')
    .where('tenant_id', tenantId);
  return Array.isArray(rows)
    ? rows
        .map((r: any) => Number(r?.id))
        .filter((n: number) => Number.isFinite(n))
    : [];
}

export default factories.createCoreController('api::swagger.swagger', ({ strapi }) => ({
  async find(ctx: Context) {
    if (!strapi) {
      ctx.throw(503, 'Service unavailable');
      return;
    }

    const access = await resolveTenantAccess(strapi, ctx);
    const linkedIds = await resolveAllowedSwaggerIds(strapi, access.visibleContentItemIds);
    const tenantOwnedIds = await resolveTenantOwnedSwaggerIds(strapi, access.tenantId);
    const allowedIds = Array.from(new Set<number>([...linkedIds, ...tenantOwnedIds]));

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
    const allItems = await strapi.entityService.findMany('api::swagger.swagger', {
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
    const linkedIds = await resolveAllowedSwaggerIds(strapi, access.visibleContentItemIds);
    const tenantOwnedIds = await resolveTenantOwnedSwaggerIds(strapi, access.tenantId);
    const allowedIds = Array.from(new Set<number>([...linkedIds, ...tenantOwnedIds]));

    if (!allowedIds.includes(id)) {
      ctx.notFound('Not found');
      return;
    }

    const item = await strapi.entityService.findOne('api::swagger.swagger', id, {
      populate: (ctx.query as any)?.populate,
    });

    if (!item) {
      ctx.notFound('Not found');
      return;
    }

    ctx.body = { data: item };
  },
}));
