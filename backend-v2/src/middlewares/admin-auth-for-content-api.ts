import type { Core } from '@strapi/strapi';

interface Config {
  pathPrefixes?: string[];
}

/**
 * For selected content-api paths, hydrate `ctx.state.user` from a valid
 * Strapi admin Bearer token/session.
 *
 * These routes should set `auth: false`, then rely on controller logic that
 * checks `ctx.state.user` (via resolveTenantAccess) for authenticated behavior.
 */
export default (config: Config, _opts: { strapi: Core.Strapi }) => {
  const pathPrefixes = config?.pathPrefixes ?? ['/api/content-categories'];

  return async (ctx: any, next: () => Promise<void>) => {
    const path = ctx.path ?? ctx.request?.path ?? '';
    const matches = pathPrefixes.some((prefix: string) => path.startsWith(prefix));
    if (!matches) return next();

    const authHeader = ctx.request?.header?.authorization;
    if (!authHeader || typeof authHeader !== 'string') return next();

    const parts = authHeader.trim().split(/\s+/);
    if (parts[0]?.toLowerCase() !== 'bearer' || parts.length < 2) return next();

    const token = parts[1];
    const strapi = (global as any).strapi as Core.Strapi;
    if (!strapi?.sessionManager) return next();

    try {
      const result = (strapi as any).sessionManager('admin').validateAccessToken(token);
      if (!result?.isValid || !result?.payload) return next();

      const sessionId = result.payload.sessionId ?? result.payload.session_id;
      if (sessionId) {
        const isActive = await (strapi as any)
          .sessionManager('admin')
          .isSessionActive(sessionId);
        if (!isActive) return next();
      }

      const rawUserId =
        result.payload.userId ?? result.payload.id ?? result.payload.sub;
      const userId = Number(rawUserId);
      if (!Number.isFinite(userId)) return next();

      const user = await (strapi as any).db.query('admin::user').findOne({
        where: { id: userId },
        populate: ['roles', 'tenant'],
      });

      if (user?.isActive === true) {
        ctx.state.user = user;
      }
    } catch {
      // ignore and continue as unauthenticated
    }

    return next();
  };
};

