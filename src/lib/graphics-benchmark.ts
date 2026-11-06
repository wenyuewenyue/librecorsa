import type { GraphicsQuality, GraphicsSettings } from "@/lib/settings/player-settings";
import { isTouchDevice } from "@/lib/input/touch-input";

/**
 * Automatic graphics-quality test.
 *
 * The test does NOT create a second renderer and does NOT invent a synthetic
 * scene: it measures the real frames of the running simulator while an AI
 * race with autopilot is driving (see LibreCorsaSimulator). The sampling
 * loop here only reads frame timestamps; the simulator does the rendering.
 *
 * Mapping (fixed by the task, not tuned here):
 *   avg >= 55 and p1 >= 30            -> High, renderScale 1
 *   avg 30-55 (and no heavy stutter)  -> Medium, renderScale 0.8-1
 *   avg < 30 or heavy stutter         -> Low, renderScale 0.6-0.75
 * Heavy stutter = more than 25% of sampled frames slower than 50 ms.
 */

export interface GraphicsTestResult {
  avgFps: number;
  p1Fps: number;
  stutterRatio: number;
  quality: GraphicsQuality;
  renderScale: number;
  deviceIsMobile: boolean;
  source: "auto" | "manual";
  testedAt: number;
}

export const BENCHMARK_WARMUP_MS = 3000;
export const BENCHMARK_MEASURE_MS = 12000;
export const BENCHMARK_CONFIRM_MS = 5000;

export const GRAPHICS_QUALITY_LABEL: Record<GraphicsQuality, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

export function isMobileBenchmarkDevice(): boolean {
  if (typeof window === "undefined") return false;
  if (isTouchDevice()) return true;
  if (typeof window.innerWidth === "number" && window.innerWidth < 768) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator?.userAgent ?? "");
}

export function startQualityForDevice(deviceIsMobile: boolean): GraphicsQuality {
  return deviceIsMobile ? "medium" : "high";
}

export function summarizeSamples(frameMs: number[]): { avgFps: number; p1Fps: number; stutterRatio: number } {
  const usable = frameMs.filter((ms) => Number.isFinite(ms) && ms > 0 && ms <= 250);
  if (usable.length === 0) return { avgFps: 0, p1Fps: 0, stutterRatio: 1 };
  const meanMs = usable.reduce((a, b) => a + b, 0) / usable.length;
  const sorted = [...usable].sort((a, b) => a - b);
  const p99Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
  const p99Ms = sorted[p99Index] ?? sorted[sorted.length - 1];
  const stutter = usable.filter((ms) => ms > 50).length / usable.length;
  return {
    avgFps: Math.round((1000 / meanMs) * 10) / 10,
    p1Fps: Math.round((1000 / p99Ms) * 10) / 10,
    stutterRatio: Math.round(stutter * 1000) / 1000,
  };
}

export function mapBenchmarkToGraphics(
  avgFps: number,
  p1Fps: number,
  stutterRatio: number,
): GraphicsSettings {
  if (avgFps >= 55 && p1Fps >= 30 && stutterRatio <= 0.25) {
    return { quality: "high", renderScale: 1 };
  }
  if (avgFps >= 30 && stutterRatio <= 0.25) {
    return { quality: "medium", renderScale: avgFps >= 45 ? 1 : 0.85 };
  }
  return { quality: "low", renderScale: avgFps >= 20 ? 0.75 : 0.6 };
}

export function buildTestResult(
  summary: { avgFps: number; p1Fps: number; stutterRatio: number },
  deviceIsMobile: boolean,
  source: "auto" | "manual",
): GraphicsTestResult {
  const graphics = mapBenchmarkToGraphics(summary.avgFps, summary.p1Fps, summary.stutterRatio);
  return {
    avgFps: summary.avgFps,
    p1Fps: summary.p1Fps,
    stutterRatio: summary.stutterRatio,
    quality: graphics.quality,
    renderScale: graphics.renderScale,
    deviceIsMobile,
    source,
    testedAt: Date.now(),
  };
}

export function checkWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("webgl2");
    return ctx !== null;
  } catch {
    return false;
  }
}

/** One step down in quality, or null when already at Low. Used for the brief confirmation run. */
export function stepDownQuality(quality: GraphicsQuality): GraphicsQuality | null {
  if (quality === "high") return "medium";
  if (quality === "medium") return "low";
  return null;
}
