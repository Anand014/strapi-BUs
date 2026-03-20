import { factories } from '@strapi/strapi';

export default factories.createCoreRouter(
  'api::content-category.content-category',
  {
    config: {
      find: { auth: false },
      findOne: { auth: false },
    },
  },
);
