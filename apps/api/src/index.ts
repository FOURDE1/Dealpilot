import { relayEmitter } from '@dealpilot/contracts';
import { buildApp } from './app.js';
import { attachRealtime } from './realtime.js';

/**
 * The realtime layer is attached HERE and not in `buildApp`, so that building an
 * app — which sixty test files do — never opens a websocket listener or a Redis
 * connection. It also keeps the dependency one-directional: the API works with
 * no realtime attached, and the emitter its routes hold is simply silent.
 */
const emitter = relayEmitter();
const { app, env, pool, auth, presence } = await buildApp({}, { emitter });

const realtime = await attachRealtime(app, {
  auth,
  pool,
  presence,
  redisUrl: env.REDIS_URL,
  webOrigin: env.WEB_ORIGIN,
});
emitter.pointTo(realtime.emitter);

app.addHook('onClose', async () => {
  await realtime.close();
});

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
