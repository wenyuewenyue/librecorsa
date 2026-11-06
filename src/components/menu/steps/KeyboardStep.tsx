"use client";

import React, { useEffect, useState } from "react";
import {
  clearKey,
  DEFAULT_KEY_BINDINGS,
  KEY_ACTIONS,
  KEY_SLOTS,
  keyLabel,
  rebindKey,
  RESERVED_CODES,
  type KeyAction,
} from "@/lib/input/bindings";
import { Toggle } from "@/components/hud/PauseMenu";
import { DEFAULT_KEYBOARD_TUNING, type KeyboardTuning } from "@/lib/settings/player-settings";
import { suspendMenuNav } from "../useMenuNav";
import { TuningSlider } from "./TuningSlider";
import { AutoGrid, BindRow, bindKeyClass, PillAction, SetupCard, StatusPill } from "./setup-ui";
import type { SetupStepProps } from "./types";

/** Keyboard rebinding: click a slot, press a key. Taking a key from another action swaps the two. */
export const KeyboardStep: React.FC<SetupStepProps> = ({ settings, onChangeSettings, mouseSteerEnabled, onSetMouseSteer }) => {
  const [capture, setCapture] = useState<{ action: KeyAction; slot: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!capture) return;
    const resume = suspendMenuNav();
    const onKey = (e: KeyboardEvent) => {
      // Capture phase + stopImmediatePropagation: the menu and the simulator never see this key
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") {
        setCapture(null);
        return;
      }
      if (RESERVED_CODES.has(e.code)) {
        setNotice(`${keyLabel(e.code)} 已被保留`);
        return;
      }
      const owner = KEY_ACTIONS.find((a) => settings.keys[a.id].includes(e.code) && a.id !== capture.action);
      onChangeSettings((s) => ({ ...s, keys: rebindKey(s.keys, capture.action, capture.slot, e.code) }));
      setNotice(owner ? `${keyLabel(e.code)} 已从 ${owner.label} 移出` : null);
      setCapture(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      // Let the key-up of the captured key pass before menus listen again
      window.setTimeout(resume, 0);
    };
  }, [capture, settings.keys, onChangeSettings]);

  const tuning = settings.keyboardTuning;
  const setTuning = (patch: Partial<KeyboardTuning>) =>
    onChangeSettings((prev) => ({ ...prev, keyboardTuning: { ...prev.keyboardTuning, ...patch } }));
  const ms = (v: number) => `${Math.round(v * 1000)} ms`;

  return (
    <div className="flex flex-col gap-4">
      <SetupCard
        label="按键绑定"
        action={<PillAction onClick={() => onChangeSettings((s) => ({ ...s, keys: DEFAULT_KEY_BINDINGS }))}>重置</PillAction>}
      >
        <AutoGrid min={330} className="gap-x-[18px] gap-y-0.5">
          {KEY_ACTIONS.map(({ id, label }) => {
            const codes = settings.keys[id];
            const slots = Math.max(KEY_SLOTS, codes.length);
            return (
              <BindRow key={id} label={label} listening={capture?.action === id}>
                <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {Array.from({ length: slots }, (_, slot) => {
                    const listening = capture?.action === id && capture.slot === slot;
                    const code = codes[slot];
                    return (
                      <span key={slot} className="group relative">
                        <button
                          type="button"
                          aria-label={code || listening ? undefined : `为 ${label} 添加按键`}
                          onClick={() => {
                            setNotice(null);
                            setCapture({ action: id, slot: Math.min(slot, codes.length) });
                          }}
                          className={bindKeyClass(listening ? "listening" : code ? "bound" : "empty")}
                        >
                          {listening ? "按下…" : code ? keyLabel(code) : "+"}
                        </button>
                        {code && !listening ? (
                          <button
                            type="button"
                            aria-label={`解除绑定 ${keyLabel(code)}`}
                            onClick={() => onChangeSettings((s) => ({ ...s, keys: clearKey(s.keys, id, slot) }))}
                            className="absolute -top-1.5 -right-1.5 hidden h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full border border-[#08090D] bg-[#3A4157] text-[11px] leading-none text-[#F5F7FA] group-hover:flex hover:bg-[#FF2A3C]"
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                </span>
              </BindRow>
            );
          })}
        </AutoGrid>
        <StatusPill tone={capture ? "live" : notice ? "info" : "idle"}>
          {capture ? "按一个按键 · Esc 取消" : (notice ?? "Esc 始终打开菜单。")}
        </StatusPill>
      </SetupCard>

      <SetupCard
        label="键盘手感"
        action={
          <PillAction onClick={() => onChangeSettings((s) => ({ ...s, keyboardTuning: DEFAULT_KEYBOARD_TUNING }))}>
            重置
          </PillAction>
        }
      >
        <AutoGrid min={220} className="gap-x-[22px] gap-y-3">
          <TuningSlider
            label="油门上升"
            value={tuning.throttleRiseS}
            min={0}
            max={1}
            step={0.01}
            format={ms}
            hint="油门按键达到全油门所需时间"
            onChange={(v) => setTuning({ throttleRiseS: v })}
          />
          <TuningSlider
            label="刹车上升"
            value={tuning.brakeRiseS}
            min={0}
            max={1}
            step={0.01}
            format={ms}
            hint="刹车按键达到全刹车所需时间"
            onChange={(v) => setTuning({ brakeRiseS: v })}
          />
          <TuningSlider
            label="转向上升"
            value={tuning.steerRiseS}
            min={0.05}
            max={1}
            step={0.01}
            format={ms}
            hint="从中心转到当前速度下最大转向角所需时间"
            onChange={(v) => setTuning({ steerRiseS: v })}
          />
          <TuningSlider
            label="转向回正"
            value={tuning.steerReturnS}
            min={0.05}
            max={1}
            step={0.01}
            format={ms}
            hint="松开按键后方向盘回正所需时间"
            onChange={(v) => setTuning({ steerReturnS: v })}
          />
          <TuningSlider
            label="半油门"
            value={tuning.halfThrottle}
            min={0.2}
            max={0.9}
            step={0.01}
            format={(v) => `${Math.round(v * 100)} %`}
            hint="按住半油门键同时踩油门时的油门量"
            onChange={(v) => setTuning({ halfThrottle: v })}
          />
        </AutoGrid>
        <div className="border-t border-[#262B3D] pt-2.5">
          <Toggle
            label="出弯油门辅助"
            detail="后轮处于极限时平顺地给油"
            checked={tuning.exitAssist}
            onChange={() => setTuning({ exitAssist: !tuning.exitAssist })}
          />
        </div>
      </SetupCard>

      <SetupCard ariaLabel="鼠标转向">
        <Toggle
          label="鼠标转向"
          detail="用鼠标在屏幕上转向；油门和刹车仍用按键"
          checked={mouseSteerEnabled}
          onChange={() => onSetMouseSteer(!mouseSteerEnabled)}
        />
      </SetupCard>
    </div>
  );
};
