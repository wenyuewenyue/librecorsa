/**
 * Background resource preloader: downloads + parses the circuits and cars
 * the player has not picked yet, while they are still in the title menu,
 * so switching to one later does not freeze on a first-time 11–24 MB GLB
 * download and parse.
 *
 * Why the split matters: a plain download cache alone would not fix the
 * freeze. Pages serves GLBs with `max-age=0, must-revalidate`, so a
 * re-visited track is only a fast ETag 304 — but the meshopt decode and
 * scene parse still run on the main thread at switch time. This preloader
 * therefore parses track GLBs in the menu too (into track-glb-cache, which
 * the scene builder reuses), not just their bytes.
 *
 * Rules, in the order they protect the game:
 * - Only starts in the menu (the caller passes `isDriving`, checked before
 *   every item). A fetch in flight is aborted when driving starts; a GLB
 *   parse already in flight cannot be aborted by the loader, so it is
 *   allowed to finish — it is bounded and the alternative (killing the
 *   parse) would leave a half-parsed scene.
 * - One item at a time, with an idle gap between items, so the orbiting
 *   menu camera stays smooth. Nothing is parsed while driving.
 * - Skipped entirely on metered / save-data connections and on slow
 *   networks, and paused while the tab is hidden. Switching then falls
 *   back to the old on-demand load — slower, but never broken.
 * - Cars need no scene cache: their template promises are already cached
 *   in their model modules, so warming them here makes the first car
 *   switch cheap too.
 *
 * Total extra download when everything is warmed: the three non-current
 * tracks (~48 MB) plus the non-current car (~14–20 MB). It is sequential,
 * low-priority fetch, and it never runs while a race is in progress.
 */
import { useSyncExternalStore } from "react";
import { TRACKS, type TrackInfo } from "@/lib/track-registry";
import { withBasePath } from "@/lib/base-path";
import {
  preloadTrackGlb,
  setPreloadedTrackData,
} from "@/lib/loading/track-glb-cache";
import { loadVf26Template } from "@/lib/vf26-car-model";
import { loadGt3Cockpit, loadGt3Template } from "@/lib/gt3-car-model";

/** Approximate GLB sizes (MB) for ordering: smallest first, quick wins first */
const TRACK_GLB_MB: Record<string, number> = { motegi: 11, suzuka: 13, rwanda: 20, shanghai: 24 };

export type PreloadState = "idle" | "loading" | "paused" | "done" | "skipped";

export interface PreloadSnapshot {
  state: PreloadState;
  /** Finished items (tracks + cars) */
  done: number;
  total: number;
  /** Track currently being warmed, if any */
  current: string | null;
  /** Track ids whose GLB scene is parsed and ready for an instant switch */
  readyTracks: readonly string[];
  skippedReason: string | null;
}

let snapshot: PreloadSnapshot = {
  state: "idle",
  done: 0,
  total: 0,
  current: null,
  readyTracks: [],
  skippedReason: null,
};
const listeners = new Set<() => void>();
const readyTracks = new Set<string>();
let runningFor: string | null = null;
let abort: AbortController | null = null;

function update(patch: Partial<PreloadSnapshot>) {
  snapshot = { ...snapshot, ...patch, readyTracks: [...readyTracks] };
  for (const l of listeners) l();
}

export function getPreloadSnapshot(): PreloadSnapshot {
  return snapshot;
}

export function subscribePreload(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreloadStatus(): PreloadSnapshot {
  return useSyncExternalStore(subscribePreload, getPreloadSnapshot, getPreloadSnapshot);
}

function idleWait(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(
        () => resolve(),
        { timeout: 2000 }
      );
    } else {
      setTimeout(resolve, 400);
    }
  });
}

function networkAllows(): string | null {
  if (typeof navigator === "undefined") return null;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData) return "已开启流量节省，不预载";
  if (conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") return "当前网络较慢，不预载";
  return null;
}

