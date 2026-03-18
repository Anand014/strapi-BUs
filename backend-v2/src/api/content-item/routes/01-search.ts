/**
 * Search route: GET /api/content-items/search?q=... for published content items.
 * Loaded before the core router so /search is not shadowed.
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/content-items/search',
      handler: 'api::content-item.content-item.search',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
