/**
 * Serverless Peer-to-Peer WebRTC + BroadcastChannel Multiplayer & Dead-Reckoning Engine
 *
 * Implements:
 * - Compact network state packet:
 *   `[timestamp, pos, quat, linVel, angVel, steerAngle, wheelRPMs, throttle, brake]`
 * - 3 Zero-Cost Serverless P2P Transports (100% Free Forever on Static GitHub Pages):
 *   1. Room Code P2P Mode: WebRTC `RTCPeerConnection` + unreliable/unordered `RTCDataChannel`
 *      (`ordered: false, maxRetransmits: 0`) using Google Public STUN (`stun:stun.l.google.com:19302`)
 *      and the public PeerJS Cloud Signaling Broker (`wss://0.peerjs.com/peerjs`) with a 6-character Room Code,
 *      or, when built with NEXT_PUBLIC_SIGNAL_URL, the self-hosted relay in
 *      `scripts/signal-worker` (same OFFER/ANSWER/CANDIDATE shape, roles host/guest).
 *   2. Manual Copy-Paste SDP Offer/Answer Mode: 100% brokerless WebRTC P2P connection via base64 SDP tokens.
 *   3. Local Same-Machine Mode: Zero-config `BroadcastChannel` across browser tabs/windows.
 * - Dead-reckoning state buffer with Cubic Hermite position/velocity spline interpolation
 *   and Quaternion `slerp` orientation interpolation at variable render frame rate (`requestAnimationFrame`).
 * - Autonomous AI grid peers that publish 25 Hz state packets into the same dead-reckoning pipeline.
 */

import * as THREE from 'three';
import type { TireCompound, VehicleModelId } from '@/types/f1';
import { sanitizeWeatherSync, type WeatherSyncState } from './weather';

const PEER_VEHICLES: readonly VehicleModelId[] = ['vf26', 'f12026-car', 'amg-gt3'];
const PEER_COMPOUNDS: readonly TireCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet'];
/** Network input is untrusted: only a known model id is kept */
const asPeerVehicle = (v: unknown): VehicleModelId | undefined =>
  PEER_VEHICLES.includes(v as VehicleModelId) ? (v as VehicleModelId) : undefined;

export interface NetworkVehiclePacket {
  peerId: string;
  driverCode: string;
  teamColorHex: string;
  /** Car the sender drives (absent from older clients: rendered as the AMR) */
  vehicle?: VehicleModelId;
  /** Circuit the sender is on (absent from older clients) */
  trackId?: string;
  /** Monotonic timestamp in milliseconds (`performance.now()` / synchronized clock) */
  timestampMs: number;
  /** World position [x, y, z] (m) */
  pos: [number, number, number];
  /** World orientation quaternion [x, y, z, w] */
  quat: [number, number, number, number];
  /** World linear velocity [vx, vy, vz] (m/s) */
  linVel: [number, number, number];
  /** World angular velocity [wx, wy, wz] (rad/s) */
  angVel: [number, number, number];
  /** Front wheel steering angle (rad) */
  steerAngle: number;
  /** 4-wheel angular speeds [FR, FL, RR, RL] (RPM) */
  wheelRPMs: [number, number, number, number];
  /** Throttle pedal (0..1) */
  throttle: number;
  /** Brake pedal (0..1) */
  brake: number;
  /** Track arc-length s (m) */
  trackS: number;
  /** Speed (km/h) */
  speedKmh: number;
  /** Sender's packet counter (loss statistics); absent from older clients */
  seq?: number;
  /** Driver name (absent from older clients) */
  name?: string;
  /** Activation-code rainbow exhaust for this run (absent from older clients: no rainbow) */
  rainbow?: boolean;
  /** Progress in a multiplayer race */
  race?: PeerRaceProgress;
}

/** A racer's progress, sent with every state packet while a multiplayer race runs */
export interface PeerRaceProgress {
  /** Race id the progress belongs to */
  id: string;
  /** Distance covered since the start line (m), laps included */
  dist: number;
  /** Race time (s, from lights out) at the finish; null while still racing */
  fin: number | null;
  /** Fastest lap of the race (ms); null before one */
  best: number | null;
  /** Last completed lap (ms) */
  last?: number | null;
  /** Time penalties served at the flag (s) */
  pen?: number;
  /** Tyre compound: soft / medium / hard / intermediate / wet */
  cmp?: TireCompound;
}

export interface InterpolatedPeerState {
  peerId: string;
  driverCode: string;
  teamColorHex: string;
  /** Car model to render (undefined: the AMR / F1Physics2026 car, as the AI field drives) */
  vehicle?: VehicleModelId;
  /** Sender's circuit, when it reports one */
  trackId?: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  linearVelocity: THREE.Vector3;
  steerAngle: number;
  wheelRPMs: [number, number, number, number];
  throttle: number;
  brake: number;
  trackS: number;
  speedKmh: number;
  isAiPeer: boolean;
  /** Remote player's name */
  name?: string;
  /** Activation-code rainbow exhaust for this run (false when the sender is an older client) */
  rainbow?: boolean;
  race?: PeerRaceProgress;
  /** Drawn translucent and never collides (the personal-best ghost) */
  ghost?: boolean;
  /** Yaw rate (rad/s, + turning right), for car-to-car contact */
  yawRateRadS?: number;
  /** False while the pose is a guess (packets stale, just appeared, just jumped): no contact then */
  contactReady?: boolean;
}

export type CollisionMode = 'on' | 'ghost_lap1' | 'off';
export type CarClassRule = 'any' | 'f1' | 'gt3';

export interface LobbySettings {
  trackId: string;
  laps: number;
  collisions: CollisionMode;
  carClass: CarClassRule;
}

export interface LobbyPlayer {
  peerId: string;
  name: string;
  code: string;
  color: string;
  vehicle?: VehicleModelId;
  trackId?: string;
  ready: boolean;
  isHost: boolean;
}

export interface LobbyState {
  hostId: string;
  settings: LobbySettings;
  players: LobbyPlayer[];
  /** The race in progress, if any */
  race: RaceStartInfo | null;
  /** The host's weather and clock (host-authoritative; guests ease theirs to it) */
  weather?: WeatherSyncState;
}

/** Everything every client needs to run the same start: the lights are timed on the host's clock */
export interface RaceStartInfo {
  id: string;
  /** Host clock (ms) at which the first red light comes on */
  lightsStartHostMs: number;
  /** Hold after the fifth light before lights out (ms) */
  holdMs: number;
  laps: number;
  collisions: CollisionMode;
  carClass: CarClassRule;
  trackId: string;
  /** Peer ids in grid order */
  grid: string[];
}

export interface PeerNetStats {
  peerId: string;
  name: string;
  code: string;
  /** Round trip (ms); null before the first pong */
  rttMs: number | null;
  /** Lost state packets over the last ~5 s (%) */
  lossPct: number;
  /** Packet arrival jitter (ms) */
  jitterMs: number;
  /** Reaches us through the host rather than directly */
  relayed: boolean;
}

export interface DriverIdentity {
  name: string;
  code: string;
  color: string;
}

type ControlMessage =
  | { type: 'hello'; name: string; code: string; color: string; vehicle?: VehicleModelId; trackId?: string }
  | { type: 'ping'; t0: number }
  | { type: 'pong'; t0: number; now: number }
  | { type: 'lobby'; lobby: LobbyState }
  | { type: 'ready'; ready: boolean }
  | { type: 'start'; start: RaceStartInfo }
  | { type: 'abort'; id: string }
  | { type: 'leave' };

interface ControlEnvelope {
  ctl: ControlMessage;
  from: string;
  /** Recipient peer id; absent = everyone */
  to?: string;
}

const TURN_STORAGE_KEY = 'bugesera.turn';

/** A TURN server the player entered (multiplayer → advanced), or null */
export function loadUserTurnServer(): RTCIceServer | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TURN_STORAGE_KEY) : null;
    if (!raw) return null;
    const v = JSON.parse(raw) as { urls?: unknown; username?: unknown; credential?: unknown };
    if (typeof v.urls !== 'string' || !/^turns?:/i.test(v.urls)) return null;
    return {
      urls: v.urls.slice(0, 256),
      username: typeof v.username === 'string' ? v.username.slice(0, 128) : undefined,
      credential: typeof v.credential === 'string' ? v.credential.slice(0, 256) : undefined,
    };
  } catch {
    return null;
  }
}

/** Saves (or with null clears) the player's TURN server; used by connections made after this */
export function saveUserTurnServer(server: { urls: string; username?: string; credential?: string } | null): void {
  try {
    if (server && /^turns?:/i.test(server.urls.trim())) {
      localStorage.setItem(TURN_STORAGE_KEY, JSON.stringify({ ...server, urls: server.urls.trim() }));
    } else {
      localStorage.removeItem(TURN_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable: no TURN server
  }
}

/** Extra build-time TURN servers (one per provider, each with its own
 * credentials), from NEXT_PUBLIC_TURN_SERVERS as a JSON array of
 * { urls, username?, credential? }. The older single-provider
 * NEXT_PUBLIC_TURN_URLS / _USERNAME / _CREDENTIAL set below stays
 * supported, so an existing build does not lose its relay. */
function parseBuildTurnServers(): RTCIceServer[] {
  const out: RTCIceServer[] = [];
  const raw = process.env.NEXT_PUBLIC_TURN_SERVERS;
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return out;
    for (const item of parsed.slice(0, 3)) {
      if (!item || typeof item !== 'object') continue;
      const v = item as { urls?: unknown; username?: unknown; credential?: unknown };
      const urls = Array.isArray(v.urls)
        ? v.urls.filter((u): u is string => typeof u === 'string' && /^turns?:/i.test(u)).slice(0, 4)
        : typeof v.urls === 'string' && /^turns?:/i.test(v.urls)
          ? [v.urls]
          : [];
      if (urls.length === 0) continue;
      out.push({
        urls,
        username: typeof v.username === 'string' ? v.username.slice(0, 128) : undefined,
        credential: typeof v.credential === 'string' ? v.credential.slice(0, 256) : undefined,
      });
    }
  } catch {
    // A bad build variable must not break the game: fall back to the
    // single-provider set and the player's own TURN server below.
  }
  return out;
}

/** Short-lived Cloudflare TURN servers fetched from the signal Worker
 * (GET /turn), cached in memory only — never in localStorage, because
 * the credentials expire. Empty while unconfigured or unreachable, so
 * the game silently falls back to the static TURN servers. */
let runtimeTurnServers: RTCIceServer[] = [];
let runtimeTurnExpiresAtMs = 0;
let runtimeTurnInFlight: Promise<void> | null = null;

function isTurns443(server: RTCIceServer): boolean {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some((u) => typeof u === 'string' && /^turns:/i.test(u) && /:443(\?|$)/.test(u));
}

/** Fetches (once, cached) the runtime TURN list. Never throws and never
 * waits more than 2.5 s: a slow or missing /turn must not delay a room
 * join. Callers await this before creating a peer connection; the
 * host/guest OPEN and offer handlers already run async, and the manual
 * SDP functions are async too, so no sync call site has to change. */
export async function ensureRuntimeTurn(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (Date.now() < runtimeTurnExpiresAtMs && runtimeTurnServers.length > 0) return;
  if (runtimeTurnInFlight) return runtimeTurnInFlight;
  runtimeTurnInFlight = (async () => {
    try {
      const origin = signalRelayOrigin();
      if (!origin) return;
      const httpOrigin = origin.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch(`${httpOrigin}/turn`, { signal: ctrl.signal, credentials: 'omit' });
        if (!res.ok) return;
        const data = (await res.json()) as { iceServers?: unknown; ttl?: unknown };
        if (!Array.isArray(data.iceServers)) return;
        const servers: RTCIceServer[] = [];
        for (const item of data.iceServers.slice(0, 4)) {
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
            username: typeof v.username === 'string' ? v.username.slice(0, 128) : undefined,
            credential: typeof v.credential === 'string' ? v.credential.slice(0, 256) : undefined,
          });
        }
        if (servers.length === 0) return;
        const ttlSec = typeof data.ttl === 'number' && Number.isFinite(data.ttl) ? data.ttl : 1800;
        runtimeTurnServers = servers;
        runtimeTurnExpiresAtMs = Date.now() + Math.min(Math.max((ttlSec - 60) * 1000, 300000), 3600000);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Unreachable /turn is a normal fallback case, not an error to surface.
    }
  })();
  try {
    await runtimeTurnInFlight;
  } finally {
    runtimeTurnInFlight = null;
  }
}

