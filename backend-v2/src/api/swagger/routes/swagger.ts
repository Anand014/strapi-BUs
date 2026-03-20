/**
 * swagger router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::swagger.swagger', {
  config: {
    find: { auth: false },
    findOne: { auth: false },
  },
});
