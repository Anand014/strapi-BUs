import type { Context } from 'koa';
import { factories } from '@strapi/strapi';

async function getUserId(strapi: any, ctx: Context): Promise<number | null> {
  // If Strapi auth middleware ran, user will already be in ctx.state.user
  const user = (ctx.state as any).user;
  if (user) {
    const id = user.id;
    const num = typeof id === 'number' ? id : Number(id);
    return Number.isFinite(num) ? num : null;
  }

  // Otherwise, try to decode a Bearer token from the Authorization header.
  const authHeader =
    (ctx.request.header as any).authorization || (ctx.request.header as any).Authorization;
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  if (!token) return null;

  try {
    const jwtService = (strapi as any).plugin?.('users-permissions')?.service('jwt');
    if (!jwtService?.verify) return null;
    const decoded: any = await jwtService.verify(token);
    const id = decoded?.id ?? decoded?.userId ?? decoded?.sub;
    const num = typeof id === 'number' ? id : Number(id);
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
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
          slug: item.tenant.slug,
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

      const { q, tenant, page = 1, pageSize = 25, sort = 'updatedAt:desc' } =
        ctx.query || {};
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

      const userId = await getUserId(strapi, ctx);
      const isAuthenticated = Boolean(userId);

      const filters: any = {};
      if (!isAuthenticated) {
        filters.visibility = 'public';
      }

      filters.$and = [textFilter];
      if (typeof tenant === 'string' && tenant.trim()) {
        filters.$and.push({ tenant: { slug: tenant.trim().toLowerCase() } });
      }

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
          authenticated: isAuthenticated,
          pagination: {
            page: pageNum,
            pageSize: size,
            pageCount: Math.ceil(total / size) || 1,
          },
        },
      };
    },
  }),
);
