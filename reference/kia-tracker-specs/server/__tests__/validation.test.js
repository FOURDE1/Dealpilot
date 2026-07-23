const {
  createContactSchema,
  createAccountSchema,
  vinSchema,
} = require('../schemas');

describe('Zod validation schemas', () => {
  describe('createContactSchema', () => {
    it('accepts valid contact', () => {
      const result = createContactSchema.safeParse({
        first_name: 'Jean',
        last_name: 'Tremblay',
        email: 'jean@example.com',
        phone: '(514) 555-1234',
        preferred_language: 'fr',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing first_name', () => {
      const result = createContactSchema.safeParse({
        last_name: 'Tremblay',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('first_name');
    });

    it('rejects invalid email', () => {
      const result = createContactSchema.safeParse({
        first_name: 'Jean',
        last_name: 'Tremblay',
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });

    it('defaults preferred_language to fr', () => {
      const result = createContactSchema.safeParse({
        first_name: 'Jean',
        last_name: 'Tremblay',
      });
      expect(result.success).toBe(true);
      expect(result.data.preferred_language).toBe('fr');
    });
  });

  describe('VIN validation', () => {
    it('accepts valid 17-char VIN', () => {
      const result = vinSchema.safeParse('1HGBH41JXMN109186');
      expect(result.success).toBe(true);
    });

    it('rejects VIN with I, O, or Q', () => {
      const result = vinSchema.safeParse('1HGBH41IOXMN10918');
      expect(result.success).toBe(false);
    });

    it('rejects VIN that is not 17 chars', () => {
      const result = vinSchema.safeParse('1HGBH41J');
      expect(result.success).toBe(false);
    });

    it('accepts null/undefined', () => {
      expect(vinSchema.safeParse(null).success).toBe(true);
      expect(vinSchema.safeParse(undefined).success).toBe(true);
    });
  });

  describe('createAccountSchema', () => {
    it('accepts valid account', () => {
      const result = createAccountSchema.safeParse({
        name: 'Hassan',
        email: 'hassan@example.com',
        password: 'SecurePass123',
        role: 'owner',
      });
      expect(result.success).toBe(true);
    });

    it('rejects password under 8 chars', () => {
      const result = createAccountSchema.safeParse({
        name: 'Test',
        email: 'test@test.com',
        password: 'short',
        role: 'salesperson',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid role', () => {
      const result = createAccountSchema.safeParse({
        name: 'Test',
        email: 'test@test.com',
        password: 'LongEnough123',
        role: 'superadmin',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('validate middleware', () => {
    it('passes valid data to next()', () => {
      const validate = require('../middleware/validate');
      const middleware = validate(createContactSchema);

      const req = {
        body: { first_name: 'Jean', last_name: 'Tremblay' },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.preferred_language).toBe('fr'); // Default applied
    });

    it('returns 400 for invalid data', () => {
      const validate = require('../middleware/validate');
      const middleware = validate(createContactSchema);

      const req = {
        body: { first_name: '' }, // missing last_name, empty first_name
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Validation failed' })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});
