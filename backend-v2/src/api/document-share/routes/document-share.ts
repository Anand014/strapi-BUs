/**
 * document-share router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::document-share.document-share', {
  config: {
    find: { auth: false },
    findOne: { auth: false },
  },
});
