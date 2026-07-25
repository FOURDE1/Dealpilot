import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { createPool } from '@dealpilot/db';
import { createAuth, type Auth } from './auth.js';
import { loadEnv, type Env } from './env.js';
import { AppError, envelope } from './errors.js';
import { createMailer, type Mailer } from './email.js';
import { registerF01Routes } from './f01-routes.js';
import { registerF02Routes } from './f02-leads-routes.js';
import { registerIntakeKeyRoutes, registerPublicIntakeRoutes } from './f03-intake-routes.js';

/**
 * Dealpilot API (A-05): Fastify 5 skeleton.
 * - pino structured logs with per-request ids (api-security.md: no PII in logs)
 * - canonical error envelope on EVERY non-2xx (api-design.md §8)
 * - deny-by-default auth gate: everything requires a session except the
 *   explicit public allowlist (authentication-authorization.md §Deny-by-default)
 * - Better Auth mounted at /api/auth/* (identity + sessions)
 * Entity CRUD endpoints arrive with their feature slices (D-018), never here.
 */

/**
 * Public routes are matched against the ROUTED pattern (`request.routeOptions.url`),
 * not the raw request target — the router has already normalized/decoded the
 * path by the time onRequest runs, so `/api/auth/../v1/me` can never sneak past
 * the gate. An unmatched route has no routeOptions.url → denied by default.
 */
const PUBLIC_ROUTES: readonly string[] = [
  '/api/v1/health',
  '/api/auth/*',
  // F-03 inbound intake webhook — authenticated by HMAC signature, not a session.
  '/in/v1/leads/:token',
];

/** Fastify-internal error codes → canonical, stable API codes (api-design.md §8). */
const FASTIFY_CODE_MAP: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'validation_failed',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'validation_failed',
  FST_ERR_VALIDATION: 'validation_failed',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
};

async function toWebRequest(request: FastifyRequest, baseUrl: string): Promise<Request> {
  // A-05.1: the origin comes from BETTER_AUTH_URL, never the Host header —
  // a spoofed Host can no longer influence auth-generated URLs.
  const url = new URL(request.url, baseUrl).toString();
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.append(key, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
  }
  const method = request.method;
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : request.body !== undefined && request.body !== null
        ? JSON.stringify(request.body)
        : undefined;
  return new Request(url, { method, headers, body });
}

/** Test seam: swap the mailer without touching transport configuration. */
export interface AppDeps {
  mailer?: Mailer;
}

export async function buildApp(
  envOverrides: Partial<Record<keyof Env, string>> = {},
  deps: AppDeps = {},
) {
  const env = loadEnv(envOverrides);
  const pool = createPool({ connectionString: env.DATABASE_URL });

  // HO-04: a superuser connection silently BYPASSES all RLS (FORCED included).
  // Refuse to boot on one outside tests — tenant isolation must never depend
  // on which URL someone pasted into .env.
  if (env.NODE_ENV !== 'test') {
    const su = await pool.query<{ rolsuper: boolean }>(
      'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
    ).catch(() => null);
    if (su?.rows[0]?.rolsuper) {
      await pool.end();
      throw new Error(
        'Refusing to start: DATABASE_URL connects as a Postgres SUPERUSER, which bypasses row-level security. Use the dealpilot_app role (HO-04).',
      );
    }
  }

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'warn' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: () => randomUUID(),
    disableRequestLogging: env.NODE_ENV === 'test',
  });

  // Mailer needs the app logger, so auth is built after Fastify (A-11).
  const mailer: Mailer = deps.mailer ?? createMailer(env, app.log);
  const auth: Auth = createAuth(env, pool, mailer);

  await app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: true,
    // A-05.1: restrict request headers and cache preflights for a day.
    allowedHeaders: ['content-type', 'authorization'],
    maxAge: 86400,
  });

  // JSON parser that keeps the raw bytes (F-03 intake HMAC signs the exact
  // body). Preserves Fastify's default behavior otherwise; a parse failure
  // reuses the canonical validation_failed mapping.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const req = _req as FastifyRequest & { rawBody?: string };
    req.rawBody = body as string;
    const text = body as string;
    if (!text || text.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('Invalid JSON body') as Error & { statusCode?: number; code?: string };
      err.statusCode = 400;
      err.code = 'FST_ERR_CTP_INVALID_JSON_BODY';
      done(err);
    }
  });

  // --- canonical error envelope everywhere -------------------------------
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const requestId = String(request.id);
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send(envelope(err.apiCode, err.message, requestId, err.details));
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err }, 'unhandled error');
      // Generic message to clients; details stay in logs (CLAUDE.md security).
      return reply.status(500).send(envelope('internal_error', 'Internal server error', requestId));
    }
    const code = (err.code && FASTIFY_CODE_MAP[err.code]) ?? (err.code ? 'bad_request' : 'bad_request');
    const details =
      err.validation?.map((v) => ({
        path: v.instancePath || v.schemaPath,
        code: v.keyword,
        message: v.message ?? 'invalid',
      })) ?? undefined;
    return reply.status(status).send(envelope(code, err.message, requestId, details));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(envelope('not_found', 'Route not found', String(request.id)));
  });

  // --- deny-by-default session gate --------------------------------------
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const routedPath = request.routeOptions.url ?? '';
    if (PUBLIC_ROUTES.includes(routedPath)) return;
    const webReq = await toWebRequest(request, env.BETTER_AUTH_URL);
    const session = await auth.api.getSession({ headers: webReq.headers });
    if (!session) {
      return reply
        .status(401)
        .send(envelope('unauthenticated', 'Authentication required', String(request.id)));
    }
    request.session = session;
  });

  // --- Better Auth mount ---------------------------------------------------
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const response = await auth.handler(await toWebRequest(request, env.BETTER_AUTH_URL));
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') reply.header('set-cookie', value);
        else void reply.header(key, value);
      });
      reply.send(response.body ? await response.text() : null);
    },
  });

  // --- routes --------------------------------------------------------------
  app.get('/api/v1/health', async () => {
    let db = 'down';
    try {
      await pool.query('SELECT 1');
      db = 'up';
    } catch {
      /* reported as down */
    }
    return { status: 'ok', db };
  });

  /** Proves the session gate end-to-end; the web shell's session probe (H-03). */
  app.get('/api/v1/me', async (request) => {
    // Safe: the deny-by-default gate guarantees a session on every non-public route.
    const { user, session } = request.session!;
    return {
      user: { id: user.id, email: user.email, name: user.name },
      session: { expires_at: session.expiresAt },
    };
  });

  registerF01Routes(app, pool);
  registerF02Routes(app, pool);
  registerIntakeKeyRoutes(app, pool, env.BETTER_AUTH_URL);
  registerPublicIntakeRoutes(app, pool);

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return { app, env, pool, auth };
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: Awaited<ReturnType<Auth['api']['getSession']>>;
  }
}
