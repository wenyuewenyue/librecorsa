/**
 * Activation-code buff pack: one code, one run, multipliers only.
 *
 * The pack is held in simulator state, never written to settings storage, and
 * cleared when the player returns to the title menu. Physics classes apply
 * these multipliers at the points where the corresponding force is computed;
 * with every multiplier at 1 the car is unchanged.
 */

/** Activation code, matched after trimming the input */
export const BUFF_CODE = "温越最帅";

export interface BuffPack {
  /** Tyre grip multiplier */
  grip: number;
  /** Brake torque multiplier */
  brake: number;
  /** Downforce multiplier */
  downforce: number;
  /** Engine / drive multiplier below `lowSpeedMs` */
  lowSpeedAccel: number;
  /** Boost cooldown recovery multiplier (cooldown drains this much faster) */
  boostRecharge: number;
  /** Low-speed acceleration applies below this speed (m/s, 50 m/s = 180 km/h) */
  lowSpeedMs: number;
}

/** No buff: every multiplier is 1, so the car is exactly its baseline */
export const NO_BUFF: BuffPack = {
  grip: 1,
  brake: 1,
  downforce: 1,
  lowSpeedAccel: 1,
  boostRecharge: 1,
  lowSpeedMs: 50,
};

/** The mild pack agreed for the activation code: top speed is untouched */
export const BUFF_PACK: BuffPack = {
  grip: 1.12,
  brake: 1.15,
  downforce: 1.08,
  lowSpeedAccel: 1.08,
  boostRecharge: 1.3,
  lowSpeedMs: 50,
};

export function isBuffCode(input: string): boolean {
  return input.trim() === BUFF_CODE;
}

/** One wall-return teleport inside a lap, recorded so the leaderboard can tell it apart from a cheat teleport */
export interface WallReturnEvent {
  /** Lap time (s) at the teleport */
  t: number;
  /** Track distance (m) before the teleport */
  sBefore: number;
  /** Track distance (m) after the teleport (same spot, centreline) */
  sAfter: number;
  /** Speed (km/h) the car resumes at */
  speedKmh: number;
}

/** One instant-replay flashback teleport inside a lap, recorded so the leaderboard can tell it apart from a cheat teleport. Same shape as a wall return, but the jump may be far backwards (up to the 90 s replay window), so the leaderboard must not apply the wall-return 50 m displacement cap to it. */
export interface FlashbackEvent {
  /** Lap time (s) at the teleport (the lap clock keeps running through a flashback) */
  t: number;
  /** Track distance (m) before the teleport */
  sBefore: number;
  /** Track distance (m) after the teleport (the replay frame's position) */
  sAfter: number;
  /** Speed (km/h) the car resumes at (the replay frame's speed) */
  speedKmh: number;
}

/** Flashback limits the leaderboard enforces for a marked teleport */
export const FLASHBACK_LIMITS = {
  /** At most this many flashbacks in one lap; further flashbacks still add penalty but are not recorded as events, so a lap with more than this many cannot be uploaded (its extra jumps would be unexplained) */
  maxPerLap: 10,
  /** The resume speed may not exceed this (km/h): a flashback resumes at a recorded driving speed, never above the 420 km/h plausibility cap */
  maxSpeedKmh: 420,
} as const;

/** Flashback is free: 0 s penalty per flashback. A flashback lap counts at its raw driven time; the flashback events are recorded only so the leaderboard can tell a marked flashback jump apart from a cheat teleport. */
export const FLASHBACK_PENALTY_MS = 0;
/** Autopilot penalty for a whole lap containing any autopilot frame (ms): +30 s once per lap, never per second */
export const AUTOPILOT_PENALTY_MS = 30000;

/** Wall-return limits the leaderboard enforces for a marked teleport */
export const WALL_RETURN_LIMITS = {
  /** At most this many wall returns in one lap */
  maxPerLap: 5,
  /** The teleport may not move the car this far along the lap (m, wrapped) */
  maxJumpM: 50,
  /** The resume speed may not exceed this (km/h) */
  maxSpeedKmh: 60,
} as const;
