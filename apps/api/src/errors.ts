import type { ZodError } from 'zod';
import type { ErrorEnvelopeT } from '@dealpilot/schemas';

/**
 * Canonical error envelope helpers (api-design.md §8). Route code throws
 * AppError with a STABLE machine code; the central error handler in app.ts
 * turns it into the envelope. Anything else that reaches the handler is a bug
 * and comes out as a generic 500.
 */

export type ErrorDetail = { path?: string; code: string; message: string };

export function envelope(
  code: string,
  message: string,
  requestId: string,
  details?: ErrorDetail[],
): ErrorEnvelopeT {
  return { error: { code, message, ...(details ? { details } : {}), request_id: requestId } };
}

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly apiCode: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = () => new AppError(404, 'not_found', 'Not found');
export const forbidden = () => new AppError(403, 'forbidden', 'Insufficient role for this action');

/** Zod boundary parse → 422 validation_failed with per-field details. */
export function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: ZodError } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      code: i.code,
      message: i.message,
    }));
    throw new AppError(422, 'validation_failed', 'Request failed validation', details);
  }
  return result.data;
}
