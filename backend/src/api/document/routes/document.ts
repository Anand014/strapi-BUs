/**
 * Document routes: find (list) and findOne use custom controller with access resolution.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::document.document', {
  only: ['find', 'findOne'],
  config: {
    find: { auth: false, policies: ['global::require-admin-user'] },
    findOne: { auth: false, policies: ['global::require-admin-user'] },
  },
});
