import path from 'node:path';
export default {
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  turbopack: { root: path.resolve(import.meta.dirname) },
};
