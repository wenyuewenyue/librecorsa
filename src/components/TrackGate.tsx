"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { LibreCorsaSimulator } from "@/components/LibreCorsaSimulator";
import { activateTrack, getTrackInfo, loadStoredTrackId, RWANDA_TRACK_ID } from "@/lib/track-registry";
import { getActiveTrackMetadata } from "@/lib/track-data";
import { hasPreloadedTrackScene, preloadTrackGlb } from "@/lib/loading/track-glb-cache";

/**
 * Activates the chosen circuit before the simulator mounts, and remounts it (fresh scene, physics and
 * menus) when the player picks another one from the title menu.
 *
 * Switching used to look like a freeze: the click remounted the simulator at
 * once, and the new track's 11–24 MB GLB was then downloaded and parsed on
 * the main thread inside the new mount, with nothing on screen explaining
 * the wait — the old menu vanished, the frame stuck, then the new title
 * menu appeared all at once. For a later switch, this gate now does the
 * heavy part before the remount: it shows a switching overlay over the
 * still-mounted old scene, activates the track data, and parses the track
 * GLB into the scene cache (a no-op when the background preloader already
 * warmed it, which is the instant-switch case). Only then does it remount,
 * so the new mount reuses the parsed scene and its own loading screen
 * takes over on a dark-to-dark transition instead of a frozen frame.
 * The very first load is deliberately different: no switching overlay
 * at all, so the player goes straight to the simulator's own loading
 * screen (the press-any-key screen) and the track GLB loads under that
 * screen's progress, instead of a switching overlay in front of it.
 */
export const TrackGate: React.FC = () => {
  const [trackId, setTrackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<{ name: string; step: string } | null>(null);
  const trackIdRef = useRef<string | null>(null);
  const switchingRef = useRef(false);
  const switchingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lift the switching overlay once the new mount reports its assets
  // ready. Clearing it in select()'s finally used to drop the cover at
  // the exact instant the heavy remount started, leaving a frozen new
  // mount with nothing on screen explaining the wait.
  const handleSimulatorReady = useCallback(() => {
    if (switchingTimeoutRef.current) {
      clearTimeout(switchingTimeoutRef.current);
      switchingTimeoutRef.current = null;
    }
    switchingRef.current = false;
    setSwitching(null);
  }, []);

  // Let the browser actually paint the switching overlay before any
  // heavy work starts. Without this yield, a fast fetch / a cached GLB
  // can go straight into main-thread parsing in the same task, so React
  // never gets a paint and the player only sees the old screen frozen
  // in place — which is exactly the reported symptom for non-default
  // circuits, while the bundled default circuit's quick remount still
  // showed its loading transition.
  const paintYield = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 50));
    });

  const select = useCallback(async (id: string) => {
    if (id === trackIdRef.current || switchingRef.current) return;
    switchingRef.current = true;
    const isInitial = trackIdRef.current === null;
    const name = getTrackInfo(id).name;
    try {
      // First load: no switching overlay and no pre-parse. The simulator
      // mounts straight away and its own loading screen (press any key)
      // covers the track GLB load with its progress lights. A later
      // switch keeps the overlay below, exactly as before.
      if (!isInitial) {
        setSwitching({ name, step: "正在准备赛道数据…" });
        await paintYield();
      }
      const info = await activateTrack(id);
      // Parse the model before remounting, unless the preloader already did.
      // This is the step that used to freeze the switch; doing it here,
      // under the overlay, is what makes the remount itself short.
      // Skipped on first load, for the reason above.
      if (!isInitial) {
        const meshUrl = getActiveTrackMetadata().mesh?.url;
        if (meshUrl && !hasPreloadedTrackScene(meshUrl)) {
          setSwitching({ name, step: "正在准备赛道模型…" });
          await paintYield();
          await preloadTrackGlb(meshUrl);
        }
      }
      setError(null);
      trackIdRef.current = info.id;
      setTrackId(info.id);
    } catch (err) {
      console.warn("Track switch failed, staying on Rwanda:", err);
      setError(`无法加载该赛道（${String(err)}）`);
      try {
        await activateTrack(RWANDA_TRACK_ID);
      } catch {
        // Keep the current track if even the fallback fails
      }
      trackIdRef.current = RWANDA_TRACK_ID;
      setTrackId(RWANDA_TRACK_ID);
    } finally {
      if (isInitial) {
        // First load already has its own loading screen; do not cover it.
        switchingRef.current = false;
        setSwitching(null);
      } else {
        // Keep the overlay over the remount until the new simulator
        // reports assets ready; the timeout only guards against a
        // mount that never reports, so the overlay can never stick.
        if (switchingTimeoutRef.current) clearTimeout(switchingTimeoutRef.current);
        switchingTimeoutRef.current = setTimeout(() => {
          switchingRef.current = false;
          setSwitching(null);
        }, 30000);
      }
    }
  }, []);

  useEffect(() => {
    void select(loadStoredTrackId());
  }, [select]);

  if (!trackId && !switching) return null;
  return (
    <>
      {trackId ? (
        <LibreCorsaSimulator
          key={trackId}
          trackId={trackId}
          onSelectTrack={(id) => void select(id)}
          onAssetsReady={handleSimulatorReady}
        />
      ) : null}
      {switching ? (
        <div
          role="status"
          className="lc-panel-in pointer-events-auto fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#08090D]/85 px-6 text-center backdrop-blur-md"
        >
          <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-[#CCFF00] shadow-[0_0_18px_#CCFF00]" />
          <span className="lc-title text-[22px] text-[#F5F7FA]">正在切换到 {switching.name}</span>
          <span className="lc-lbl text-[#8E96AA]">{switching.step}</span>
          <span className="max-w-[420px] text-[13px] leading-relaxed text-[#5B6275]">
            模型已预载时切换即时完成；首次切换需下载并解析模型，请稍候。
          </span>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="pointer-events-none fixed bottom-4 left-1/2 z-50 inline-flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-[#FF2A3C]/45 bg-[#08090D]/85 px-4 py-2 font-f1-mono text-[12px] font-bold text-[#F5F7FA] shadow-[0_14px_40px_rgba(0,0,0,0.5)] backdrop-blur-md"
        >
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[#FF2A3C]" />
          {error}
        </div>
      ) : null}
    </>
  );
};