/**
 * Warm every circuit and car except the current ones. Safe to call on
 * every return to the title menu: a run already in flight or finished for
 * this track is a no-op, and a paused run resumes where it stopped.
 */
export async function startResourcePreload(currentTrackId: string, isDriving: () => boolean): Promise<void> {
  if (typeof window === "undefined") return;
  if (runningFor === currentTrackId) return;
  if (snapshot.state === "done" && runningFor === null && readyTracks.size > 0) {
    // A previous run for another track finished; a new current track only
    // needs the tracks that are not ready yet, which the loop below skips.
  }
  const blocked = networkAllows();
  if (blocked) {
    update({ state: "skipped", skippedReason: blocked, current: null });
    return;
  }
  runningFor = currentTrackId;
  abort = new AbortController();

  const others: TrackInfo[] = TRACKS.filter((t) => t.id !== currentTrackId).sort(
    (a, b) => (TRACK_GLB_MB[a.id] ?? 20) - (TRACK_GLB_MB[b.id] ?? 20)
  );
  // Ready is tracked by track id in this module's own set. Do NOT check
  // it via hasPreloadedTrackScene(track.id): that cache is keyed by GLB
  // URL, not by track id, so such a check is always false and no track
  // would ever be marked ready (the bug that left every badge at 待预载).
  if (others.every((t) => readyTracks.has(t.id)) && snapshot.state === "done") {
    update({ state: "done", total: others.length + 2, done: others.length + 2, current: null });
    return;
  }
  const items = others.length + 2; // tracks + F1 template + GT3 template (+ cockpit inside GT3)
  let done = [...readyTracks].length;
  update({ state: "loading", total: items, done, current: null });

  try {
    for (const track of others) {
      if (isDriving() || document.hidden) {
        update({ state: "paused", current: null });
        return;
      }
      update({ current: track.name });
      if (readyTracks.has(track.id)) {
        // Already warmed on an earlier run for another current track.
      } else if (!track.dataUrl) {
        // Bundled track (e.g. Rwanda): no download or parse is needed.
        readyTracks.add(track.id);
      } else {
        try {
          const res = await fetch(withBasePath(track.dataUrl), { signal: abort.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = await res.json();
          setPreloadedTrackData(track.id, raw);
          const meshUrl = (raw as { metadata?: { mesh?: { url?: string } } }).metadata?.mesh?.url;
          // preloadTrackGlb returns true when the scene is parsed or was
          // already cached by URL: that return value, not a track-id
          // cache lookup, is what marks the track ready.
          if (meshUrl && (await preloadTrackGlb(meshUrl))) readyTracks.add(track.id);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            update({ state: "paused", current: null });
            return;
          }
          console.warn(`[preload] track skipped: ${track.id}`, err);
        }
      }
      done = readyTracks.size;
      update({ done, current: null });
      await idleWait();
      if (isDriving()) {
        update({ state: "paused", current: null });
        return;
      }
    }
    // Cars: warming the template promises makes the first car switch cheap.
    // These are already cached per module, so the current car costs nothing.
    update({ current: null });
    await loadVf26Template().catch((err) => console.warn("[preload] F1 template skipped", err));
    update({ done: readyTracks.size + 1 });
    if (isDriving()) {
      update({ state: "paused", current: null });
      return;
    }
    await loadGt3Template().catch((err) => console.warn("[preload] GT3 template skipped", err));
    await loadGt3Cockpit().catch((err) => console.warn("[preload] GT3 cockpit skipped", err));
    // Failed tracks simply stay unready; switching to one falls back to the
    // old on-demand load, so the run still counts as finished.
    update({ state: "done", done: readyTracks.size + 2, current: null });
  } finally {
    runningFor = null;
    abort = null;
  }
}

/** Abort a fetch in flight (e.g. the player started driving); the run resumes on the next title visit */
export function pauseResourcePreload(): void {
  abort?.abort();
}