/** STUN, plus TURN relays from every configured source, for strict NATs.
 * Order: STUN first (direct still wins when it works), then TURN servers
 * with turns:443 first — the transport restrictive campus/company
 * networks actually allow — then the remaining TURN servers. A blocked
 * provider does not stop ICE from trying the next one. */
function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [...PUBLIC_STUN_SERVERS];
  const turns: RTCIceServer[] = [];
  const envUrls = process.env.NEXT_PUBLIC_TURN_URLS;
  if (envUrls) {
    const urls = envUrls.split(',').map((u) => u.trim()).filter((u) => /^turns?:/i.test(u));
    if (urls.length > 0) {
      turns.push({
        urls,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME,
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
      });
    }
  }
  turns.push(...parseBuildTurnServers());
  turns.push(...runtimeTurnServers);
  const user = loadUserTurnServer();
  if (user) turns.push(user);
  turns.sort((a, b) => Number(isTurns443(b)) - Number(isTurns443(a)));
  servers.push(...turns);
  return servers;
}

/** True when a TURN relay is configured (the UI explains strict-NAT failures differently without one) */
export function hasTurnServer(): boolean {
  return iceServers().some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)));
}

/**
 * Self-hosted signaling relay origin, baked in at build time (same pattern
 * as NEXT_PUBLIC_LEADERBOARD_URL). When set, room-code mode uses
 * `scripts/signal-worker` instead of the public PeerJS broker; when unset,
 * the PeerJS behaviour below is unchanged, as the fallback. The value is
 * an origin only (no trailing slash, no /signal suffix): the client
 * appends `/signal/<code>?role=host|guest` itself.
 */
function signalRelayOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SIGNAL_URL?.trim().replace(/\/+$/, '');
  if (!raw) return null;
  // Accept https://, http://, wss:// or ws://; a bare domain is https.
  if (/^(https?|wss?):\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

/** WebSocket URL for one side of a relay room, or null when relaying is off. */
function signalRelayWsUrl(roomCode: string, role: 'host' | 'guest'): string | null {
  const origin = signalRelayOrigin();
  if (!origin) return null;
  const wsOrigin = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const base = wsOrigin.endsWith('/signal') ? wsOrigin : `${wsOrigin}/signal`;
  return `${base}/${roomCode}?role=${role}`;
}

const clampStr = (v: unknown, max: number, fallback: string) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, max) : fallback;
const asCode = (v: unknown) => {
  const s = typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) : '';
  return s.length === 3 ? s : 'DRV';
};
const asColor = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#E10600');
const finite = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const COLLISION_MODES: readonly CollisionMode[] = ['on', 'ghost_lap1', 'off'];
const CAR_CLASSES: readonly CarClassRule[] = ['any', 'f1', 'gt3'];

function sanitizeRace(v: unknown): PeerRaceProgress | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const dist = finite(r.dist, -10_000, 10_000_000);
  if (typeof r.id !== 'string' || dist === null) return undefined;
  return {
    id: r.id.slice(0, 32),
    dist,
    fin: finite(r.fin, 0, 1e6),
    best: finite(r.best, 0, 1e7),
    last: finite(r.last, 0, 1e7),
    pen: finite(r.pen, 0, 600) ?? undefined,
    cmp: PEER_COMPOUNDS.includes(r.cmp as TireCompound) ? (r.cmp as TireCompound) : undefined,
  };
}

function sanitizeStart(v: unknown): RaceStartInfo | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const lightsStartHostMs = finite(s.lightsStartHostMs, -1e15, 1e15);
  const holdMs = finite(s.holdMs, 0, 5000);
  const laps = finite(s.laps, 1, 99);
  if (typeof s.id !== 'string' || lightsStartHostMs === null || holdMs === null || laps === null) return null;
  if (!Array.isArray(s.grid)) return null;
  return {
    id: s.id.slice(0, 32),
    lightsStartHostMs,
    holdMs,
    laps: Math.round(laps),
    collisions: COLLISION_MODES.includes(s.collisions as CollisionMode) ? (s.collisions as CollisionMode) : 'on',
    carClass: CAR_CLASSES.includes(s.carClass as CarClassRule) ? (s.carClass as CarClassRule) : 'any',
    trackId: clampStr(s.trackId, 64, 'rwanda'),
    grid: s.grid.filter((g): g is string => typeof g === 'string').slice(0, 32).map((g) => g.slice(0, 64)),
  };
}

function sanitizeLobby(v: unknown): LobbyState | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Record<string, unknown>;
  const st = (l.settings ?? {}) as Record<string, unknown>;
  if (typeof l.hostId !== 'string' || !Array.isArray(l.players)) return null;
  return {
    hostId: l.hostId.slice(0, 64),
    weather: sanitizeWeatherSync(l.weather) ?? undefined,
    settings: {
      trackId: clampStr(st.trackId, 64, 'rwanda'),
      laps: Math.round(finite(st.laps, 1, 99) ?? 5),
      collisions: COLLISION_MODES.includes(st.collisions as CollisionMode) ? (st.collisions as CollisionMode) : 'on',
      carClass: CAR_CLASSES.includes(st.carClass as CarClassRule) ? (st.carClass as CarClassRule) : 'any',
    },
    players: l.players.slice(0, 32).flatMap((p): LobbyPlayer[] => {
      if (!p || typeof p !== 'object') return [];
      const q = p as Record<string, unknown>;
      if (typeof q.peerId !== 'string') return [];
      return [
        {
          peerId: q.peerId.slice(0, 64),
          name: clampStr(q.name, 16, 'Driver'),
          code: asCode(q.code),
          color: asColor(q.color),
          vehicle: asPeerVehicle(q.vehicle),
          trackId: typeof q.trackId === 'string' ? q.trackId.slice(0, 64) : undefined,
          ready: q.ready === true,
          isHost: q.isHost === true,
        },
      ];
    }),
    race: l.race ? sanitizeStart(l.race) : null,
  };
}

/** Validates a control message from the network; null when it is not one */
function sanitizeControl(v: unknown): ControlMessage | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  switch (m.type) {
    case 'hello':
      return {
        type: 'hello',
        name: clampStr(m.name, 16, 'Driver'),
        code: asCode(m.code),
        color: asColor(m.color),
        vehicle: asPeerVehicle(m.vehicle),
        trackId: typeof m.trackId === 'string' ? m.trackId.slice(0, 64) : undefined,
      };
    case 'ping': {
      const t0 = finite(m.t0, -1e15, 1e15);
      return t0 === null ? null : { type: 'ping', t0 };
    }
    case 'pong': {
      const t0 = finite(m.t0, -1e15, 1e15);
      const now = finite(m.now, -1e15, 1e15);
      return t0 === null || now === null ? null : { type: 'pong', t0, now };
    }
    case 'lobby': {
      const lobby = sanitizeLobby(m.lobby);
      return lobby ? { type: 'lobby', lobby } : null;
    }
    case 'ready':
      return { type: 'ready', ready: m.ready === true };
    case 'start': {
      const start = sanitizeStart(m.start);
      return start ? { type: 'start', start } : null;
    }
    case 'abort':
      return typeof m.id === 'string' ? { type: 'abort', id: m.id.slice(0, 32) } : null;
    case 'leave':
      return { type: 'leave' };
    default:
      return null;
  }
}

export interface P2PConnectionStatus {
  mode: 'local' | 'room_host' | 'room_guest' | 'manual_sdp';
  roomCode: string;
  state: 'idle' | 'signaling' | 'connected' | 'error';
  connectedWebRtcPeers: number;
  statusText: string;
  /** Latest ICE connection state for the broker peer, when one exists ('new' = not started yet). The panel shows it while connecting so a stuck join reads as ICE-checking rather than a silent hang. */
  iceState?: RTCIceConnectionState;
}

interface PeerSnapshotBuffer {
  peerId: string;
  driverCode: string;
  teamColorHex: string;
  isAiPeer: boolean;
  /** Packet statistics: sequence numbers seen, arrivals and jitter */
  lastSeq: number;
  seqWindow: { received: number; expected: number; startMs: number };
  lossPct: number;
  lastArrivalMs: number;
  jitterMs: number;
  snapshots: NetworkVehiclePacket[];
  lastReceivedMs: number;
  /** Filtered offset (localNowMs - senderTimestampMs) so sender dt is preserved without arrival jitter */
  clockOffsetMs: number | null;
  /** Newest sender timestamp accepted (ms, the sender's clock): older packets arrived out of order */
  lastSenderTimestampMs: number;
  renderedState: InterpolatedPeerState;
  /** Present-time prediction (human peers): the blended-out correction, the newest snapshot used, the last frame */
  predict: {
    corrPos: THREE.Vector3;
    corrQuat: THREE.Quaternion;
    newestTs: number;
    lastMs: number;
    graceUntilMs: number;
    primed: boolean;
  };
}

