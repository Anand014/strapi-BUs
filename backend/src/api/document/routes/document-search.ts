/**
 * Custom route: GET /api/documents/search
 */
/** @type {import('@strapi/strapi').Core.RouterConfig} */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/search',
      handler: 'document.search',
      config: {
        auth: false,
        policies: ['global::require-admin-user'],
      },
    },
  ],
};
