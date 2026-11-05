/**
 * Parsed track GLB scenes, kept across simulator remounts.
 *
 * Switching circuits remounts the whole simulator (`TrackGate` keys it by
 * track id), so without this cache every switch re-downloaded (ETag
 * revalidation) and re-parsed an 11–24 MB GLB on the main thread — that
 * parse is the freeze players felt, not the menu itself. A scene parsed once
 * in the background preloader is handed to the scene builder instead, which
 * re-runs its (idempotent) node walk — shadows, polygon offsets, asphalt
 * sheen — and re-parents the scene into the new scene group; the old group
 * is discarded anyway, so re-parenting is safe. Scenes are never disposed
 * by the simulator's unmount path, so a cached scene stays usable for a
 * switch back. The `?colliders=1` debug view is excluded: it replaces track
 * materials with debug materials in place, which would pollute the cache.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { withBasePath } from "@/lib/base-path";

const scenes = new Map<string, THREE.Group>();
/** Raw track_data.json bodies fetched by the preloader, keyed by track id */
const trackData = new Map<string, unknown>();

export function setPreloadedTrackData(id: string, raw: unknown): void {
  trackData.set(id, raw);
}

export function getPreloadedTrackData(id: string): unknown | null {
  return trackData.get(id) ?? null;
}

function cacheKey(url: string): string {
  return withBasePath(url);
}

/** A parsed scene for this track GLB, if the preloader already built one */
export function getPreloadedTrackScene(url: string): THREE.Group | null {
  return scenes.get(cacheKey(url)) ?? null;
}

/** True when a parsed scene for this track GLB is already cached */
export function hasPreloadedTrackScene(url: string): boolean {
  return scenes.has(cacheKey(url));
}

/**
 * Parse a track GLB into the cache (no scene attachment, no node walk —
 * the scene builder does that when the track is actually chosen). Resolves
 * to false when the file cannot be loaded; a failed preload never blocks a
 * later switch, which simply loads the GLB the old way.
 */
export async function preloadTrackGlb(url: string): Promise<boolean> {
  const key = cacheKey(url);
  if (scenes.has(key)) return true;
  if (typeof window === "undefined") return false;
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(key);
    scenes.set(key, gltf.scene as THREE.Group);
    return true;
  } catch (err) {
    console.warn(`[preload] track GLB failed: ${url}`, err);
    return false;
  }
}
