const { z } = require('zod');

/**
 * validate(schema) middleware factory
 *
 * Validates req.body against a Zod schema.
 * Returns 400 with user-friendly error messages on failure.
 *
 * Usage: router.post('/', validate(createContactSchema), handler)
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req.body);
      req.body = parsed; // Replace with cleaned/transformed data
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors = err.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({
          error: 'Validation failed',
          details: errors,
        });
      }
      next(err);
    }
  };
}

module.exports = validate;
