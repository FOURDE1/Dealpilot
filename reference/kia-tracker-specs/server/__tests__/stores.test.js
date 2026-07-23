describe('Stores', () => {
  it('stores route module exports a router', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const storesRouter = require('../routes/stores');
    expect(storesRouter).toBeDefined();
    expect(typeof storesRouter).toBe('function');
  });

  it('stores route is registered on the app', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.PORT = '3099';

    const app = require('../index');
    const registeredPaths = [];

    app._router.stack.forEach((layer) => {
      if (layer.name === 'router' && layer.regexp) {
        const match = layer.regexp.source.match(/\\\/api\\\/(\w+)/);
        if (match) registeredPaths.push(match[1]);
      }
    });

    expect(registeredPaths).toContain('stores');
  });

  it('scopeToStore middleware sets storeId from header', () => {
    const scopeToStore = require('../middleware/scopeToStore');

    const req = {
      headers: { 'x-store-id': 'test-store-123' },
      query: {},
    };
    const res = {};
    const next = vi.fn();

    scopeToStore(req, res, next);

    expect(req.storeId).toBe('test-store-123');
    expect(next).toHaveBeenCalled();
  });

  it('scopeToStore middleware sets storeId from query', () => {
    const scopeToStore = require('../middleware/scopeToStore');

    const req = {
      headers: {},
      query: { store_id: 'query-store-456' },
    };
    const res = {};
    const next = vi.fn();

    scopeToStore(req, res, next);

    expect(req.storeId).toBe('query-store-456');
    expect(next).toHaveBeenCalled();
  });

  it('scopeToStore bypasses for owner role', () => {
    const scopeToStore = require('../middleware/scopeToStore');

    const req = {
      headers: { 'x-store-id': 'should-be-ignored' },
      query: {},
      user: { role: 'owner', store_id: 'user-store' },
    };
    const res = {};
    const next = vi.fn();

    scopeToStore(req, res, next);

    expect(req.storeId).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('scopeToStore sets null when no source available', () => {
    const scopeToStore = require('../middleware/scopeToStore');

    const req = { headers: {}, query: {} };
    const res = {};
    const next = vi.fn();

    scopeToStore(req, res, next);

    expect(req.storeId).toBeNull();
    expect(next).toHaveBeenCalled();
  });
});
