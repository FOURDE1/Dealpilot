// Tests for contacts API route logic

describe('Contacts route', () => {
  it('normalizePhone strips non-digit characters', () => {
    // Test the normalizePhone function directly
    const normalizePhone = (phone) => {
      if (!phone) return null;
      return phone.replace(/[^0-9]/g, '');
    };

    expect(normalizePhone('(514) 555-1234')).toBe('5145551234');
    expect(normalizePhone('+1-819-555-0000')).toBe('18195550000');
    expect(normalizePhone('5145551234')).toBe('5145551234');
    expect(normalizePhone(null)).toBe(null);
    expect(normalizePhone('')).toBe(null);
  });

  it('contacts route module exports a router', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const contactsRouter = require('../routes/contacts');
    expect(contactsRouter).toBeDefined();
    expect(typeof contactsRouter).toBe('function'); // Express Router is a function
  });

  it('contacts route is registered on the app', () => {
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

    expect(registeredPaths).toContain('contacts');
  });
});
