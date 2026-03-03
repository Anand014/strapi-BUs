'use strict';

/**
 * src/extensions/admin/strapi-server.js
 *
 * NOTE: In Strapi v5, @strapi/admin is NOT registered as a plugin
 * (its package.json has no `strapi.kind: "plugin"`), so this file is
 * NEVER called by the extension loader.
 *
 * All admin customisations (schema, controller, routes) are done in
 * src/index.js instead, where they are guaranteed to run.
 */

module.exports = (plugin) => {
  return plugin;
};
