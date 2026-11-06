/**
 * Reference leaderboard backend for the simulator: a Cloudflare Worker storing laps in KV.
 * Routes: POST /laps, GET /laps?track=&vehicle=&limit=, GET /laps/:id.
 * Validation and plausibility checks are heuristics, not cheat-proof.
 * Self-contained: the minimal KV and Env types are declared here, no workers-types dependency.
 */

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Env {
  LAPS: KVNamespace;
  ALLOWED_ORIGIN?: string;
}

/** One wall-return teleport inside a lap (mirrors src/lib/sim/buff-pack.ts) */
interface WallReturnEvent {
  t: number;
  sBefore: number;
  sAfter: number;
  speedKmh: number;
}

/** One instant-replay flashback teleport inside a lap (mirrors src/lib/sim/buff-pack.ts). Flashback is free: no penalty field, the lap counts at its raw time; the event exists only to explain the sample jump. */
interface FlashbackEvent {
  t: number;
  sBefore: number;
  sAfter: number;
  speedKmh: number;
}

/** Mirrors LapRecording in src/lib/sim/lap-types.ts */
interface LapRecording {
  version: 1;
  trackId: string;
  vehicle: string;
  driverName: string;
  driverCode: string;
  lapTimeMs: number;
  sectorTimesMs: [number, number, number];
  recordedAt: number;
  sampleHz: number;
  data: number[];
  wallReturns?: WallReturnEvent[];
  flashbacks?: FlashbackEvent[];
  /** Track-limits penalty (ms, +3000 per strike). lapTimeMs is the classified time (raw + penalties). */
  trackLimitsPenaltyMs?: number;
  /** Autopilot penalty (ms, +30000 once). Flashback adds nothing. */
  autopilotPenaltyMs?: number;
}

/** One row of a board: a lap without its samples */
interface BoardEntry {
  id: string;
  name: string;
  code: string;
  lapTimeMs: number;
  sectorTimesMs: [number, number, number];
  vehicle: string;
  trackId: string;
  recordedAt: number;
}

type Parsed = { ok: true; rec: LapRecording } | { ok: false; error: string };

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_POSTS_PER_HOUR = 10;
const MAX_BOARD_ENTRIES = 100;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_LAP_MS = 3_600_000;
const MAX_SPEED_KMH = 420;
const MAX_TIME_DRIFT_S = 1.5;
const MAX_SECTOR_DRIFT_MS = 50;
const MIN_PAIR_DT_S = 0.02;
const MIN_SAMPLES = 10;
const MAX_SAMPLES = 20000;
/** Wall-return teleports: at most this many per lap, each moving the car at most this far and resuming at most this speed */
const MAX_WALL_RETURNS_PER_LAP = 5;
const MAX_WALL_RETURN_JUMP_M = 50;
const MAX_WALL_RETURN_SPEED_KMH = 60;
/** Flashback teleports: at most this many per lap; the jump may be far backwards (up to the 90 s replay window), so no displacement cap, only the plausibility speed cap */
const MAX_FLASHBACKS_PER_LAP = 10;
const MAX_FLASHBACK_SPEED_KMH = 420;
/** Autopilot penalty: exactly this value when present, never any other amount */
const AUTOPILOT_PENALTY_MS = 30000;
/** Number of values per sample: t, s, x, y, z, qx, qy, qz, qw, speedKmh, throttle, brake, steer, gear */
const SAMPLE_STRIDE = 14;
const VEHICLES = ["vf26", "f12026-car", "amg-gt3"];
const TRACK_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env), "Content-Type": "application/json" },
  });
}

function fail(env: Env, error: string, status = 400): Response {
  return jsonResponse(env, { ok: false, error }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampLimit(raw: string | null): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  return Number.isFinite(n) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(n))) : DEFAULT_LIMIT;
}

