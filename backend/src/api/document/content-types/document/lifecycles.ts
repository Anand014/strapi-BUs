/**
 * Document content-type lifecycle hooks.
 *
 * NOTE: Email notifications are NOT triggered here anymore.
 * They are handled by the content-manager controller extension
 * (src/extensions/content-manager/strapi-server.ts) which has
 * access to ctx.state.user — needed to identify the acting user's BU.
 *
 * These hooks are kept for logging/debugging purposes only.
 */
import logger from '../../../../utils/logger';

export default {
  async afterCreate(event: any) {
    logger.info(`Document afterCreate: ${event.result?.title || event.result?.id}`);
  },

  async afterUpdate(event: any) {
    logger.info(`Document afterUpdate: ${event.result?.title || event.result?.id}`);
  },
};
