import logger from '../../../../utils/logger';
import { notifyAdminOnSave } from '../../../../utils/notifyAdmin';

export default {
  async afterCreate(event: any) {
    logger.info('Document afterCreate');
    await notifyAdminOnSave('document', event);
  },

  async afterUpdate(event: any) {
    logger.info('Document afterUpdate');

    // Only send when still draft (pattern from mentor)
    if (!event.result.publishedAt) {
      await notifyAdminOnSave('document', event);
    }
  },
};