/** Checks the shape and the plausibility of an uploaded recording */
function parseRecording(raw: unknown): Parsed {
  const bad = (error: string): Parsed => ({ ok: false, error });
  if (!isRecord(raw)) return bad("Recording must be an object");
  if (raw.version !== 1) return bad("Unsupported version");

  const trackId = raw.trackId;
  if (typeof trackId !== "string" || !TRACK_PATTERN.test(trackId)) return bad("Invalid trackId");
  const vehicle = raw.vehicle;
  if (typeof vehicle !== "string" || !VEHICLES.includes(vehicle)) return bad("Invalid vehicle");

  const driverName = typeof raw.driverName === "string" ? raw.driverName.trim() : "";
  if (driverName.length === 0 || driverName.length > 64) return bad("Invalid driverName");
  const driverCode = typeof raw.driverCode === "string" ? raw.driverCode.trim() : "";
  if (driverCode.length === 0 || driverCode.length > 16) return bad("Invalid driverCode");

  const lapTimeMs = raw.lapTimeMs;
  if (!isFiniteNumber(lapTimeMs) || lapTimeMs <= 0 || lapTimeMs > MAX_LAP_MS) return bad("Invalid lapTimeMs");
  const recordedAt = raw.recordedAt;
  if (!isFiniteNumber(recordedAt) || recordedAt <= 0) return bad("Invalid recordedAt");
  const sampleHz = raw.sampleHz;
  if (!isFiniteNumber(sampleHz) || sampleHz <= 0 || sampleHz > 1000) return bad("Invalid sampleHz");

  const sectors = raw.sectorTimesMs;
  if (!Array.isArray(sectors) || sectors.length !== 3 || !sectors.every((v) => isFiniteNumber(v) && v >= 0)) {
    return bad("Invalid sectorTimesMs");
  }
  const [s0, s1, s2] = sectors as [number, number, number];
  // Penalties: track limits +3000 ms per strike, autopilot +30000 ms once, flashback
  // free (0). Declaring a penalty only makes the uploaded time slower, so there is
  // nothing to gain by forging one. The raw driven time (classified minus penalties)
  // is what the samples must match. Sectors must match the raw time too, except on
  // flashback laps, where rewinding across a sector boundary re-records a sector and
  // the three sectors no longer partition the lap clock.
  const penaltyRaw = raw.trackLimitsPenaltyMs;
  const trackLimitsPenaltyMs =
    penaltyRaw === undefined ? 0 : typeof penaltyRaw === "number" && Number.isInteger(penaltyRaw) ? penaltyRaw : -1;
  if (trackLimitsPenaltyMs < 0 || trackLimitsPenaltyMs % 3000 !== 0) {
    return bad("Invalid trackLimitsPenaltyMs");
  }
  const autopilotRaw = raw.autopilotPenaltyMs;
  const autopilotPenaltyMs =
    autopilotRaw === undefined ? 0 : typeof autopilotRaw === "number" && Number.isInteger(autopilotRaw) ? autopilotRaw : -1;
  if (autopilotPenaltyMs < 0 || (autopilotPenaltyMs !== 0 && autopilotPenaltyMs !== AUTOPILOT_PENALTY_MS)) {
    return bad("Invalid autopilotPenaltyMs");
  }
  const totalPenaltyMs = trackLimitsPenaltyMs + autopilotPenaltyMs;
  if (totalPenaltyMs >= lapTimeMs) {
    return bad("Invalid penalty total");
  }
  const rawLapTimeMs = lapTimeMs - totalPenaltyMs;
  const hasFlashbacks = Array.isArray(raw.flashbacks) && raw.flashbacks.length > 0;
  if (!hasFlashbacks && Math.abs(s0 + s1 + s2 - rawLapTimeMs) > MAX_SECTOR_DRIFT_MS) {
    return bad("Sector times do not add up to the lap time");
  }

  const data = raw.data;
  if (!Array.isArray(data) || data.length % SAMPLE_STRIDE !== 0 || !data.every(isFiniteNumber)) {
    return bad("Invalid data");
  }
  const samples = data as number[];
  const count = samples.length / SAMPLE_STRIDE;
  if (count < MIN_SAMPLES || count > MAX_SAMPLES) return bad("Recording has too few or too many samples");

  // Per-sample ranges and monotonic time
  let prevT = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * SAMPLE_STRIDE;
    const t = samples[o];
    if (t < prevT) return bad("Sample times must not go backwards");
    prevT = t;
    const speed = samples[o + 9];
    const throttle = samples[o + 10];
    const brake = samples[o + 11];
    const steer = samples[o + 12];
    const gear = samples[o + 13];
    if (speed < 0 || speed > MAX_SPEED_KMH) return bad("Sample speed out of range");
    if (throttle < 0 || throttle > 1 || brake < 0 || brake > 1) return bad("Pedal value out of range");
    if (steer < -1 || steer > 1) return bad("Steering value out of range");
    if (!Number.isInteger(gear) || gear < -1 || gear > 8) return bad("Gear out of range");
  }

  // The last sample time must agree with the raw driven lap time (not the classified time)
  const lastT = samples[(count - 1) * SAMPLE_STRIDE];
  if (Math.abs(rawLapTimeMs / 1000 - lastT) > MAX_TIME_DRIFT_S) {
    return bad("Lap time does not match the samples");
  }

  // Wall-return events, if any: well-formed, within the per-lap limit, each a small
  // move at a low resume speed. A forged event cannot hide a large jump, because the
  // pair check below still requires the event to match the jump it claims to explain.
  let wallReturns: WallReturnEvent[] = [];
  if (raw.wallReturns !== undefined) {
    if (!Array.isArray(raw.wallReturns) || raw.wallReturns.length > MAX_WALL_RETURNS_PER_LAP) {
      return bad("Invalid wallReturns");
    }
    for (const ev of raw.wallReturns) {
      if (!isRecord(ev)) return bad("Invalid wallReturns");
      const t = ev.t;
      const sBefore = ev.sBefore;
      const sAfter = ev.sAfter;
      const speedKmh = ev.speedKmh;
      if (!isFiniteNumber(t) || !isFiniteNumber(sBefore) || !isFiniteNumber(sAfter) || !isFiniteNumber(speedKmh)) {
        return bad("Invalid wallReturns");
      }
      if (t < 0 || t > lapTimeMs / 1000) return bad("Invalid wallReturns");
      if (sBefore < 0 || sAfter < 0) return bad("Invalid wallReturns");
      if (Math.abs(sAfter - sBefore) > MAX_WALL_RETURN_JUMP_M) return bad("Invalid wallReturns");
      if (speedKmh < 0 || speedKmh > MAX_WALL_RETURN_SPEED_KMH) return bad("Invalid wallReturns");
      wallReturns.push({ t, sBefore, sAfter, speedKmh });
    }
  }

  // Flashback events, if any: well-formed, within the per-lap limit, resume speed
  // within the plausibility cap. Unlike wall returns, the jump may be far backwards
  // (the replay window is 90 s), so no displacement cap is applied here — the pair
  // check below still requires the event to match the jump it claims to explain.
  let flashbacks: FlashbackEvent[] = [];
  if (raw.flashbacks !== undefined) {
    if (!Array.isArray(raw.flashbacks) || raw.flashbacks.length > MAX_FLASHBACKS_PER_LAP) {
      return bad("Invalid flashbacks");
    }
    for (const ev of raw.flashbacks) {
      if (!isRecord(ev)) return bad("Invalid flashbacks");
      const t = ev.t;
      const sBefore = ev.sBefore;
      const sAfter = ev.sAfter;
      const speedKmh = ev.speedKmh;
      if (!isFiniteNumber(t) || !isFiniteNumber(sBefore) || !isFiniteNumber(sAfter) || !isFiniteNumber(speedKmh)) {
        return bad("Invalid flashbacks");
      }
      if (t < 0 || t > lapTimeMs / 1000) return bad("Invalid flashbacks");
      if (sBefore < 0 || sAfter < 0) return bad("Invalid flashbacks");
      if (speedKmh < 0 || speedKmh > MAX_FLASHBACK_SPEED_KMH) return bad("Invalid flashbacks");
      flashbacks.push({ t, sBefore, sAfter, speedKmh });
    }
  }

  // Plausibility: consecutive samples must not imply a teleport (speed from positions).
  // The final pair is skipped: finishLap's closing sample is timestamped at the interpolated
  // line-crossing time but carries the frame-after-crossing position, so its implied speed
  // (a full frame's travel over a partial interval) is meaningless and can exceed 420 km/h
  // on a legitimate fast lap. Mid-lap teleports are still caught by every earlier pair.
  // Exceptions, each event explaining at most one pair: a wall-return event (the teleport
  // happened between those two samples, moved the car only a short way from a wall to the
  // centreline at the same spot, and resumed at a low speed) and a flashback event (the
  // teleport happened between those two samples, from the pre-flashback position to the
  // replay frame's position, at any distance backwards, resuming at a recorded speed).
  const usedWallEvents = new Set<number>();
  const usedFlashbackEvents = new Set<number>();
  for (let i = 1; i < count; i++) {
    if (i === count - 1) continue;
    const a = (i - 1) * SAMPLE_STRIDE;
    const b = i * SAMPLE_STRIDE;
    const dt = samples[b] - samples[a];
    if (dt < MIN_PAIR_DT_S) continue;
    const distance = Math.hypot(
      samples[b + 2] - samples[a + 2],
      samples[b + 3] - samples[a + 3],
      samples[b + 4] - samples[a + 4],
    );
    if ((distance / dt) * 3.6 <= MAX_SPEED_KMH) continue;
    let explained = false;
    if (distance <= 30) {
      for (let e = 0; e < wallReturns.length; e++) {
        if (usedWallEvents.has(e)) continue;
        const ev = wallReturns[e];
        if (ev.t < samples[a] - 0.01 || ev.t > samples[b] + 0.01) continue;
        if (Math.abs(samples[a + 1] - ev.sBefore) > 25) continue;
        if (Math.abs(samples[b + 1] - ev.sAfter) > 25) continue;
        if (samples[b + 9] > 100) continue;
        usedWallEvents.add(e);
        explained = true;
        break;
      }
    }
    if (!explained) {
      for (let e = 0; e < flashbacks.length; e++) {
        if (usedFlashbackEvents.has(e)) continue;
        const ev = flashbacks[e];
        if (ev.t < samples[a] - 0.01 || ev.t > samples[b] + 0.01) continue;
        // Sample phase: the teleport happens between two 20 Hz samples, so the
        // neighbouring samples sit a few metres from the teleport points; 50 m
        // covers that plus rounding, but not an unrelated jump elsewhere on track.
        if (Math.abs(samples[a + 1] - ev.sBefore) > 50) continue;
        if (Math.abs(samples[b + 1] - ev.sAfter) > 50) continue;
        if (samples[b + 9] > MAX_SPEED_KMH) continue;
        usedFlashbackEvents.add(e);
        explained = true;
        break;
      }
    }
    if (!explained) return bad("Positions imply a speed above 420 km/h");
  }

  const rec: LapRecording = {
    version: 1,
    trackId,
    vehicle,
    driverName,
    driverCode,
    lapTimeMs,
    sectorTimesMs: [s0, s1, s2],
    recordedAt,
    sampleHz,
    data: samples,
    ...(wallReturns.length > 0 ? { wallReturns } : {}),
    ...(flashbacks.length > 0 ? { flashbacks } : {}),
    ...(trackLimitsPenaltyMs > 0 ? { trackLimitsPenaltyMs } : {}),
    ...(autopilotPenaltyMs > 0 ? { autopilotPenaltyMs } : {}),
  };
  return { ok: true, rec };
}

