/**
 * Search route: GET /api/documents/search?q=... for published document search.
 * Loaded before core document routes (01- prefix) so /search is not shadowed.
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/search',
      handler: 'api::document.document.search',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
