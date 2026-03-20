import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::content-item.content-item', {
  config: {
    find: { auth: false },
    findOne: { auth: false },
  },
});