/** Counts this IP's POSTs in the current hour; false when the hourly limit is reached */
async function consumePostQuota(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `rl:${ip}:${hour}`;
  const used = Number(await env.LAPS.get(key)) || 0;
  if (used >= MAX_POSTS_PER_HOUR) return false;
  await env.LAPS.put(key, String(used + 1), { expirationTtl: 3600 });
  return true;
}

/** Reads the body, or null when it is larger than 2 MB */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) return null;
  return new TextDecoder().decode(buffer);
}

async function readBoard(env: Env, key: string): Promise<BoardEntry[]> {
  const raw = await env.LAPS.get(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BoardEntry[]) : [];
  } catch {
    return [];
  }
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  if (!(await consumePostQuota(env, request))) {
    return fail(env, "Too many uploads, try again later", 429);
  }
  const text = await readBody(request);
  if (text === null) return fail(env, "Body is larger than 2 MB");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(env, "Body is not valid JSON");
  }
  const parsed = parseRecording(raw);
  if (!parsed.ok) return fail(env, parsed.error);
  const rec = parsed.rec;

  const boardKey = `board:${rec.trackId}|${rec.vehicle}`;
  const board = await readBoard(env, boardKey);
  // One row per driver: a slower lap from the same name and code does not replace their best
  const previous = board.find((e) => e.code === rec.driverCode && e.name === rec.driverName);
  if (previous && previous.lapTimeMs <= rec.lapTimeMs) {
    return fail(env, "Not faster than your best lap on this board");
  }

  const id = crypto.randomUUID();
  const entry: BoardEntry = {
    id,
    name: rec.driverName,
    code: rec.driverCode,
    lapTimeMs: rec.lapTimeMs,
    sectorTimesMs: rec.sectorTimesMs,
    vehicle: rec.vehicle,
    trackId: rec.trackId,
    recordedAt: rec.recordedAt,
  };
  const next = board.filter((e) => e !== previous);
  const insertAt = next.findIndex((e) => e.lapTimeMs > entry.lapTimeMs);
  if (insertAt === -1) next.push(entry);
  else next.splice(insertAt, 0, entry);

  const kept = next.slice(0, MAX_BOARD_ENTRIES);
  const rank = kept.indexOf(entry) + 1;
  if (rank === 0) return fail(env, "Lap is not fast enough for the top 100");
  const dropped = next.slice(MAX_BOARD_ENTRIES);

  // Store the lap before the board that points at it; then remove laps no longer on the board
  await env.LAPS.put(`lap:${id}`, JSON.stringify(rec));
  await env.LAPS.put(boardKey, JSON.stringify(kept));
  const stale = previous ? [previous, ...dropped] : dropped;
  for (const old of stale) {
    await env.LAPS.delete(`lap:${old.id}`);
  }
  return jsonResponse(env, { ok: true, rank });
}

