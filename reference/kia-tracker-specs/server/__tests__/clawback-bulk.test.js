describe('Clawback + Bulk Operations', () => {
  it('bulk route exports a router', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const router = require('../routes/bulk');
    expect(typeof router).toBe('function');
  });

  it('clawback route exports a router', () => {
    const router = require('../routes/clawback');
    expect(typeof router).toBe('function');
  });

  it('both routes are registered on the app', () => {
    process.env.PORT = '3099';
    const app = require('../index');
    const paths = [];
    app._router.stack.forEach((layer) => {
      if (layer.name === 'router' && layer.regexp) {
        const match = layer.regexp.source.match(/\\\/api\\\/([a-z-]+)/);
        if (match) paths.push(match[1]);
      }
    });
    expect(paths).toContain('bulk');
    expect(paths).toContain('clawback');
  });
});
