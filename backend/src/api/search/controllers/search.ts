/**
 * Search controller: full-text search over published documents with access resolution.
 */
import type { Context } from 'koa';
import type { Core } from '@strapi/strapi';
import { getAccessibleDocumentIds } from '../../../services/access-resolution';
import {
  resolveDocumentIds,
  formatPublicDocument,
  formatDocumentWithMeta,
  getUserId,
} from '../../document/controllers/document';

const docApi = (strapi: Core.Strapi) => (uid: string) =>
  (strapi as any).documents(uid);

export default {
  async search(ctx: Context) {
    const strapi = (global as any).strapi as Core.Strapi;
    if (!strapi) {
      ctx.throw(503, 'Service unavailable');
      return;
    }

    const { q, bu, page = 1, pageSize = 25, sort = 'updatedAt:desc' } = ctx.query || {};
    const query = typeof q === 'string' ? q.trim() : '';
    if (!query) {
      ctx.badRequest('Search query "q" is required and must be non-empty');
      return;
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const buSlug = typeof bu === 'string' ? bu.trim().toLowerCase() : '';

    const [sortField, sortOrder] = (
      typeof sort === 'string' ? sort : 'updatedAt:desc'
    ).split(':');
    const sortObj = {
      [sortField || 'updatedAt']: (sortOrder || 'desc').toLowerCase(),
    };

    const textFilter = {
      $or: [
        { title: { $containsi: query } },
        { content: { $containsi: query } },
      ],
    };

    const userId = getUserId(ctx);

    // Unauthenticated: only published public documents
    if (!userId) {
      const filters: any = { isPublic: true, ...textFilter };
      if (buSlug) filters.ownerBu = { slug: buSlug };
      const allDocs = await docApi(strapi)('api::document.document').findMany({
        filters,
        status: 'published',
        sort: sortObj,
        limit: 1000,
      } as any);
      const list = Array.isArray(allDocs) ? allDocs : [];
      const total = list.length;
      const start = (pageNum - 1) * size;
      const paginated = list.slice(start, start + size);
      const data = paginated.map((d: any) => formatPublicDocument(d));
      ctx.body = {
        data,
        meta: {
          total,
          pagination: {
            page: pageNum,
            pageSize: size,
            pageCount: Math.ceil(total / size) || 1,
          },
        },
      };
      return;
    }

    // Authenticated: scope to accessible published docs
    const accessibleIds = await getAccessibleDocumentIds(strapi, userId);
    if (accessibleIds.length === 0) {
      ctx.body = {
        data: [],
        meta: {
          total: 0,
          pagination: { page: pageNum, pageSize: size, pageCount: 0 },
        },
      };
      return;
    }

    const documentIds = await resolveDocumentIds(strapi, accessibleIds);
    if (documentIds.length === 0) {
      ctx.body = {
        data: [],
        meta: {
          total: 0,
          pagination: { page: pageNum, pageSize: size, pageCount: 0 },
        },
      };
      return;
    }

    const filters: any = {
      $and: [
        { documentId: { $in: documentIds } },
        textFilter,
      ],
    };
    if (buSlug) filters.$and.push({ ownerBu: { slug: buSlug } });

    const allDocs = await docApi(strapi)('api::document.document').findMany({
      filters,
      status: 'published',
      sort: sortObj,
      populate: ['ownerBu'],
      limit: 1000,
    } as any);
    const list = Array.isArray(allDocs) ? allDocs : [];
    const total = list.length;
    const start = (pageNum - 1) * size;
    const paginated = list.slice(start, start + size);
    const data = await Promise.all(
      paginated.map((d: any) => formatDocumentWithMeta(strapi, d, userId))
    );

    ctx.body = {
      data,
      meta: {
        total,
        pagination: {
          page: pageNum,
          pageSize: size,
          pageCount: Math.ceil(total / size) || 1,
        },
      },
    };
  },
};