async function handleList(url: URL, env: Env): Promise<Response> {
  const track = url.searchParams.get("track") ?? "";
  const vehicle = url.searchParams.get("vehicle") ?? "";
  if (!TRACK_PATTERN.test(track) || !VEHICLES.includes(vehicle)) {
    return fail(env, "track and vehicle are required");
  }
  const board = await readBoard(env, `board:${track}|${vehicle}`);
  return jsonResponse(env, { laps: board.slice(0, clampLimit(url.searchParams.get("limit"))) });
}

/** Deletes one online row and its stored lap; the local best is untouched and can be re-uploaded */
async function handleDeleteLap(id: string, env: Env): Promise<Response> {
  if (!UUID_PATTERN.test(id)) return fail(env, "Not found", 404);
  const raw = await env.LAPS.get(`lap:${id}`);
  if (raw === null) return fail(env, "Not found", 404);
  let trackId = "";
  let vehicle = "";
  try {
    const parsed = JSON.parse(raw) as { trackId?: unknown; vehicle?: unknown };
    if (typeof parsed.trackId === "string") trackId = parsed.trackId;
    if (typeof parsed.vehicle === "string") vehicle = parsed.vehicle;
  } catch {
    return fail(env, "Not found", 404);
  }
  if (!trackId || !vehicle) return fail(env, "Not found", 404);
  const boardKey = `board:${trackId}|${vehicle}`;
  const board = await readBoard(env, boardKey);
  await env.LAPS.put(boardKey, JSON.stringify(board.filter((e) => e.id !== id)));
  await env.LAPS.delete(`lap:${id}`);
  return jsonResponse(env, { ok: true });
}

