describe('Auth middleware', () => {
  it('authenticateUser rejects missing Authorization header', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const { authenticateUser } = require('../middleware/auth');

    const req = { headers: {} };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Missing') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('authenticateUser rejects malformed Authorization header', async () => {
    const { authenticateUser } = require('../middleware/auth');

    const req = { headers: { authorization: 'InvalidFormat token123' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('requireRole allows matching role', () => {
    const { requireRole } = require('../middleware/auth');

    const middleware = requireRole('owner', 'gm');
    const req = { user: { role: 'gm' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('requireRole denies non-matching role', () => {
    const { requireRole } = require('../middleware/auth');

    const middleware = requireRole('owner', 'gm');
    const req = { user: { role: 'salesperson' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Insufficient permissions' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('requireRole rejects when no user is set', () => {
    const { requireRole } = require('../middleware/auth');

    const middleware = requireRole('owner');
    const req = {};
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('exports both authenticateUser and requireRole', () => {
    const auth = require('../middleware/auth');
    expect(typeof auth.authenticateUser).toBe('function');
    expect(typeof auth.requireRole).toBe('function');
  });
});
