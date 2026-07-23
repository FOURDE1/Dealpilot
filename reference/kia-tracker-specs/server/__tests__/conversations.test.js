describe('Conversations (Chatbot)', () => {
  it('conversations route exports a router', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    expect(typeof require('../routes/conversations')).toBe('function');
  });

  it('conversations route is registered on the app', () => {
    process.env.PORT = '3099';
    const app = require('../index');
    const paths = [];
    app._router.stack.forEach((layer) => {
      if (layer.name === 'router' && layer.regexp) {
        const match = layer.regexp.source.match(/\\\/api\\\/([a-z-]+)/);
        if (match) paths.push(match[1]);
      }
    });
    expect(paths).toContain('conversations');
  });
});