async function handleGetLap(id: string, env: Env): Promise<Response> {
  if (!UUID_PATTERN.test(id)) return fail(env, "Not found", 404);
  const raw = await env.LAPS.get(`lap:${id}`);
  if (raw === null) return fail(env, "Not found", 404);
  return new Response(raw, { headers: { ...corsHeaders(env), "Content-Type": "application/json" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // ALLOWED_ORIGIN is a comma-separated list. Echo back the request origin
    // only when it is on the list, so both the Pages domain and the custom
    // domain can read and submit the board; other origins get the first entry.
    // (Origin is a browser CORS gate only: the handlers never use it for auth.)
    const requestOrigin = request.headers.get("Origin");
    const allowedList = (env.ALLOWED_ORIGIN || "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedOrigin =
      requestOrigin && (allowedList.includes("*") || allowedList.includes(requestOrigin))
        ? requestOrigin
        : allowedList[0] || "*";
    const withCors = (res: Response): Response => {
      res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
      return res;
    };
    try {
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204, headers: corsHeaders(env) }));
      }
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "");
      if (path === "/laps") {
        if (request.method === "POST") return withCors(await handlePost(request, env));
        if (request.method === "GET") return withCors(await handleList(url, env));
        return withCors(fail(env, "Method not allowed", 405));
      }
      const match = /^\/laps\/([^/]+)$/.exec(path);
      if (match && request.method === "GET") return withCors(await handleGetLap(match[1], env));
      if (match && request.method === "DELETE") return withCors(await handleDeleteLap(match[1], env));
      return withCors(fail(env, "Not found", 404));
    } catch {
      return withCors(fail(env, "Internal error", 500));
    }
  },
};