interface WebRtcPeerEntry {
  remoteId: string;
  pc: RTCPeerConnection;
  /** Unreliable, unordered state channel */
  dc: RTCDataChannel | null;
  /** Reliable, ordered control channel (lobby, start, pings); absent with older clients */
  ctl?: RTCDataChannel | null;
  /** Game peer id behind this connection, once a message from it arrives */
  gamePeerId?: string;
}

const STATE_CHANNEL = 'f1-telemetry';
const CONTROL_CHANNEL = 'f1-control';

/**
 * Public STUN servers, tried in order; a dead one only costs a failed candidate
 * lookup, it never blocks the others. Google first (the historical default),
 * then Nextcloud (stun.nextcloud.com:443 is Nextcloud Talk's documented default
 * and appears in the always-online-stun validated lists on both 443 and 3478),
 * Syncthing's own primary STUN (DefaultPrimaryStunServers in its source), and
 * Xiaomi's miwifi server (used as the China-reachable STUN in several public
 * WebRTC projects; Google's STUN is the one commonly blocked from mainland
 * China). No TURN credentials are baked in here: TURN stays user-configured.
 */
const PUBLIC_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: 'stun:stun.nextcloud.com:3478' },
  { urls: 'stun:stun.syncthing.net:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
];

/** A raw clock offset this far (ms) from the filtered one is a clock step, not jitter: snap to it */
const CLOCK_OFFSET_SNAP_MS = 250;
/** A sender timestamp this far (ms) behind the newest accepted one is a restarted clock, not an out-of-order packet */
const SENDER_CLOCK_RESTART_MS = 1000;
/**
 * Remote players are drawn and collided where they are now: the newest packet carried forward by its age plus the
 * one-way latency, at most this far (s). Past it the packets are stale and the car can't be touched.
 */
