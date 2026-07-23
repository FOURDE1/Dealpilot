// Vitest globals (describe, it, expect) are injected via vitest.config.js globals: true

describe('Server smoke test', () => {
  it('express app exports correctly', () => {
    // Set env vars before requiring app
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.PORT = '3099';

    const app = require('../index');
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
  });

  it('health endpoint is registered', () => {
    const app = require('../index');

    const routes = [];
    app._router.stack.forEach((layer) => {
      if (layer.route) {
        routes.push(layer.route.path);
      }
    });

    expect(routes).toContain('/api/health');
  });
});
