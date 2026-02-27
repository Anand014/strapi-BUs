/**
 * Policy: require ctx.state.user (admin user). Use for document list/get-one/search.
 * Throws UnauthorizedError so the framework can respond with 401 (policy context
 * does not receive delegated Koa response helpers like ctx.unauthorized).
 */
import type { Context } from 'koa';
import { errors } from '@strapi/utils';

export default (ctx: Context) => {
  if (!(ctx.state as any).user) {
    throw new errors.UnauthorizedError('Authentication required');
  }
};
