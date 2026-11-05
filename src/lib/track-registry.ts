/**
 * Circuits the simulator offers. Rwanda ships inside the bundle (track-data.ts imports its JSON); the others are
 * converted from Sketchfab scans by scripts/tracks/build_track.py, which writes public/tracks/<id>/ and keeps
 * public/tracks/index.json (this list) up to date. Their track data is fetched when the player picks one.
 */
import trackIndex from "../../public/tracks/index.json";
import { withBasePath } from "@/lib/base-path";
import { getPreloadedTrackData } from "@/lib/loading/track-glb-cache";
import { RWANDA_TARGET_LENGTH_M, RWANDA_TURN_METADATA, setActiveTrack, type RawTrackJson } from "@/lib/track-data";

export interface TrackCredit {
  title: string;
  author: string;
  url: string;
  short?: string;
  license: string;
  licenseUrl: string;
}

export interface TrackInfo {
  id: string;
  name: string;
  layout: string;
  country: string;
  city: string;
  lengthM: number;
  turns: number;
  direction: string;
  /** Track data JSON (relative to the base path); none for the bundled Rwanda layout */
  dataUrl?: string;
  /** Model attribution (CC BY 4.0 scans) */
  credit?: TrackCredit;
}

export const RWANDA_TRACK_ID = "rwanda";

/**
 * Display-name overrides for circuits whose names come from public/tracks/index.json.
 * The public file itself is not edited; only the displayed name/layout are replaced here.
 * country/city/direction are intentionally left untouched: country feeds the timing-tower
 * track code (country.slice(0, 3)) and direction is parsed with a /clock/i regex elsewhere.
 */
const TRACK_DISPLAY_ZH: Record<string, { name: string; layout: string }> = {
  suzuka: { name: "铃鹿赛道", layout: "2001 布局" },
  shanghai: { name: "上海国际赛车场", layout: "2018 布局" },
  motegi: { name: "茂木赛道", layout: "公路赛道" },
};

export const TRACKS: TrackInfo[] = [
  {
    id: RWANDA_TRACK_ID,
    name: "卢旺达国际赛道",
    layout: "2026 概念布局",
    country: "Rwanda",
    city: "Bugesera",
    lengthM: RWANDA_TARGET_LENGTH_M,
    turns: RWANDA_TURN_METADATA.length,
    direction: "clockwise",
  },
  ...(trackIndex as TrackInfo[]).map((t) => ({ ...t, ...(TRACK_DISPLAY_ZH[t.id] ?? {}) })),
];

const TRACK_STORAGE_KEY = "bugesera.track";

export function getTrackInfo(id: string): TrackInfo {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

/** The circuit picked last time (or Rwanda) */
export function loadStoredTrackId(): string {
  try {
    const id = localStorage.getItem(TRACK_STORAGE_KEY);
    if (id && TRACKS.some((t) => t.id === id)) return id;
  } catch {
    // Storage unavailable
  }
  return RWANDA_TRACK_ID;
}

function storeTrackId(id: string): void {
  try {
    localStorage.setItem(TRACK_STORAGE_KEY, id);
  } catch {
    // Storage unavailable: the choice lasts for this session only
  }
}

/** Fetches (when needed) and activates a circuit; resolves once `setActiveTrack` has run */
export async function activateTrack(id: string): Promise<TrackInfo> {
  const info = getTrackInfo(id);
  if (!info.dataUrl) {
    setActiveTrack(RWANDA_TRACK_ID);
  } else {
    const preloaded = getPreloadedTrackData(info.id) as RawTrackJson | null;
    if (preloaded) {
      setActiveTrack(info.id, preloaded);
    } else {
      const res = await fetch(withBasePath(info.dataUrl));
      if (!res.ok) throw new Error(`Track data ${info.dataUrl}: HTTP ${res.status}`);
      setActiveTrack(info.id, (await res.json()) as RawTrackJson);
    }
  }
  storeTrackId(info.id);
  return info;
}
