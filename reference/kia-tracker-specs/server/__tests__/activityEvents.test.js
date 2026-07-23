describe('Activity Events', () => {
  it('activityLogger exports logActivity function', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const { logActivity } = require('../middleware/activityLogger');
    expect(typeof logActivity).toBe('function');
  });

  it('activityEvents route exports a router', () => {
    const router = require('../routes/activityEvents');
    expect(typeof router).toBe('function');
  });

  it('activityEvents route is registered on the app', () => {
    process.env.PORT = '3099';
    const app = require('../index');
    const paths = [];
    app._router.stack.forEach((layer) => {
      if (layer.name === 'router' && layer.regexp) {
        const match = layer.regexp.source.match(/\\\/api\\\/([a-z-]+)/);
        if (match) paths.push(match[1]);
      }
    });
    expect(paths).toContain('activity-events');
  });
});
