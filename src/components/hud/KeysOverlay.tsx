"use client";

import React from "react";

/**
 * Driving keys overlay: shown directly on the driving screen, no tap-to-open
 * step, filtered to the input method actually in use (keyboard / controller /
 * wheel / touch) so it never shows every method at once. It sits on the right
 * edge, vertically centred, clear of the central road view, and never
 * intercepts driving input: the panel itself is pointer-events-none, only
 * its close button (and the restore entry shown after hiding) take input.
 * Taps on steering, pedals or any other control therefore still reach those
 * controls. Visibility is per-drive only (default shown); hiding it never
 * touches settings storage.
 *
 * Deliberately panel-free: no background, border or blur behind the text, so
 * the road stays visible between the rows. Readability comes from a text
 * shadow alone. The column is narrow (at most 210px) and capped at 60vh, so
 * it stays in the free right-edge band between the track map (top-right)
 * and the speed/MFD area (bottom-right), and never reaches the timing tower
 * (top-left) — however long the tower grows in a full AI field — the tyre
 * matrix (bottom-left) or the bottom-centre touch zone. When the MFD is
 * expanded, that band is no longer free (the MFD grows up into it), so the
 * HUD suppresses this overlay entirely — not even the "按键" restore button,
 * which would sit on the MFD panel itself — and it returns automatically
 * when the MFD folds again, without touching the player's own hide choice.
 */
export type DrivingControlsMode = "keyboard" | "controller" | "wheel" | "touch";

const MODE_TITLE: Record<DrivingControlsMode, string> = {
  keyboard: "按键 · 键盘",
  controller: "按键 · 手柄",
  wheel: "按键 · 方向盘",
  touch: "操作 · 触屏",
};

export const KeysOverlay: React.FC<{
  rows: readonly (readonly [string, string])[];
  mode?: DrivingControlsMode;
  visible: boolean;
  onHide: () => void;
  onShow: () => void;
  /** Label of the reopen shortcut (keyboard only, e.g. "H"); shown on the
   * restore button in the same "key + action" form as "Esc 关闭" */
  reopenLabel?: string;
  /** MFD expanded: render nothing at all (see header comment) */
  suppressed?: boolean;
}> = ({ rows, mode = "keyboard", visible, onHide, onShow, reopenLabel, suppressed = false }) => {
  if (suppressed) return null;
  if (!visible) {
    const showLabel = mode === "keyboard" && reopenLabel ? `${reopenLabel} 显示` : "按键";
    return (
      <button
        type="button"
        onClick={onShow}
        aria-label="显示操作说明"
        className="pointer-events-auto absolute right-2 top-1/2 inline-flex h-8 -translate-y-1/2 cursor-pointer items-center px-1 text-[12px] font-bold text-[#F5F7FA] [text-shadow:0_1px_3px_rgba(0,0,0,0.9),0_0_6px_rgba(0,0,0,0.6)] sm:right-3"
      >
        {showLabel}
      </button>
    );
  }
  // Only keyboard players have an Esc key: tell them so, plainly. Touch,
  // controller and wheel players get a plain "关闭" label instead, so the
  // button never promises a key they do not have. Esc still closes the
  // overlay first (handled in F1TelemetryHud) for keyboard players.
  const closeLabel = mode === "keyboard" ? "Esc 关闭" : "关闭";
  return (
    <div
      aria-label="操作说明"
      className="pointer-events-none absolute right-2 top-1/2 max-h-[60vh] w-[200px] max-w-[210px] -translate-y-1/2 px-1 py-1 [text-shadow:0_1px_3px_rgba(0,0,0,0.9),0_0_6px_rgba(0,0,0,0.6)] sm:right-3"
    >
      <div className="mb-1 flex items-center justify-between gap-2 short:mb-0.5">
        <span className="font-f1-mono text-[11px] font-extrabold tracking-[0.16em] text-[#8E96AA] uppercase short:text-[10px]">
          {MODE_TITLE[mode]}
        </span>
        <button
          type="button"
          onClick={onHide}
          aria-label={closeLabel}
          className="pointer-events-auto inline-flex h-8 min-w-[72px] cursor-pointer items-center justify-center rounded-full border border-white/25 bg-white/10 px-3 text-[12px] font-bold text-[#F5F7FA] hover:bg-white/20 short:h-7 short:text-[11px]"
        >
          {closeLabel}
        </button>
      </div>
      <div className="flex flex-col gap-[3px] short:gap-[2px]">
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <span className="shrink-0 text-[12px] leading-[1.3] text-[#C5CBD8] short:text-[11px] short:leading-[1.2]">
              {label}
            </span>
            <span className="text-right font-f1-mono text-[12px] leading-[1.3] font-bold text-[#F5F7FA] short:text-[11px] short:leading-[1.2]">
              {keys}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
