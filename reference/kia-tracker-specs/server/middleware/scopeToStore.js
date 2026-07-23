/**
 * scopeToStore middleware
 *
 * Extracts store_id from the request and attaches it to req.storeId.
 * Sources (in priority order):
 * 1. req.headers['x-store-id'] — explicit header
 * 2. req.query.store_id — query parameter
 * 3. req.user.store_id — from authenticated user (after F-005 auth)
 *
 * Owner role bypasses store scoping (sees all stores).
 *
 * Usage in routes:
 *   const storeId = req.storeId; // null means "all stores" (owner)
 *   if (storeId) {
 *     query = query.eq('store_id', storeId);
 *   }
 */
function scopeToStore(req, _res, next) {
  // Check for owner role bypass (after F-005 auth is built)
  if (req.user && req.user.role === 'owner') {
    req.storeId = null; // null = all stores
    return next();
  }

  // Extract store_id from available sources
  const storeId =
    req.headers['x-store-id'] ||
    req.query.store_id ||
    (req.user && req.user.store_id) ||
    null;

  req.storeId = storeId;
  next();
}

module.exports = scopeToStore;
