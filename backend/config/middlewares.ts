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
    name: 'global::admin-auth-for-documents',
    config: {
      pathPrefixes: ['/api/documents', '/api/search'],
    },
  },
  'strapi::favicon',
  'strapi::public',
];

export default config;
