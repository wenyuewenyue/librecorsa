/**
 * Self-hosted WebRTC signaling relay for the simulator's room-code mode.
 *
 * Replaces the public PeerJS broker (wss://0.peerjs.com) when the site is
 * built with NEXT_PUBLIC_SIGNAL_URL. It is a relay only: it never sees media
 * or game state, it only forwards signaling messages between the two peers
 * of one room, and it holds no TURN credentials and no secrets.
 *
 * Route: GET /signal/<6-char room code>?role=host|guest  (WebSocket upgrade)
 * Route: GET /turn — mints short-lived Cloudflare TURN credentials
 *   (turns:443 only) for the game client. The TURN key id and API token
 *   are Worker secrets (wrangler secret put), never values in this file;
 *   while they are unset the endpoint returns 503 and the client falls
 *   back to its static TURN servers, so the game still works.
 * Message shape (same as the existing PeerJS path, so the client reuses its
 * OFFER/ANSWER/CANDIDATE handling unchanged):
 *   { type: 'OFFER' | 'ANSWER' | 'CANDIDATE', dst: <role>, payload: {...} }
 * The relay rewrites `src` to the sender's role ('host' | 'guest') and
 * forwards to the other role. On connect it sends { type: 'OPEN' }, which is
 * exactly the message the client's host/guest handlers already wait for.
 *
 * Room model: one Durable Object instance per room code, at most one host
 * and one guest. A message for a not-yet-connected peer is buffered
 * (in memory, capped) and flushed in order when that peer connects, so a
 * guest offer sent before the host socket exists is not lost. When a socket
 * closes, its role slot frees up; when both slots are empty, an alarm fires
 * after the idle timeout and the room state is cleared.
 *
 * Security model: the same as the PeerJS room-code model it replaces. The
 * 6-character code is the only room key: anyone who knows a code can join
 * that room as host or guest, and there is no login. Do not use this relay
 * for anything where a room code must stay private.
 *
 * Self-contained: the minimal Worker / Durable Object types are declared
 * here, no workers-types dependency (same pattern as leaderboard-worker).
 */

type Role = 'host' | 'guest';

/**
 * Cloudflare Workers runtime globals, declared minimally here (the site
 * tsconfig has no workers-types dependency). The Response `webSocket`
 * init field is a Workers extension to the DOM ResponseInit type.
 */
declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };
type WebSocketResponseInit = ResponseInit & { webSocket?: WebSocket };