const PREDICT_MAX_S = 0.3;
/** A new packet's correction to the prediction blends out over this time constant (s) */
const PREDICT_SMOOTH_S = 0.1;
/** A correction this large (m) is a reset or teleport: snap to it, and hold contact off for PREDICT_GRACE_MS */
const PREDICT_SNAP_M = 3;
const PREDICT_GRACE_MS = 400;
/** The acceleration the prediction carries forward is clamped to this (m/s²) */
const PREDICT_MAX_ACCEL_MS2 = 60;
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class MultiplayerSyncManager {
  public readonly localPeerId: string;
  private channel: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private signalingWs: WebSocket | null = null;
  /** Join-attempt watchdog: the broker silently drops offers to a nonexistent host, so without this a guest waits forever */
  private joinTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic id of the latest joinRoom() call: timers captured by an older attempt must not fire for a newer one */
  private joinAttemptId = 0;
  /** Per-peer ICE watchdog, keyed by rtcPeers key: fires when offer/answer exchange finished but the data channel never opens */
  private iceTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private rtcPeers = new Map<string, WebRtcPeerEntry>();
  /** Trickle ICE candidates that arrived before their peer connection
   * existed or before its remote description was set (see below). */
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private manualPendingPc: RTCPeerConnection | null = null;

  private peers = new Map<string, PeerSnapshotBuffer>();
  private lastBroadcastMs = 0;
  private readonly broadcastIntervalMs = 40; // 25 Hz (within 20-30 Hz spec)
  private readonly interpolationDelayMs = 65; // 65ms jitter buffer for cubic Hermite interpolation

  public status: P2PConnectionStatus = {
    mode: 'local',
    roomCode: '',
    state: 'idle',
    connectedWebRtcPeers: 0,
    statusText: '同浏览器 BroadcastChannel 已激活 • 可进行 WebRTC 点对点连接',
  };
  public onStatusChange?: (status: P2PConnectionStatus) => void;

  /** This client runs the lobby and times the races (room host, manual-offer host, or a local-tab host) */
  public isHost = false;
  /** The host's peer id, once known */
  public hostId: string | null = null;
  public lobby: LobbyState | null = null;
  public onLobbyChange?: (lobby: LobbyState | null) => void;
  /** Host: the session's weather, sent with every lobby update so the guests drive in the same conditions */
  public weatherProvider?: () => WeatherSyncState | null;
  public onRaceStart?: (start: RaceStartInfo) => void;
  public onRaceAbort?: (id: string) => void;
  private identity: DriverIdentity = { name: 'Driver', code: 'DRV', color: '#E10600' };
  private localVehicle: VehicleModelId | undefined;
  private localTrackId: string | undefined;
  private localReady = false;
  /** Host-side lobby members (not including the host) */
  private members = new Map<string, LobbyPlayer>();
  private memberSeenMs = new Map<string, number>();
  private lobbySettings: LobbySettings = { trackId: 'rwanda', laps: 5, collisions: 'ghost_lap1', carClass: 'any' };
  private activeRace: RaceStartInfo | null = null;
  /** hostClock − localClock (ms); 0 on the host */
  private clockOffsetMs = 0;
  private bestClockRttMs = Infinity;
  private rtts = new Map<string, number>();
  private seq = 0;
  private lastPingMs = 0;
  private lastLobbyMs = 0;
  /** Idle auto-disconnect (room modes only, never during a race): 30 min idle, warning at 29 min. */
  private static readonly IDLE_LIMIT_MS = 30 * 60 * 1000;
  private static readonly IDLE_WARNING_MS = 29 * 60 * 1000;
  private idleLastActivityMs = Date.now();
  private idleWarningShown = false;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  // Reusable math temporaries
  private tempQuat0 = new THREE.Quaternion();
  private tempQuat1 = new THREE.Quaternion();
  private tempQuat2 = new THREE.Quaternion();
  private tempVec0 = new THREE.Vector3();
  private tempVec1 = new THREE.Vector3();
  /**
   * Human peers drawn where they are now (`predictPeer`) rather than interpolated 65 ms + latency in the past: at
   * racing speed that is 5 m or more, so cars touched where the other car no longer was and missed where it was.
   */
  public predictRemotePlayers = true;
  private tempUp = new THREE.Vector3(0, 1, 0);
  private tempRight = new THREE.Vector3();
  private tempForward = new THREE.Vector3();
  private tempMatrix = new THREE.Matrix4();

  constructor() {
    this.localPeerId = `peer_${Math.random().toString(36).slice(2, 9)}`;
    this.initTransports();
    // Wall-clock check (not the render loop) so a backgrounded tab still
    // disconnects instead of burning relay traffic while forgotten.
    if (typeof setInterval !== 'undefined') {
      this.idleTimer = setInterval(() => this.checkIdle(), 30 * 1000);
    }
  }

  /** Any genuine user/lobby activity resets the idle clock; automatic pings do not. */
  private markIdleActivity(): void {
    this.idleLastActivityMs = Date.now();
    if (this.idleWarningShown) {
      this.idleWarningShown = false;
      if (this.status.state === 'connected') {
        this.emitStatus({ statusText: 'WebRTC 数据通道已连接（25 Hz 无序 UDP）' });
      }
    }
  }

  private checkIdle(): void {
    if (this.status.mode !== 'room_host' && this.status.mode !== 'room_guest') {
      this.idleWarningShown = false;
      return;
    }
    const hasOpenPeer = [...this.rtcPeers.values()].some((e) => e.dc?.readyState === 'open');
    if (!hasOpenPeer || this.activeRace) {
      // No peer to relay to, or a race is running: never idle-disconnect.
      this.idleLastActivityMs = Date.now();
      this.idleWarningShown = false;
      return;
    }
    const idleMs = Date.now() - this.idleLastActivityMs;
    if (idleMs >= MultiplayerSyncManager.IDLE_LIMIT_MS) {
      this.disconnectIdle();
    } else if (idleMs >= MultiplayerSyncManager.IDLE_WARNING_MS && !this.idleWarningShown) {
      this.idleWarningShown = true;
      this.emitStatus({
        statusText: '闲置 29 分钟，1 分钟后将自动断开连接以节省流量，任意操作可取消。',
      });
    }
  }

  /** Closes a room connection after 30 min idle; peers learn via 'leave' first. */
  private disconnectIdle(): void {
    try {
      this.sendControl({ type: 'leave' });
    } catch {
      // Ignore send error: the peer close below still ends the relay.
    }
    this.clearJoinTimeout();
    this.clearAllIceTimeouts();
    for (const entry of this.rtcPeers.values()) {
      try {
        entry.dc?.close();
        entry.pc.close();
      } catch {
        // Ignore close error
      }
    }
    this.rtcPeers.clear();
    this.closeSignaling();
    this.members.clear();
    this.memberSeenMs.clear();
    this.setLobby(null);
    this.isHost = false;
    this.hostId = null;
    this.activeRace = null;
    this.idleWarningShown = false;
    this.emitStatus({
      mode: 'local',
      roomCode: '',
      state: 'idle',
      statusText: '已因 30 分钟闲置自动断开连接，以节省流量。',
    });
  }

  private emitStatus(patch: Partial<P2PConnectionStatus>): void {
    let openCount = 0;
    for (const entry of this.rtcPeers.values()) {
      if (entry.dc && entry.dc.readyState === 'open') {
        openCount++;
      }
    }
    this.status = {
      ...this.status,
      ...patch,
      connectedWebRtcPeers: openCount,
    };
    this.onStatusChange?.({ ...this.status });
  }

  private initTransports(): void {
    if (typeof window === 'undefined') return;

    if ('BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('kigali_f1_sim_net_v1');
        this.channel.onmessage = (ev: MessageEvent<NetworkVehiclePacket | ControlEnvelope>) => {
          const data = ev.data as Partial<ControlEnvelope> & Partial<NetworkVehiclePacket>;
          if (!data || typeof data !== 'object') return;
          if (data.ctl) {
            this.handleEnvelope(data as ControlEnvelope, null);
          } else if (data.peerId && data.peerId !== this.localPeerId) {
            this.ingestPacket(data as NetworkVehiclePacket, false);
          }
        };
      } catch {
        // BroadcastChannel unavailable in restricted context
      }
    }

    const wsUrl = process.env.NEXT_PUBLIC_SIM_WS_URL;
    if (wsUrl) {
      try {
        this.ws = new WebSocket(wsUrl);
        this.ws.onmessage = (ev) => {
          try {
            const pkt = JSON.parse(ev.data) as NetworkVehiclePacket;
            if (pkt && pkt.peerId && pkt.peerId !== this.localPeerId) {
              this.ingestPacket(pkt, false);
            }
          } catch {
            // Ignore malformed WS message
          }
        };
      } catch {
        // Ignore WS connection error
      }
    }
  }

  /**
   * Generates a random 6-character alphanumeric room code.
   */
  public static generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  /**
   * Hosts a serverless WebRTC P2P Room using the public PeerJS Cloud Broker (`0.peerjs.com`)
   * and Google Public STUN (`stun:stun.l.google.com:19302`).
   */
  public hostRoom(customCode?: string): string {
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      return '';
    }
    // Start the runtime TURN fetch early: the host peer connection is only
    // created when a guest offer arrives, so by then the cached list is
    // usually ready, and a slow /turn never blocks room creation.
    void ensureRuntimeTurn();
    this.closeSignaling();
    // Switching to host abandons any pending guest join: its watchdog must not
    // fire later and overwrite the host's ready status (closeSignaling no longer
    // clears timers, see below).
    this.clearJoinTimeout();
    this.clearAllIceTimeouts();
    this.becomeHost();
    const roomCode = (customCode || MultiplayerSyncManager.generateRoomCode())
      .trim()
      .toUpperCase()
      .slice(0, 6);
    const brokerPeerId = `rwanda2026_room_${roomCode}_host`;
    const token = Math.random().toString(36).slice(2, 10);
    // Self-hosted relay when built with NEXT_PUBLIC_SIGNAL_URL; otherwise
    // the public PeerJS broker, unchanged. The relay speaks the same
    // OPEN/OFFER/CANDIDATE shape (its src is the role, 'guest'), so the
    // handler below is shared by both paths.
    const relayUrl = signalRelayWsUrl(roomCode, 'host');
    const useRelay = relayUrl !== null;

    this.emitStatus({
      mode: 'room_host',
      roomCode,
      state: 'signaling',
      statusText: useRelay
        ? `正在创建房间 ${roomCode}…`
        : `正在公共 P2P 中介上创建房间 ${roomCode}…`,
    });

    try {
      const ws = new WebSocket(
        relayUrl ??
          `wss://0.peerjs.com/peerjs?key=peerjs&id=${encodeURIComponent(brokerPeerId)}&token=${encodeURIComponent(token)}`
      );
      this.signalingWs = ws;

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'OPEN') {
            this.emitStatus({
              state: 'signaling',
              statusText: `房间 ${roomCode} 已就绪 • 等待对手加入`,
            });
          } else if (msg.type === 'ERROR') {
            this.emitStatus({
              state: 'error',
              statusText: '房间已被占用，请重新创建房间',
            });
          } else if (msg.type === 'OFFER' && msg.src && msg.payload?.sdp) {
            await this.handleBrokerOffer(msg.src, msg.payload.sdp, msg.payload.connectionId);
          } else if (msg.type === 'CANDIDATE' && msg.src && msg.payload?.candidate) {
            await this.queueOrAddCandidate(msg.src, msg.payload.candidate);
          }
        } catch {
          // Ignore malformed broker message
        }
      };

      ws.onerror = () => {
        this.emitStatus({
          state: 'error',
          statusText: useRelay
            ? '无法连接自有信令 — 请使用下方手动 SDP 复制粘贴'
            : '无法连接公共中介 — 请使用下方手动 SDP 复制粘贴',
        });
      };
    } catch {
      this.emitStatus({
        state: 'error',
        statusText: '信令连接打开失败 — 请使用手动 SDP 备用方式',
      });
    }

    return roomCode;
  }

  /**
   * Joins an existing 6-character WebRTC P2P Room via the public PeerJS Cloud Broker.
   */
  public joinRoom(rawCode: string): void {
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      return;
    }
    const roomCode = rawCode.trim().toUpperCase().slice(0, 6);
    if (!roomCode) return;

    this.closeSignaling();
    this.becomeGuest();
    const guestBrokerId = `rwanda2026_room_${roomCode}_guest_${Math.random().toString(36).slice(2, 7)}`;
    const hostBrokerId = `rwanda2026_room_${roomCode}_host`;
    const token = Math.random().toString(36).slice(2, 10);
    const connId = `dc_${Math.random().toString(36).slice(2, 9)}`;
    // Relay path: the relay rewrites src to the role, so the host peer is
    // keyed 'host' (not a broker id) and CANDIDATE/ANSWER routing still
    // matches by that key. PeerJS path keeps its broker ids, unchanged.
    const relayUrl = signalRelayWsUrl(roomCode, 'guest');
    const useRelay = relayUrl !== null;
    const peerRemoteId = useRelay ? 'host' : hostBrokerId;

    this.emitStatus({
      mode: 'room_guest',
      roomCode,
      state: 'signaling',
      statusText: `正在连接房间 ${roomCode}…`,
      iceState: 'new',
    });

    // No response from the host within 30 s means the code is wrong, the host
    // is offline, or the broker dropped the offer: surface an error instead of
    // hanging on "正在连接房间…" forever. The panel's 加入 button retries.
    // The timer is keyed to this attempt id (not just to mode/state) so a
    // later status-text change, a panel remount, or a newer join attempt can
    // never silently disarm it, and closeSignaling() deliberately does NOT
    // clear it: only an explicit clear (success, cancel, dispose, a newer
    // join/host, or the timer itself) may do so.
    this.clearJoinTimeout();
    this.clearAllIceTimeouts();
    // A retry must not leave the previous attempt's half-open peer alive: its
    // ICE/connection handlers could otherwise fire error text into the new
    // attempt. Open data channels (an already-connected room) are untouched.
    this.closeUnopenedPeers();
    const attempt = ++this.joinAttemptId;
    this.joinTimeout = setTimeout(() => {
      this.joinTimeout = null;
      if (attempt !== this.joinAttemptId) return;
      if (this.status.mode !== 'room_guest') return;
      if (this.hasOpenDataChannel()) return;
      this.closeUnopenedPeers();
      this.closeSignaling();
      this.emitStatus({
        state: 'error',
        statusText: '连接超时：30 秒内未收到房主回应，请检查房间代码后重试',
      });
    }, 30000);

    try {
      const ws = new WebSocket(
        relayUrl ??
          `wss://0.peerjs.com/peerjs?key=peerjs&id=${encodeURIComponent(guestBrokerId)}&token=${encodeURIComponent(token)}`
      );
      this.signalingWs = ws;

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'OPEN') {
            await ensureRuntimeTurn();
            const pc = this.createPeerConnection(peerRemoteId, connId);
            const dc = pc.createDataChannel(STATE_CHANNEL, {
              ordered: false,
              maxRetransmits: 0,
            });
            const ctl = pc.createDataChannel(CONTROL_CHANNEL, { ordered: true });
            const entry: WebRtcPeerEntry = { remoteId: peerRemoteId, pc, dc, ctl };
            this.rtcPeers.set(peerRemoteId, entry);
            this.bindDataChannel(peerRemoteId, dc);
            this.bindControlChannel(entry, ctl);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            ws.send(
              JSON.stringify({
                type: 'OFFER',
                dst: peerRemoteId,
                payload: {
                  sdp: pc.localDescription,
                  type: 'data',
                  connectionId: connId,
                },
              })
            );
          } else if (msg.type === 'ERROR') {
            this.clearJoinTimeout();
            this.emitStatus({
              state: 'error',
              statusText: '房间已被占用，请检查房间码后重试',
            });
          } else if (msg.type === 'ANSWER' && msg.src && msg.payload?.sdp) {
            const entry = this.rtcPeers.get(msg.src);
            if (entry) {
              await entry.pc.setRemoteDescription(
                new RTCSessionDescription(msg.payload.sdp)
              );
              await this.flushPendingCandidates(msg.src);
              // Offer/answer exchange is done: from here the only thing left
              // is ICE + the data channel, so the 20 s ICE watchdog starts now.
              this.startIceTimeout(msg.src);
            }
          } else if (msg.type === 'CANDIDATE' && msg.src && msg.payload?.candidate) {
            await this.queueOrAddCandidate(msg.src, msg.payload.candidate);
          }
        } catch {
          // Ignore signaling parse error
        }
      };

      ws.onerror = () => {
        this.emitStatus({
          state: 'error',
          statusText: useRelay
            ? '自有信令出错 — 请使用手动 SDP 复制粘贴备用方式'
            : '中介出错 — 请使用手动 SDP 复制粘贴备用方式',
        });
      };

      // A broker socket that closes mid-join used to leave the panel on
      // "正在连接房间…" until the 30 s timer (if it was still armed) fired.
      // Report it at once; intentional closes (cancel / timeout / a newer
      // join) already moved the status off signaling, so they stay silent.
      ws.onclose = () => {
        if (attempt !== this.joinAttemptId) return;
        if (this.status.mode !== 'room_guest' || this.status.state !== 'signaling') return;
        if (this.hasOpenDataChannel()) return;
        this.clearJoinTimeout();
        this.emitStatus({
          state: 'error',
          statusText: '信令连接已断开，请检查网络后重试',
        });
      };
    } catch {
      this.emitStatus({
        state: 'error',
        statusText: '连接失败 — 请使用手动 SDP 复制粘贴备用方式',
      });
    }
  }

  /**
   * Trickle ICE fix: a candidate that arrives before its peer connection
   * exists, or before its remote description is set, must NOT be dropped.
   * The old code called addIceCandidate directly and silently ignored the
   * rejection, so a fast guest (all candidates gathered in a burst right
   * after its offer) could lose every candidate while the host was still
   * fetching runtime TURN, setting the remote description, and creating
   * its answer — and then ICE failed even though a direct path existed
   * (the manual SDP path, which bundles all candidates in one token,
   * worked in exactly that case). Queue such candidates and flush them
   * once the remote description is set.
   */
  private async queueOrAddCandidate(remoteId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const entry = this.rtcPeers.get(remoteId);
    if (entry && entry.pc.remoteDescription) {
      try {
        await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // A single bad candidate must not break the connection.
      }
      return;
    }
    const queued = this.pendingCandidates.get(remoteId) ?? [];
    if (queued.length < 50) queued.push(candidate);
    this.pendingCandidates.set(remoteId, queued);
  }

  private async flushPendingCandidates(remoteId: string): Promise<void> {
    // Drain in rounds: a candidate arriving mid-flush is queued again and
    // picked up by the next round, never lost to a stale snapshot.
    for (let round = 0; round < 5; round++) {
      const queued = this.pendingCandidates.get(remoteId) ?? [];
      if (queued.length === 0) return;
      this.pendingCandidates.set(remoteId, []);
      const entry = this.rtcPeers.get(remoteId);
      if (!entry || !entry.pc.remoteDescription) {
        this.pendingCandidates.set(remoteId, queued);
        return;
      }
      for (const candidate of queued) {
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Ignore a single stale candidate; the rest still apply.
        }
      }
    }
  }

  private async handleBrokerOffer(
    remoteId: string,
    sdp: RTCSessionDescriptionInit,
    connectionId: string
  ): Promise<void> {
    await ensureRuntimeTurn();
    const pc = this.createPeerConnection(remoteId, connectionId);
    const entry: WebRtcPeerEntry = { remoteId, pc, dc: null };
    this.rtcPeers.set(remoteId, entry);
    pc.ondatachannel = (ev) => this.acceptChannel(entry, ev.channel);

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushPendingCandidates(remoteId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (this.signalingWs && this.signalingWs.readyState === WebSocket.OPEN) {
      this.signalingWs.send(
        JSON.stringify({
          type: 'ANSWER',
          dst: remoteId,
          payload: {
            sdp: pc.localDescription,
            type: 'data',
            connectionId,
          },
        })
      );
      // Offer/answer exchange is done: the 20 s ICE watchdog starts now.
      this.startIceTimeout(remoteId);
    }
  }

  private createPeerConnection(
    remoteId: string,
    connectionId: string
  ): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });

    pc.onicecandidate = (ev) => {
      if (
        ev.candidate &&
        this.signalingWs &&
        this.signalingWs.readyState === WebSocket.OPEN
      ) {
        this.signalingWs.send(
          JSON.stringify({
            type: 'CANDIDATE',
            dst: remoteId,
            payload: {
              candidate: ev.candidate,
              type: 'data',
              connectionId,
            },
          })
        );
      }
    };

    // ICE state is reported to the panel while a connection is pending, so a
    // guest stuck on "正在连接房间…" can be told apart from a signaling loss:
    // checking = the broker delivered the offer/answer but no usable network
    // path has been found yet; failed = no path exists (strict NAT / mobile).
    // connectionState 'failed' usually follows ice 'failed' shortly after, so
    // the failed branch below is the same message, not a second error.
    pc.oniceconnectionstatechange = () => {
      const ice = pc.iceConnectionState;
      const entry = this.rtcPeers.get(remoteId);
      if (entry?.dc?.readyState === 'open') {
        this.clearIceTimeout(remoteId);
        return;
      }
      this.emitStatus({ iceState: ice });
      if (
        ice === 'failed' &&
        this.status.mode === 'room_guest' &&
        this.status.state === 'signaling'
      ) {
        this.clearJoinTimeout();
        this.clearIceTimeout(remoteId);
        this.closeUnopenedPeers();
        this.emitStatus({
          state: 'error',
          statusText: hasTurnServer()
            ? '即使通过 TURN 中继也无法连接。请检查 TURN 配置，或尝试使用同一 Wi-Fi。'
            : '无法直连（严格 NAT / 移动网络）。请在“高级”中添加 TURN 中继，或使用同一 Wi-Fi。',
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        const entry = this.rtcPeers.get(remoteId);
        const neverOpened = !entry?.dc || entry.dc.readyState !== 'open';
        this.clearIceTimeout(remoteId);
        this.rtcPeers.delete(remoteId);
        if (entry?.gamePeerId) this.dropMember(entry.gamePeerId);
        const strictNat = pc.connectionState === 'failed' && neverOpened;
        this.emitStatus({
          state: this.rtcPeers.size > 0 ? 'connected' : strictNat ? 'error' : 'signaling',
          statusText:
            this.rtcPeers.size > 0
              ? `WebRTC P2P Connected (${this.rtcPeers.size} peer)`
              : strictNat
                ? hasTurnServer()
                  ? '即使通过 TURN 中继也无法连接。请检查 TURN 配置，或尝试使用同一 Wi-Fi。'
                  : '无法直连（严格 NAT / 移动网络）。请在“高级”中添加 TURN 中继，或使用同一 Wi-Fi。'
                : '对手已断开 • 等待重连',
        });
      }
    };

    return pc;
  }

  /** Host side: a guest opened a channel (state or control, by label) */
  private acceptChannel(entry: WebRtcPeerEntry, channel: RTCDataChannel): void {
    if (channel.label === CONTROL_CHANNEL) {
      entry.ctl = channel;
      this.bindControlChannel(entry, channel);
    } else {
      entry.dc = channel;
      this.bindDataChannel(entry.remoteId, channel);
    }
  }

  private bindControlChannel(entry: WebRtcPeerEntry, ctl: RTCDataChannel): void {
    ctl.onopen = () => {
      // Introduce ourselves; the host answers with the lobby, a guest starts pinging
      this.sendControl({ type: 'hello', ...this.identity, vehicle: this.localVehicle, trackId: this.localTrackId });
      if (this.isHost) this.broadcastLobby();
    };
    ctl.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 65536) return;
      try {
        const env = JSON.parse(ev.data) as ControlEnvelope;
        if (env && typeof env.from === 'string') {
          entry.gamePeerId ??= env.from;
          this.handleEnvelope(env, entry);
        }
      } catch {
        // Ignore malformed control message
      }
    };
  }

  private bindDataChannel(remoteId: string, dc: RTCDataChannel): void {
    dc.onopen = () => {
      this.markIdleActivity();
      this.clearJoinTimeout();
      this.clearIceTimeout(remoteId);
      this.emitStatus({
        state: 'connected',
        statusText: `WebRTC 数据通道已连接（25 Hz 无序 UDP）`,
      });
    };
    dc.onclose = () => {
      this.clearIceTimeout(remoteId);
      const gone = this.rtcPeers.get(remoteId)?.gamePeerId;
      this.rtcPeers.delete(remoteId);
      if (gone) this.dropMember(gone);
      this.emitStatus({
        state: this.rtcPeers.size > 0 ? 'connected' : 'idle',
      });
    };
    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 16384) return;
      try {
        const pkt = JSON.parse(ev.data) as NetworkVehiclePacket;
        if (pkt && typeof pkt.peerId === 'string' && pkt.peerId !== this.localPeerId) {
          const entry = this.rtcPeers.get(remoteId);
          if (entry && !entry.gamePeerId) entry.gamePeerId = pkt.peerId;
          this.ingestPacket(pkt, false);
          // The host relays every guest's state to the other guests (star topology: guests only connect to it)
          if (this.isHost) this.relay(ev.data, remoteId, 'state');
        }
      } catch {
        // Ignore malformed packet
      }
    };
  }

  /** Host: forwards a guest's message to every other guest */
  private relay(serialized: string, fromRemoteId: string, channel: 'state' | 'control'): void {
    for (const entry of this.rtcPeers.values()) {
      if (entry.remoteId === fromRemoteId) continue;
      const ch = channel === 'state' ? entry.dc : entry.ctl;
      if (ch && ch.readyState === 'open') {
        try {
          ch.send(serialized);
        } catch {
          // Ignore relay send failure
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Lobby, race start and clock sync (control channel + BroadcastChannel for same-browser tabs)
  // ---------------------------------------------------------------------------------------------

  /** Name, code and colour shown to other players; car and circuit for the lobby */
  public setIdentity(identity: DriverIdentity, vehicle?: VehicleModelId, trackId?: string): void {
    const changed =
      identity.name !== this.identity.name ||
      identity.code !== this.identity.code ||
      identity.color !== this.identity.color ||
      vehicle !== this.localVehicle ||
      trackId !== this.localTrackId;
    this.identity = { ...identity };
    this.localVehicle = vehicle;
    this.localTrackId = trackId;
    if (!changed) return;
    if (this.isHost) {
      if (trackId) this.lobbySettings = { ...this.lobbySettings, trackId };
      this.broadcastLobby();
    } else if (this.hostId) {
      this.sendControl({ type: 'hello', ...this.identity, vehicle, trackId });
    }
  }

  private becomeHost(): void {
    this.isHost = true;
    this.hostId = this.localPeerId;
    this.clockOffsetMs = 0;
    this.bestClockRttMs = 0;
    if (this.localTrackId) this.lobbySettings = { ...this.lobbySettings, trackId: this.localTrackId };
    this.broadcastLobby();
  }

  private becomeGuest(): void {
    this.isHost = false;
    this.hostId = null;
    this.members.clear();
    this.bestClockRttMs = Infinity;
    this.setLobby(null);
  }

  /** Hosts a race for the other tabs of this browser (no network needed) */
  public hostLocal(): void {
    this.emitStatus({ mode: 'local', state: 'connected', statusText: '正在为本浏览器的标签页主持比赛' });
    this.becomeHost();
  }

  /** Host: change the race settings */
  public setLobbySettings(patch: Partial<LobbySettings>): void {
    this.markIdleActivity();
    if (!this.isHost) return;
    this.lobbySettings = { ...this.lobbySettings, ...patch };
    this.broadcastLobby();
  }

  public setReady(ready: boolean): void {
    this.markIdleActivity();
    this.localReady = ready;
    if (this.isHost) this.broadcastLobby();
    else this.sendControl({ type: 'ready', ready });
  }

  /** Host: lines everyone up and starts the lights `countdownMs` from now. Returns the start, or null when not hosting */
  public startRace(countdownMs = 4000): RaceStartInfo | null {
    this.markIdleActivity();
    if (!this.isHost) return null;
    const players = this.lobbyPlayers();
    const start: RaceStartInfo = {
      id: Math.random().toString(36).slice(2, 10),
      lightsStartHostMs: this.hostNowMs() + countdownMs,
      holdMs: 200 + Math.random() * 2800,
      laps: this.lobbySettings.laps,
      collisions: this.lobbySettings.collisions,
      carClass: this.lobbySettings.carClass,
      trackId: this.lobbySettings.trackId,
      // Host on pole, then the others in the order they joined
      grid: players.map((p) => p.peerId),
    };
    this.activeRace = start;
    this.sendControl({ type: 'start', start });
    this.broadcastLobby();
    this.onRaceStart?.(start);
    return start;
  }

  /** Host: ends the race for everyone (back to the lobby) */
  public abortRace(): void {
    this.markIdleActivity();
    if (!this.isHost || !this.activeRace) return;
    const id = this.activeRace.id;
    this.activeRace = null;
    this.sendControl({ type: 'abort', id });
    this.broadcastLobby();
    this.onRaceAbort?.(id);
  }

  /** The host's clock now (ms): the race timeline every client shares */
  public hostNowMs(localNowMs: number = performance.now()): number {
    return localNowMs + this.clockOffsetMs;
  }

  /** True once this guest has measured the host's clock (the host always has) */
  public get clockSynced(): boolean {
    return this.isHost || Number.isFinite(this.bestClockRttMs);
  }

  /** Connection quality of every remote human player */
  public getPeerStats(): PeerNetStats[] {
    const direct = new Set<string>();
    for (const e of this.rtcPeers.values()) if (e.gamePeerId) direct.add(e.gamePeerId);
    const out: PeerNetStats[] = [];
    for (const buf of this.peers.values()) {
      if (buf.isAiPeer) continue;
      out.push({
        peerId: buf.peerId,
        name: buf.renderedState.name ?? buf.driverCode,
        code: buf.driverCode,
        rttMs: this.rtts.get(buf.peerId) ?? null,
        lossPct: buf.lossPct,
        jitterMs: buf.jitterMs,
        relayed: this.rtcPeers.size > 0 && !direct.has(buf.peerId) && !this.isHost,
      });
    }
    return out;
  }

  private lobbyPlayers(): LobbyPlayer[] {
    const me: LobbyPlayer = {
      peerId: this.localPeerId,
      ...this.identity,
      vehicle: this.localVehicle,
      trackId: this.localTrackId,
      ready: true,
      isHost: true,
    };
    return [me, ...this.members.values()];
  }

  private broadcastLobby(): void {
    if (!this.isHost) return;
    this.lastLobbyMs = performance.now();
    const lobby: LobbyState = {
      hostId: this.localPeerId,
      settings: { ...this.lobbySettings },
      players: this.lobbyPlayers(),
      race: this.activeRace,
      weather: this.weatherProvider?.() ?? undefined,
    };
    this.setLobby(lobby);
    this.sendControl({ type: 'lobby', lobby });
  }

  private setLobby(lobby: LobbyState | null): void {
    this.lobby = lobby;
    this.onLobbyChange?.(lobby);
  }

  private dropMember(peerId: string): void {
    if (this.members.delete(peerId)) {
      this.memberSeenMs.delete(peerId);
      this.broadcastLobby();
    }
  }

  /** Sends a control message over every transport (reliable channels + same-browser BroadcastChannel) */
  private sendControl(msg: ControlMessage, to?: string): void {
    const env: ControlEnvelope = to ? { ctl: msg, from: this.localPeerId, to } : { ctl: msg, from: this.localPeerId };
    if (this.channel) {
      try {
        this.channel.postMessage(env);
      } catch {
        // Ignore postMessage failure
      }
    }
    const serialized = JSON.stringify(env);
    for (const entry of this.rtcPeers.values()) {
      if (entry.ctl && entry.ctl.readyState === 'open') {
        try {
          entry.ctl.send(serialized);
        } catch {
          // Ignore send failure
        }
      }
    }
  }

  private handleEnvelope(env: ControlEnvelope, via: WebRtcPeerEntry | null): void {
    if (typeof env.from !== 'string' || env.from === this.localPeerId) return;
    const from = env.from.slice(0, 64);
    const msg = sanitizeControl(env.ctl);
    if (!msg) return;
    if (msg.type !== 'ping' && msg.type !== 'pong') this.markIdleActivity();
    // The host passes guests' messages on to the other guests
    if (this.isHost && via) this.relay(JSON.stringify({ ctl: msg, from, to: env.to }), via.remoteId, 'control');
    if (env.to && env.to !== this.localPeerId) return;

    switch (msg.type) {
      case 'hello':
        if (this.isHost) {
          this.members.set(from, {
            peerId: from,
            name: msg.name,
            code: msg.code,
            color: msg.color,
            vehicle: msg.vehicle,
            trackId: msg.trackId,
            ready: this.members.get(from)?.ready ?? false,
            isHost: false,
          });
          this.memberSeenMs.set(from, performance.now());
          this.broadcastLobby();
        }
        break;
      case 'ready':
        if (this.isHost) {
          const m = this.members.get(from);
          if (m) {
            m.ready = msg.ready;
            this.broadcastLobby();
          }
        }
        break;
      case 'ping':
        this.sendControl({ type: 'pong', t0: msg.t0, now: performance.now() + this.clockOffsetMs }, from);
        break;
      case 'pong': {
        const t1 = performance.now();
        const rtt = Math.max(0, t1 - msg.t0);
        const prev = this.rtts.get(from);
        this.rtts.set(from, prev === undefined ? rtt : prev + (rtt - prev) * 0.25);
        // Clock sync against the host (NTP-style, keeping the lowest-latency measurement; slowly forgets it)
        if (!this.isHost && from === this.hostId) {
          this.bestClockRttMs = Math.min(this.bestClockRttMs * 1.02 + 0.5, Infinity);
          if (rtt <= this.bestClockRttMs) {
            this.bestClockRttMs = rtt;
            this.clockOffsetMs = msg.now + rtt / 2 - t1;
          }
        }
        break;
      }
      case 'lobby':
        if (this.isHost) break;
        if (this.hostId !== msg.lobby.hostId) {
          this.hostId = msg.lobby.hostId;
          this.bestClockRttMs = Infinity;
          this.sendControl({ type: 'hello', ...this.identity, vehicle: this.localVehicle, trackId: this.localTrackId });
          if (this.localReady) this.sendControl({ type: 'ready', ready: true });
        }
        this.setLobby(msg.lobby);
        break;
      case 'start':
        if (this.isHost || from !== this.hostId) break;
        if (this.activeRace?.id === msg.start.id) break;
        this.activeRace = msg.start;
        this.onRaceStart?.(msg.start);
        break;
      case 'abort':
        if (from !== this.hostId || this.activeRace?.id !== msg.id) break;
        this.activeRace = null;
        this.onRaceAbort?.(msg.id);
        break;
      case 'leave':
        if (this.isHost) {
          this.dropMember(from);
        } else if (from === this.hostId) {
          this.hostId = null;
          this.setLobby(null);
          this.emitStatus({ state: 'idle', statusText: '房主已断开连接。' });
        }
        break;
    }
  }

  /** Pings, lobby heartbeats and member time-outs; called from update() */
  private tickControl(nowMs: number): void {
    if (nowMs - this.lastPingMs > (this.clockSynced ? 2000 : 400)) {
      this.lastPingMs = nowMs;
      if (this.hostId || this.peers.size > 0) this.sendControl({ type: 'ping', t0: nowMs });
    }
    if (this.isHost) {
      for (const [id, seen] of this.memberSeenMs) {
        const buf = this.peers.get(id);
        const last = Math.max(seen, buf?.lastReceivedMs ?? 0);
        if (nowMs - last > 8000) this.dropMember(id);
      }
      if (nowMs - this.lastLobbyMs > 3000) this.broadcastLobby();
    }
  }

  /**
   * 100% Brokerless Manual SDP Offer Generator (works forever with zero servers).
   */
  public async createManualOffer(): Promise<string> {
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      return '';
    }
    await ensureRuntimeTurn();
    const remoteId = `manual_${Math.random().toString(36).slice(2, 7)}`;
    this.becomeHost();
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.manualPendingPc = pc;

    const dc = pc.createDataChannel(STATE_CHANNEL, {
      ordered: false,
      maxRetransmits: 0,
    });
    const ctl = pc.createDataChannel(CONTROL_CHANNEL, { ordered: true });
    const entry: WebRtcPeerEntry = { remoteId, pc, dc, ctl };
    this.rtcPeers.set(remoteId, entry);
    this.bindDataChannel(remoteId, dc);
    this.bindControlChannel(entry, ctl);

    this.emitStatus({
      mode: 'manual_sdp',
      state: 'signaling',
      statusText: '正在收集手动邀请的 STUN ICE 候选…',
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIceGathering(pc, 1800);

    const token = btoa(JSON.stringify(pc.localDescription));
    this.emitStatus({
      mode: 'manual_sdp',
      state: 'signaling',
      statusText: '邀请已就绪 — 发送给对手并粘贴对方的答复',
    });
    return token;
  }

  /**
   * Accepts a base64 Manual SDP Offer and returns a base64 SDP Answer token.
   */
  public async acceptManualOfferAndCreateAnswer(offerToken: string): Promise<string> {
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      return '';
    }
    await ensureRuntimeTurn();
    const remoteId = `manual_host_${Math.random().toString(36).slice(2, 7)}`;
    this.becomeGuest();
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const entry: WebRtcPeerEntry = { remoteId, pc, dc: null };
    this.rtcPeers.set(remoteId, entry);
    pc.ondatachannel = (ev) => this.acceptChannel(entry, ev.channel);

    const offerDesc = JSON.parse(atob(offerToken.trim()));
    await pc.setRemoteDescription(new RTCSessionDescription(offerDesc));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.waitForIceGathering(pc, 1800);

    const answerToken = btoa(JSON.stringify(pc.localDescription));
    this.emitStatus({
      mode: 'manual_sdp',
      state: 'signaling',
      statusText: '答复已生成 — 发回给房主以完成连接！',
    });
    return answerToken;
  }

  /**
   * Completes the manual WebRTC P2P handshake on the host using the guest's Answer token.
   */
  public async acceptManualAnswer(answerToken: string): Promise<void> {
    if (!this.manualPendingPc) return;
    const answerDesc = JSON.parse(atob(answerToken.trim()));
    await this.manualPendingPc.setRemoteDescription(
      new RTCSessionDescription(answerDesc)
    );
    this.emitStatus({
      mode: 'manual_sdp',
      state: 'connected',
      statusText: '手动 WebRTC 点对点握手完成！',
    });
  }

  private waitForIceGathering(
    pc: RTCPeerConnection,
    timeoutMs: number
  ): Promise<void> {
    if (pc.iceGatheringState === 'complete') {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, timeoutMs);
      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', checkState);
    });
  }

  private clearJoinTimeout(): void {
    if (this.joinTimeout !== null) {
      clearTimeout(this.joinTimeout);
      this.joinTimeout = null;
    }
  }

  private hasOpenDataChannel(): boolean {
    for (const entry of this.rtcPeers.values()) {
      if (entry.dc && entry.dc.readyState === 'open') return true;
    }
    return false;
  }

  private clearIceTimeout(remoteId: string): void {
    const timer = this.iceTimeouts.get(remoteId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.iceTimeouts.delete(remoteId);
    }
  }

  private clearAllIceTimeouts(): void {
    for (const timer of this.iceTimeouts.values()) clearTimeout(timer);
    this.iceTimeouts.clear();
  }

  /**
   * ICE watchdog, broker modes only (manual SDP is untouched: it never calls
   * this). Starts once offer/answer exchange has finished. If 20 s later the
   * data channel still is not open and ICE is not connected, the peer is
   * dropped and — when it was the last peer — the panel gets a direct-connect
   * failure with the next steps, instead of an endless "正在连接房间…".
   * Browsers can sit in ICE 'checking' indefinitely when no candidate pair
   * works (e.g. both sides behind NAT with STUN unreachable), which is
   * exactly the state the 30 s join timer alone cannot distinguish from a
   * lost signaling message.
   */
  private startIceTimeout(remoteId: string): void {
    this.clearIceTimeout(remoteId);
    const timer = setTimeout(() => {
      this.iceTimeouts.delete(remoteId);
      const entry = this.rtcPeers.get(remoteId);
      const pc = entry?.pc;
      if (!pc) return;
      const dcOpen = entry?.dc?.readyState === 'open';
      const iceOk =
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed' ||
        pc.connectionState === 'connected';
      if (dcOpen || iceOk) return;
      if (this.status.mode !== 'room_guest' && this.status.mode !== 'room_host') return;
      try {
        pc.close();
      } catch {
        // Ignore close error
      }
      this.rtcPeers.delete(remoteId);
      if (this.rtcPeers.size > 0) return;
      this.clearJoinTimeout();
      this.emitStatus({
        state: 'error',
        statusText:
          '直连失败：20 秒内未能建立点对点连接。请使用同一 Wi-Fi，或在“高级”中添加 TURN 中继后重试。',
      });
    }, 20000);
    this.iceTimeouts.set(remoteId, timer);
  }

  /** Closes peer connections whose data channel never opened (a pending join attempt only) */
  private closeUnopenedPeers(): void {
    for (const entry of [...this.rtcPeers.values()]) {
      if (entry.dc && entry.dc.readyState === 'open') continue;
      this.clearIceTimeout(entry.remoteId);
      try {
        entry.pc.close();
      } catch {
        // Ignore close error
      }
      this.rtcPeers.delete(entry.remoteId);
    }
  }

  /** Abandons a join that is still waiting for the host; a connected room is untouched */
  public cancelJoin(): void {
    if (this.status.mode !== 'room_guest' || this.status.state !== 'signaling') return;
    this.clearJoinTimeout();
    this.clearAllIceTimeouts();
    this.closeUnopenedPeers();
    this.closeSignaling();
    this.emitStatus({
      mode: 'local',
      roomCode: '',
      state: 'idle',
      statusText: '已取消加入房间',
    });
  }

  // NOTE: closeSignaling() deliberately does NOT clear the join timer. It is
  // called from paths that run during a pending join (a newer join/host, the
  // timeout callback itself, dispose), and clearing here used to disarm the
  // watchdog mid-attempt. Callers that mean "abandon this join" clear the
  // timer explicitly (cancelJoin, join success, dispose, a newer join/host).
  private closeSignaling(): void {
    if (this.signalingWs) {
      try {
        this.signalingWs.close();
      } catch {
        // Ignore close error
      }
      this.signalingWs = null;
    }
  }

  /**
   * Ingests a 20-30 Hz network state packet into the peer's ring buffer.
   * Uses an EWMA clock-offset estimator (`localClockMs - pkt.timestampMs`) so the sender's
   * physics timestamps (`dt`) are preserved for Cubic Hermite spline tangents without network arrival jitter.
   * `receiveClockMs` is the arrival time on the clock `update()` is given (default `performance.now()`, the clock of
   * requestAnimationFrame's timestamp); pass it when driving `update()` from another clock.
   */
  public ingestPacket(pkt: NetworkVehiclePacket, isAiPeer = false, receiveClockMs?: number): void {
    const now =
      receiveClockMs !== undefined && Number.isFinite(receiveClockMs)
        ? receiveClockMs
        : typeof performance !== 'undefined'
          ? performance.now()
          : Date.now();
    let buffer = this.peers.get(pkt.peerId);
    if (!buffer) {
      buffer = {
        peerId: pkt.peerId,
        driverCode: pkt.driverCode,
        teamColorHex: pkt.teamColorHex,
        isAiPeer,
        lastSeq: -1,
        seqWindow: { received: 0, expected: 0, startMs: now },
        lossPct: 0,
        lastArrivalMs: now,
        jitterMs: 0,
        snapshots: [],
        lastReceivedMs: now,
        clockOffsetMs: null,
        lastSenderTimestampMs: -Infinity,
        renderedState: {
          peerId: pkt.peerId,
          driverCode: pkt.driverCode,
          teamColorHex: pkt.teamColorHex,
          position: new THREE.Vector3(...pkt.pos),
          quaternion: new THREE.Quaternion(...pkt.quat),
          linearVelocity: new THREE.Vector3(...pkt.linVel),
          steerAngle: pkt.steerAngle,
          wheelRPMs: [...pkt.wheelRPMs],
          throttle: pkt.throttle,
          brake: pkt.brake,
          trackS: pkt.trackS,
          speedKmh: pkt.speedKmh,
          isAiPeer,
        },
        predict: {
          corrPos: new THREE.Vector3(),
          corrQuat: new THREE.Quaternion(),
          newestTs: -Infinity,
          lastMs: 0,
          graceUntilMs: 0,
          primed: false,
        },
      };
      this.peers.set(pkt.peerId, buffer);
    }

    let syncedTimestampMs = now;
    if (Number.isFinite(pkt.timestampMs)) {
      // Drop out-of-order UDP packets: judged on the sender's own clock, which the offset filter cannot reorder. A
      // jump back by more than a second is the sender's clock restarting (page reload), not a late packet
      const senderBackMs = buffer.lastSenderTimestampMs - pkt.timestampMs;
      if (senderBackMs >= 0 && senderBackMs < SENDER_CLOCK_RESTART_MS) return;
      buffer.lastSenderTimestampMs = pkt.timestampMs;
      const rawOffset = now - pkt.timestampMs;
      if (buffer.clockOffsetMs === null || Math.abs(rawOffset - buffer.clockOffsetMs) > CLOCK_OFFSET_SNAP_MS) {
        // First packet, or the sender's clock jumped (reload, reconnect): take the offset as measured, and drop
        // the snapshots stamped against the old one
        if (buffer.clockOffsetMs !== null) buffer.snapshots.length = 0;
        buffer.clockOffsetMs = rawOffset;
      } else {
        // Soft EWMA clock-offset slew (5%) rejects per-packet network jitter while tracking clock drift
        buffer.clockOffsetMs += (rawOffset - buffer.clockOffsetMs) * 0.05;
      }
      syncedTimestampMs = pkt.timestampMs + buffer.clockOffsetMs;
      // Keep the local stamps strictly increasing while the offset slews
      const lastSnap = buffer.snapshots[buffer.snapshots.length - 1];
      if (lastSnap && syncedTimestampMs <= lastSnap.timestampMs) syncedTimestampMs = lastSnap.timestampMs + 1;
    }
    // Loss from gaps in the sender's counter (5 s windows), jitter from the spread of arrival intervals
    if (typeof pkt.seq === 'number' && Number.isFinite(pkt.seq)) {
      const w = buffer.seqWindow;
      w.received++;
      w.expected += buffer.lastSeq >= 0 && pkt.seq > buffer.lastSeq ? Math.min(100, pkt.seq - buffer.lastSeq) : 1;
      buffer.lastSeq = pkt.seq;
      if (now - w.startMs > 5000) {
        buffer.lossPct = w.expected > 0 ? Math.max(0, Math.round((1 - w.received / w.expected) * 1000) / 10) : 0;
        w.received = 0;
        w.expected = 0;
        w.startMs = now;
      }
    }
    const interval = now - buffer.lastArrivalMs;
    buffer.jitterMs += (Math.abs(interval - this.broadcastIntervalMs) - buffer.jitterMs) * 0.1;
    buffer.lastArrivalMs = now;
    buffer.lastReceivedMs = now;
    // Identity can change mid-session (profile edit)
    if (typeof pkt.driverCode === 'string') buffer.driverCode = asCode(pkt.driverCode);
    if (typeof pkt.teamColorHex === 'string') buffer.teamColorHex = asColor(pkt.teamColorHex);
    buffer.renderedState.driverCode = buffer.driverCode;
    buffer.renderedState.teamColorHex = buffer.teamColorHex;
    buffer.renderedState.name = typeof pkt.name === 'string' ? clampStr(pkt.name, 16, buffer.driverCode) : undefined;
    buffer.renderedState.rainbow = pkt.rainbow === true;
    buffer.renderedState.race = sanitizeRace(pkt.race);
    // The sender may switch car or circuit mid-session
    buffer.renderedState.vehicle = asPeerVehicle(pkt.vehicle);
    buffer.renderedState.trackId = typeof pkt.trackId === 'string' ? pkt.trackId.slice(0, 64) : undefined;

    const localPacket: NetworkVehiclePacket = {
      ...pkt,
      timestampMs: syncedTimestampMs,
    };
    buffer.snapshots.push(localPacket);
    if (buffer.snapshots.length > 12) {
      buffer.snapshots.shift();
    }
  }

  /**
   * Publishes local player vehicle state at 25 Hz (every 40ms) across BroadcastChannel + WebRTC DataChannels
   * and returns the interpolated remote peers.
   */
  public update(
    nowMs: number,
    localPacket: Omit<NetworkVehiclePacket, 'peerId' | 'timestampMs'>
  ): InterpolatedPeerState[] {
    // Driving counts as activity (so solo practice in a room never trips
    // the idle timer); a race in progress is handled by checkIdle() itself.
    if (
      Math.abs(localPacket.throttle) > 0.05 ||
      Math.abs(localPacket.brake) > 0.05 ||
      Math.abs(localPacket.steerAngle) > 0.05 ||
      Math.abs(localPacket.speedKmh) > 5
    ) {
      this.markIdleActivity();
    }
    if (nowMs - this.lastBroadcastMs >= this.broadcastIntervalMs) {
      this.lastBroadcastMs = nowMs;
      const fullPacket: NetworkVehiclePacket = {
        ...localPacket,
        peerId: this.localPeerId,
        timestampMs: nowMs,
        seq: this.seq++,
      };
      const serialized = JSON.stringify(fullPacket);

      if (this.channel) {
        try {
          this.channel.postMessage(fullPacket);
        } catch {
          // Ignore postMessage failure
        }
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(serialized);
        } catch {
          // Ignore send failure
        }
      }
      for (const entry of this.rtcPeers.values()) {
        if (entry.dc && entry.dc.readyState === 'open') {
          try {
            entry.dc.send(serialized);
          } catch {
            // Ignore DataChannel send failure
          }
        }
      }
    }

    this.tickControl(nowMs);

    const renderTimeMs = nowMs - this.interpolationDelayMs;
    const activeStates: InterpolatedPeerState[] = [];

    for (const [peerId, buf] of this.peers.entries()) {
      if (!buf.isAiPeer && nowMs - buf.lastReceivedMs > 5000) {
        this.peers.delete(peerId);
        continue;
      }
      if (this.predictRemotePlayers && !buf.isAiPeer) this.predictPeer(buf, nowMs);
      else this.interpolatePeer(buf, renderTimeMs);
      activeStates.push(buf.renderedState);
    }

    return activeStates;
  }

  /** Round-trip time to a peer (ms), for transports that don't ping (and tests); the pings overwrite it */
  public setPeerRttMs(peerId: string, rttMs: number): void {
    if (Number.isFinite(rttMs) && rttMs >= 0) this.rtts.set(peerId, rttMs);
  }

  /**
   * A human peer where it is now: the newest snapshot carried forward by its age plus the one-way latency (half the
   * measured round trip), at the acceleration between the last two snapshots, the heading turned at the yaw rate.
   * What you see is then what you can touch. The jump a new packet makes in the prediction blends out over
   * PREDICT_SMOOTH_S; a big one (a reset) snaps and holds contact off for a moment.
   */
  private predictPeer(buf: PeerSnapshotBuffer, nowMs: number): void {
    const snaps = buf.snapshots;
    const out = buf.renderedState;
    const p = buf.predict;
    if (snaps.length === 0) {
      out.contactReady = false;
      return;
    }
    const s1 = snaps[snaps.length - 1];
    const s0 = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const oneWayMs = (this.rtts.get(buf.peerId) ?? 0) / 2;
    const ageS = (nowMs - s1.timestampMs + oneWayMs) / 1000;
    const h = Math.min(PREDICT_MAX_S, Math.max(0, ageS));
    let ax = 0;
    let ay = 0;
    let az = 0;
    if (s0) {
      const d = (s1.timestampMs - s0.timestampMs) / 1000;
      if (d > 0.005 && d < 0.25) {
        ax = (s1.linVel[0] - s0.linVel[0]) / d;
        ay = (s1.linVel[1] - s0.linVel[1]) / d;
        az = (s1.linVel[2] - s0.linVel[2]) / d;
        const a = Math.hypot(ax, ay, az);
        if (a > PREDICT_MAX_ACCEL_MS2) {
          const k = PREDICT_MAX_ACCEL_MS2 / a;
          ax *= k;
          ay *= k;
          az *= k;
        }
      }
    }
    const yawRate = Number.isFinite(s1.angVel?.[1]) ? s1.angVel[1] : 0;
    // Raw prediction (a yaw rate + is turning right: clockwise about +Y)
    const rawPos = this.tempVec0.set(
      s1.pos[0] + s1.linVel[0] * h + 0.5 * ax * h * h,
      s1.pos[1] + s1.linVel[1] * h + 0.5 * ay * h * h,
      s1.pos[2] + s1.linVel[2] * h + 0.5 * az * h * h
    );
    const rawQuat = this.tempQuat0.setFromAxisAngle(AXIS_Y, -yawRate * h).multiply(this.tempQuat1.set(...s1.quat));

    const frameS = p.lastMs > 0 ? Math.min(0.1, Math.max(0, (nowMs - p.lastMs) / 1000)) : 0;
    if (!p.primed) {
      p.corrPos.set(0, 0, 0);
      p.corrQuat.identity();
      p.graceUntilMs = nowMs + PREDICT_GRACE_MS;
      p.primed = true;
    } else if (s1.timestampMs !== p.newestTs) {
      // A new packet: carry on from where the car was shown, moved on over this frame
      const shown = this.tempVec1.copy(out.position).addScaledVector(out.linearVelocity, frameS);
      p.corrPos.copy(shown).sub(rawPos);
      if (p.corrPos.length() > PREDICT_SNAP_M) {
        p.corrPos.set(0, 0, 0);
        p.corrQuat.identity();
        p.graceUntilMs = nowMs + PREDICT_GRACE_MS;
      } else {
        const shownQuat = this.tempQuat1.setFromAxisAngle(AXIS_Y, -(out.yawRateRadS ?? 0) * frameS).multiply(out.quaternion);
        p.corrQuat.copy(shownQuat).multiply(this.tempQuat2.copy(rawQuat).invert());
      }
    } else {
      const keep = Math.exp(-frameS / PREDICT_SMOOTH_S);
      p.corrPos.multiplyScalar(keep);
      p.corrQuat.slerp(this.tempQuat1.identity(), 1 - keep);
    }
    p.newestTs = s1.timestampMs;
    p.lastMs = nowMs;

    out.position.copy(rawPos).add(p.corrPos);
    out.quaternion.copy(p.corrQuat).multiply(rawQuat);
    out.linearVelocity.set(s1.linVel[0] + ax * h, s1.linVel[1] + ay * h, s1.linVel[2] + az * h);
    out.yawRateRadS = yawRate;
    out.steerAngle = s1.steerAngle;
    out.wheelRPMs = [...s1.wheelRPMs];
    out.throttle = s1.throttle;
    out.brake = s1.brake;
    out.trackS = s1.trackS;
    out.speedKmh = s1.speedKmh;
    out.contactReady = s0 !== null && ageS <= PREDICT_MAX_S && nowMs >= p.graceUntilMs;
  }

  /**
   * Cubic Hermite position/velocity spline interpolation + Quaternion slerp
   * or dead-reckoning extrapolation when renderTimeMs > latest snapshot.
   */
  private interpolatePeer(buf: PeerSnapshotBuffer, renderTimeMs: number): void {
    const snaps = buf.snapshots;
    const out = buf.renderedState;
    if (snaps.length === 0) return;

    if (snaps.length === 1) {
      const s = snaps[0];
      out.position.set(...s.pos);
      out.quaternion.set(...s.quat);
      out.linearVelocity.set(...s.linVel);
      out.steerAngle = s.steerAngle;
      out.wheelRPMs = [...s.wheelRPMs];
      out.throttle = s.throttle;
      out.brake = s.brake;
      out.trackS = s.trackS;
      out.speedKmh = s.speedKmh;
      return;
    }

    let idx0 = snaps.length - 2;
    for (let i = 0; i < snaps.length - 1; i++) {
      if (renderTimeMs >= snaps[i].timestampMs && renderTimeMs <= snaps[i + 1].timestampMs) {
        idx0 = i;
        break;
      }
    }

    const s0 = snaps[idx0];
    const s1 = snaps[idx0 + 1];
    const dtMs = Math.max(1, s1.timestampMs - s0.timestampMs);
    const dtSec = dtMs * 0.001;
    const rawT = (renderTimeMs - s0.timestampMs) / dtMs;

    if (rawT <= 1.0) {
      const t = Math.max(0, rawT);
      const t2 = t * t;
      const t3 = t2 * t;

      // Cubic Hermite basis functions
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = (t3 - 2 * t2 + t) * dtSec;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = (t3 - t2) * dtSec;

      out.position.set(
        h00 * s0.pos[0] + h10 * s0.linVel[0] + h01 * s1.pos[0] + h11 * s1.linVel[0],
        h00 * s0.pos[1] + h10 * s0.linVel[1] + h01 * s1.pos[1] + h11 * s1.linVel[1],
        h00 * s0.pos[2] + h10 * s0.linVel[2] + h01 * s1.pos[2] + h11 * s1.linVel[2]
      );

      this.tempQuat0.set(...s0.quat);
      this.tempQuat1.set(...s1.quat);
      out.quaternion.copy(this.tempQuat0).slerp(this.tempQuat1, t);

      out.linearVelocity.set(
        s0.linVel[0] + (s1.linVel[0] - s0.linVel[0]) * t,
        s0.linVel[1] + (s1.linVel[1] - s0.linVel[1]) * t,
        s0.linVel[2] + (s1.linVel[2] - s0.linVel[2]) * t
      );
      out.steerAngle = s0.steerAngle + (s1.steerAngle - s0.steerAngle) * t;
      out.throttle = s0.throttle + (s1.throttle - s0.throttle) * t;
      out.brake = s0.brake + (s1.brake - s0.brake) * t;
      out.trackS = s1.trackS;
      out.speedKmh = Math.round(s0.speedKmh + (s1.speedKmh - s0.speedKmh) * t);
      out.wheelRPMs = [
        s0.wheelRPMs[0] + (s1.wheelRPMs[0] - s0.wheelRPMs[0]) * t,
        s0.wheelRPMs[1] + (s1.wheelRPMs[1] - s0.wheelRPMs[1]) * t,
        s0.wheelRPMs[2] + (s1.wheelRPMs[2] - s0.wheelRPMs[2]) * t,
        s0.wheelRPMs[3] + (s1.wheelRPMs[3] - s0.wheelRPMs[3]) * t,
      ];
    } else {
      const extrapSec = Math.min(0.12, (renderTimeMs - s1.timestampMs) * 0.001);
      out.position.set(
        s1.pos[0] + s1.linVel[0] * extrapSec,
        s1.pos[1] + s1.linVel[1] * extrapSec,
        s1.pos[2] + s1.linVel[2] * extrapSec
      );
      out.quaternion.set(...s1.quat);
      out.linearVelocity.set(...s1.linVel);
      out.steerAngle = s1.steerAngle;
      out.wheelRPMs = [...s1.wheelRPMs];
      out.throttle = s1.throttle;
      out.brake = s1.brake;
      out.trackS = s1.trackS;
      out.speedKmh = s1.speedKmh;
    }
  }

  public dispose(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.clearJoinTimeout();
    this.clearAllIceTimeouts();
    this.closeSignaling();
    for (const entry of this.rtcPeers.values()) {
      try {
        entry.dc?.close();
        entry.pc.close();
      } catch {
        // Ignore close error
      }
    }
    this.rtcPeers.clear();
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

let sharedManager: MultiplayerSyncManager | null = null;

/**
 * The page's one multiplayer connection. It outlives the simulator component, so a guest who switches to the
 * host's circuit (which remounts the simulator) stays in the room.
 */
export function getMultiplayerManager(): MultiplayerSyncManager {
  sharedManager ??= new MultiplayerSyncManager();
  return sharedManager;
}
