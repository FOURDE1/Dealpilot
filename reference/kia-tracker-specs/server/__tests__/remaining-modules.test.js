describe('Remaining Module Routes (M-004 through M-011)', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.PORT = '3099';
  });

  it('documents route exports a router', () => {
    expect(typeof require('../routes/documents')).toBe('function');
  });

  it('lenders route exports a router', () => {
    expect(typeof require('../routes/lenders')).toBe('function');
  });

  it('wholesale route exports a router', () => {
    expect(typeof require('../routes/wholesale')).toBe('function');
  });

  it('automationRules route exports a router', () => {
    expect(typeof require('../routes/automationRules')).toBe('function');
  });

  it('all new routes are registered on the app', () => {
    const app = require('../index');
    const paths = [];
    app._router.stack.forEach((layer) => {
      if (layer.name === 'router' && layer.regexp) {
        const match = layer.regexp.source.match(/\\\/api\\\/([a-z-]+)/);
        if (match) paths.push(match[1]);
      }
    });

    expect(paths).toContain('documents');
    expect(paths).toContain('lenders');
    expect(paths).toContain('wholesale');
    expect(paths).toContain('automation-rules');
  });
});
