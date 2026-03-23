import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  {
    name: 'global::admin-auth-for-content-api',
    config: {
      pathPrefixes: [
        '/api/content-categories',
        '/api/content-items',
        '/api/navigation-items',
        '/api/products',
        '/api/swaggers',
        '/api/document-shares',
      ],
    },
  },
  'strapi::favicon',
  'strapi::public',
];

export default config;