interface DurableObjectStateLike {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  storage: {
    setAlarm(scheduledTime: number | Date): Promise<void>;
  };
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface Env {
  SIGNAL_ROOM: DurableObjectNamespaceLike;
  /** Cloudflare TURN key uid; set with `wrangler secret put TURN_KEY_ID`. */
  TURN_KEY_ID?: string;
  /** Dedicated API token with Calls permission; `wrangler secret put TURN_API_TOKEN`. */
  TURN_API_TOKEN?: string;
}

/** Origins allowed to call /turn: the two game domains only, never "*". */
const GAME_ORIGINS = new Set([
  'https://librecorsa.pages.dev',
  'https://wysaiche.2221314.xyz',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && GAME_ORIGINS.has(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
  }
  return {};
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

/** GET /turn: mint Cloudflare TURN credentials, turns:443 only. */
async function handleTurn(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    if (!origin || !GAME_ORIGINS.has(origin)) return new Response('Forbidden', { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if (origin && !GAME_ORIGINS.has(origin)) return new Response('Forbidden', { status: 403 });
  const keyId = env.TURN_KEY_ID?.trim();
  const token = env.TURN_API_TOKEN?.trim();
  if (!keyId || !token) return jsonResponse({ error: 'turn_not_configured' }, 503, origin);
  let upstream: Response;
  try {
    upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );
  } catch {
    return jsonResponse({ error: 'turn_mint_failed', upstream_status: 0 }, 502, origin);
  }
  if (!upstream.ok) return jsonResponse({ error: 'turn_mint_failed', upstream_status: upstream.status }, 502, origin);
  let data: { iceServers?: unknown };
  try {
    data = (await upstream.json()) as { iceServers?: unknown };
  } catch {
    return jsonResponse({ error: 'turn_mint_failed', upstream_status: upstream.status }, 502, origin);
  }
  if (!Array.isArray(data.iceServers)) return jsonResponse({ error: 'turn_mint_failed', upstream_status: upstream.status }, 502, origin);
  const servers: { urls: string[]; username?: string; credential?: string }[] = [];
  for (const item of data.iceServers) {
    if (!item || typeof item !== 'object') continue;
    const v = item as { urls?: unknown; username?: unknown; credential?: unknown };
    const urls = Array.isArray(v.urls)
      ? v.urls.filter((u): u is string => typeof u === 'string' && /^turns:/i.test(u) && /:443(\?|$)/.test(u))
      : typeof v.urls === 'string' && /^turns:/i.test(v.urls) && /:443(\?|$)/.test(v.urls)
        ? [v.urls]
        : [];
    if (urls.length === 0) continue;
    servers.push({
      urls,
      username: typeof v.username === 'string' ? v.username : undefined,
      credential: typeof v.credential === 'string' ? v.credential : undefined,
    });
  }
  if (servers.length === 0) return jsonResponse({ error: 'turn_mint_failed', upstream_status: upstream.status }, 502, origin);
  return jsonResponse({ iceServers: servers, ttl: 3600 }, 200, origin);
}

const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
const FORWARDABLE = new Set(['OFFER', 'ANSWER', 'CANDIDATE']);
/** SDP + candidates are a few KB each; anything larger is not signaling. */
const MAX_MESSAGE_BYTES = 64 * 1024;
/** Buffered messages per absent peer; offer + trickle candidates fit easily. */
const MAX_PENDING = 50;
/** Room with no activity for this long is cleared by the alarm. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function otherRole(role: Role): Role {
  return role === 'host' ? 'guest' : 'host';
}

export class SignalRoom {
  private ctx: DurableObjectStateLike;
  /** Messages buffered for a peer that has not connected yet, per role. */
  private pending: Record<Role, string[]> = { host: [], guest: [] };
  private lastActivityMs = Date.now();

  constructor(ctx: DurableObjectStateLike) {
    this.ctx = ctx;
  }

  private touch(): void {
    this.lastActivityMs = Date.now();
    // Best effort: an alarm that finds an empty room clears it; an alarm
    // that finds an active room just reschedules itself (see alarm()).
    void this.ctx.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS).catch(() => undefined);
  }

  private peerSocket(role: Role): WebSocket | null {
    const sockets = this.ctx.getWebSockets(role);
    return sockets.length > 0 ? sockets[0] : null;
  }

  private send(ws: WebSocket, text: string): void {
    try {
      ws.send(text);
    } catch {
      // A closing socket is cleaned up by webSocketClose; nothing to do here.
    }
  }

  private flushPending(role: Role): void {
    const ws = this.peerSocket(role);
    if (!ws) return;
    const queued = this.pending[role];
    this.pending[role] = [];
    for (const text of queued) this.send(ws, text);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 400 });
    }
    const roleParam = url.searchParams.get('role');
    if (roleParam !== 'host' && roleParam !== 'guest') {
      return new Response('Missing or invalid role (host|guest)', { status: 400 });
    }
    const role = roleParam as Role;
    if (this.peerSocket(role)) {
      // One socket per role: a second host/guest gets a clear error and a
      // close, instead of silently taking over (or shadowing) the first.
      const pair = new WebSocketPair();
      const server = pair[1];
      // Tagged 'rejected' only, never as the role: it can neither occupy
      // the role slot nor inject messages (webSocketMessage ignores it).
      this.ctx.acceptWebSocket(server, ['rejected']);
      this.send(server, JSON.stringify({ type: 'ERROR', error: 'room_full' }));
      try {
        server.close(1008, 'role already connected');
      } catch {
        // Already closed; nothing to do.
      }
      return new Response(null, { status: 101, webSocket: pair[0] } as WebSocketResponseInit);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);
    this.touch();
    // OPEN first, then any messages buffered while this peer was absent:
    // this matches the PeerJS flow, where OPEN is what makes the guest
    // create its offer and the host report the room as ready.
    this.send(server, JSON.stringify({ type: 'OPEN', role }));
    this.flushPending(role);
    return new Response(null, { status: 101, webSocket: client } as WebSocketResponseInit);
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.touch();
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (text.length > MAX_MESSAGE_BYTES) {
      try {
        ws.close(1009, 'message too large');
      } catch {
        // Already closed; nothing to do.
      }
      return;
    }
    // Identify the sender by its tag; a socket that is not tagged as a room
    // role (e.g. a rejected duplicate) must not be able to inject messages.
    const role: Role | null = this.ctx.getWebSockets('host').includes(ws)
      ? 'host'
      : this.ctx.getWebSockets('guest').includes(ws)
        ? 'guest'
        : null;
    if (!role) return;
    let msg: { type?: unknown; payload?: unknown };
    try {
      msg = JSON.parse(text) as { type?: unknown; payload?: unknown };
    } catch {
      return;
    }
    if (typeof msg.type !== 'string' || !FORWARDABLE.has(msg.type) || msg.payload == null) {
      return;
    }
    const target = otherRole(role);
    const forwarded = JSON.stringify({ type: msg.type, src: role, dst: target, payload: msg.payload });
    const peer = this.peerSocket(target);
    if (peer) {
      this.send(peer, forwarded);
    } else if (this.pending[target].length < MAX_PENDING) {
      // Peer not connected yet (guest offered before the host socket
      // exists, or vice versa): hold it, in order, until it connects.
      this.pending[target].push(forwarded);
    }
  }

  webSocketClose(): void {
    this.touch();
    // Slot cleanup needs no role lookup: a closed socket is already gone
    // from getWebSockets(), so the next connect for that role succeeds.
    // Pending messages for a peer that left are dropped: they belong to a
    // dead attempt, and the client retries with a fresh join.
    if (this.ctx.getWebSockets().length === 0) {
      this.pending = { host: [], guest: [] };
    }
  }

  webSocketError(): void {
    this.webSocketClose();
  }

  async alarm(): Promise<void> {
    const idleFor = Date.now() - this.lastActivityMs;
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0 || idleFor >= IDLE_TIMEOUT_MS) {
      for (const ws of sockets) {
        try {
          ws.close(1000, 'room idle timeout');
        } catch {
          // Already closed; nothing to do.
        }
      }
      this.pending = { host: [], guest: [] };
      return;
    }
    // Still active but the alarm fired early: reschedule for the remainder.
    await this.ctx.storage.setAlarm(Date.now() + (IDLE_TIMEOUT_MS - idleFor)).catch(() => undefined);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/turn') return handleTurn(request, env);
    const match = /^\/signal\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (!match) {
      if (url.pathname === '/' || url.pathname === '/health') {
        return new Response(JSON.stringify({ ok: true, service: 'librecorsa-signal' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      return new Response('Not found', { status: 404 });
    }
    const roomCode = match[1].toUpperCase();
    if (!ROOM_CODE_RE.test(roomCode)) {
      return new Response('Invalid room code', { status: 400 });
    }
    const id = env.SIGNAL_ROOM.idFromName(`signal-room-${roomCode}`);
    const stub = env.SIGNAL_ROOM.get(id);
    return stub.fetch(request);
  },
};
