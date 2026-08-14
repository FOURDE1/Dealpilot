import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_EVENT,
  REALTIME_SUBSCRIBE,
  type RealtimeEventT,
  type SubscribeRequestT,
  type SubscribeResultT,
} from '@dealpilot/contracts';

/**
 * The browser end of realtime (api-design.md §13, ADR-004).
 *
 * Two things this deliberately does not do:
 *
 *  - It never names a room. It sends the same structured request the server
 *    validates, and the server decides. §13: "The SPA never emits to data
 *    rooms" — the only thing sent from here is a subscription ASKING.
 *  - It never patches the query cache with event data. An event says something
 *    changed; the fetch that follows is the one that decides what the screen
 *    shows. Trusting a websocket payload to be the new truth means two code
 *    paths can disagree about what a conversation contains, and the one that
 *    wins is whichever raced last.
 *
 * Relative connection, like every REST call in this app: same origin in
 * development through the Vite proxy, same origin in production through the
 * CDN behaviour that already forwards /api.
 */

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/realtime',
      // The session cookie rides the upgrade request; there is no token in a
      // query string to end up in a proxy log.
      withCredentials: true,
      // A dropped connection retries with backoff. Nothing is lost when it
      // does: the queries refetch on reconnect and the screen catches up.
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
  }
  return socket;
}

/** Close the shared socket. For sign-out and for tests. */
export function closeRealtime(): void {
  socket?.close();
  socket = null;
}

/**
 * Subscribe while mounted, and run `onEvent` for anything that arrives.
 *
 * Pass `null` to subscribe to nothing — the conversation pane does this before
 * a conversation is chosen, which is most of the time on first paint.
 */
export function useRealtime(
  request: SubscribeRequestT | null,
  onEvent: (event: RealtimeEventT) => void,
): void {
  // The request is an object rebuilt every render; comparing it by value keeps
  // the effect from resubscribing on every keystroke elsewhere on the page.
  const key = request ? JSON.stringify(request) : null;

  // The handler behind a ref, so the subscription survives a re-render while
  // still calling the CURRENT callback. Capturing it in the effect closure
  // instead gives the bug that looks like realtime half-working: the first
  // event updates the screen and every later one is delivered to a callback
  // holding last render's state.
  const latest = useRef(onEvent);
  latest.current = onEvent;

  useEffect(() => {
    if (!key) return;
    const req = JSON.parse(key) as SubscribeRequestT;
    const s = getSocket();
    let cancelled = false;

    const handler = (event: RealtimeEventT) => {
      if (cancelled) return;
      latest.current(event);
    };

    const subscribe = () => {
      s.emit(REALTIME_SUBSCRIBE, req, (res: SubscribeResultT) => {
        // A refusal is not an error to show. The screen already reflects what
        // this person may see — the REST call behind it answered the same
        // question — so a refused stream means live updates are off, not that
        // anything is broken.
        if (!res.ok && import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- dev-only diagnostics
          console.warn('[realtime] subscription refused:', res.reason);
        }
      });
    };

    s.on(REALTIME_EVENT, handler);
    // Resubscribe after a reconnect: rooms live on the connection, so a new
    // connection has joined nothing.
    s.on('connect', subscribe);
    if (s.connected) subscribe();

    return () => {
      cancelled = true;
      s.off(REALTIME_EVENT, handler);
      s.off('connect', subscribe);
    };
    // Only `key`: `onEvent` is read through the ref above, so an inline
    // closure from the caller never tears the subscription down.
  }, [key]);
}
