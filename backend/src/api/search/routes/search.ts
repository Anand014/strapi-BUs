/**
 * Search route: GET /api/search?q=... for published document search.
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/',
      handler: 'api::search.search.search',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
