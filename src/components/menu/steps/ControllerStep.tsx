"use client";

import React, { useEffect, useState } from "react";
import {
  DEFAULT_PAD_BUTTONS,
  PAD_ACTIONS,
  PAD_BRAKE_BUTTON,
  PAD_THROTTLE_BUTTON,
  padButtonLabel,
  rebindPadButton,
  type PadAction,
} from "@/lib/input/bindings";
import {
  connectedPads,
  newlyPressedButton,
  PAD_SENSITIVITY,
  padDisplayName,
  snapshotButtons,
  type PadSensitivity,
} from "@/lib/input/device-input";
import { Choice, Toggle } from "@/components/hud/PauseMenu";
import { DEFAULT_PAD_TUNING, type PadTuning } from "@/lib/settings/player-settings";
import { suspendMenuNav, useGamepads } from "../useMenuNav";
import { padFamilyOf, useInputMode, type PadFamily } from "../input-mode";
import { StickCurve, TriggerBars, TuningSlider } from "./TuningSlider";
import { PadMap } from "./PadMap";
import { AutoGrid, BindRow, bindKeyClass, ChoiceText, Hint, PillAction, SetupCard, StatusPill, TrackMeter } from "./setup-ui";
import type { SetupStepProps } from "./types";

/** Standard-mapping face buttons 0..3 (A B X Y / ✕ ○ □ △), drawn small inside a binding chip */
const FACE: Record<PadFamily, { label: string; color: string }[]> = {
  xbox: [
    { label: "A", color: "#5DC21E" },
    { label: "B", color: "#E5413A" },
    { label: "X", color: "#2F8BE5" },
    { label: "Y", color: "#F4C21B" },
  ],
  playstation: [
    { label: "✕", color: "#7EA6E6" },
    { label: "○", color: "#EE6A6A" },
    { label: "□", color: "#D78DD6" },
    { label: "△", color: "#45C9A6" },
  ],
};

const FaceDot: React.FC<{ button: number; family: PadFamily }> = ({ button, family }) => {
  const face = FACE[family][button];
  if (!face) return null;
  return (
    <span
      aria-hidden
      className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 bg-[#08090D] text-[10px] leading-none"
      style={{ borderColor: face.color, color: face.color }}
    >
      {face.label}
    </span>
  );
};

type VibratingPad = Gamepad & {
  vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> } | null;
};

function testRumble() {
  for (const pad of connectedPads() as VibratingPad[]) {
    try {
      void pad.vibrationActuator
        ?.playEffect?.("dual-rumble", { startDelay: 0, duration: 450, weakMagnitude: 0.6, strongMagnitude: 0.9 })
        ?.catch(() => {});
    } catch {
      // No rumble on this pad
    }
  }
}

/** Waits for the next button press on a standard controller and reports its index */
function useButtonCapture(active: boolean, onButton: (button: number) => void, onCancel: () => void) {
  useEffect(() => {
    if (!active) return;
    const resume = suspendMenuNav();
    let prev = snapshotButtons(connectedPads());
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = connectedPads().filter((p) => p.mapping === "standard");
      const hit = newlyPressedButton(prev, pads);
      prev = snapshotButtons(connectedPads());
      if (hit) onButton(hit.button);
    };
    raf = requestAnimationFrame(poll);
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, { capture: true });
      // Hold the menus until the captured button is released
      const wait = () => {
        if (connectedPads().some((p) => p.buttons.some((b) => b.pressed))) requestAnimationFrame(wait);
        else resume();
      };
      wait();
    };
  }, [active, onButton, onCancel]);
}

/** Controller: live input check, steering feel, rumble and button layout */
export const ControllerStep: React.FC<SetupStepProps> = ({
  settings,
  onChangeSettings,
  gamepadAssist,
  onSetGamepadAssist,
  gamepadRumble,
  onToggleGamepadRumble,
}) => {
  const pads = useGamepads();
  const { family } = useInputMode();
  const pad = pads.find((p) => p.mapping === "standard") ?? null;
  const [capturing, setCapturing] = useState<PadAction | null>(null);
  const [showMap, setShowMap] = useState(false);

  const onButton = React.useCallback(
    (button: number) => {
      if (!capturing) return;
      onChangeSettings((s) => ({ ...s, padButtons: rebindPadButton(s.padButtons, capturing, button) }));
      setCapturing(null);
    },
    [capturing, onChangeSettings]
  );
  const onCancel = React.useCallback(() => setCapturing(null), []);
  useButtonCapture(capturing !== null, onButton, onCancel);

  const tuning = settings.padTuning;
  const setTuning = (patch: Partial<PadTuning>) =>
    onChangeSettings((prev) => ({ ...prev, padTuning: { ...prev.padTuning, ...patch } }));
  // Back to the defaults, keeping the steering rate and dead zone of the chosen feel preset
  const resetTuning = () =>
    onChangeSettings((prev) => ({
      ...prev,
      padTuning: {
        ...DEFAULT_PAD_TUNING,
        steeringRate: PAD_SENSITIVITY[prev.padSensitivity].steeringRate,
        deadzone: PAD_SENSITIVITY[prev.padSensitivity].deadzone,
      },
    }));
  const curveLabel = (v: number) => (Math.abs(v - 1) < 0.025 ? "线性" : v > 1 ? `渐进 ${v.toFixed(2)}` : `激进 ${v.toFixed(2)}`);

  return (
    <div className="flex flex-col gap-4">
      <SetupCard
        label="输入检查"
        action={
          pad ? (
            <span className="flex min-w-0 items-center gap-2 font-f1-mono text-[12px] font-bold text-[#CCFF00]">
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#CCFF00] shadow-[0_0_8px_#CCFF00]" />
              <span className="truncate">{padDisplayName(pad.id)}</span>
            </span>
          ) : undefined
        }
      >
        {pad ? (
          <div className="flex flex-col gap-3.5">
            <TrackMeter label="转向" value={pad.axes[0] ?? 0} color="#00E5FF" centered />
            <TrackMeter
              label="油门"
              value={pad.buttons[PAD_THROTTLE_BUTTON]?.value ?? 0}
              detail={`RT · ${Math.round((pad.buttons[PAD_THROTTLE_BUTTON]?.value ?? 0) * 100)}%`}
            />
            <TrackMeter
              label="刹车"
              value={pad.buttons[PAD_BRAKE_BUTTON]?.value ?? 0}
              color="#FF2A3C"
              detail={`LT · ${Math.round((pad.buttons[PAD_BRAKE_BUTTON]?.value ?? 0) * 100)}%`}
            />
          </div>
        ) : (
          <Hint className="text-[14px]!">
            未找到手柄。请连接并按任意按键。非标准布局的手柄请在方向盘界面设置。
          </Hint>
        )}
      </SetupCard>

      <SetupCard label="转向手感">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PAD_SENSITIVITY) as PadSensitivity[]).map((id) => (
            <Choice
              key={id}
              active={settings.padSensitivity === id}
              onClick={() =>
                onChangeSettings((s) => ({
                  ...s,
                  padSensitivity: id,
                  padTuning: { ...s.padTuning, steeringRate: PAD_SENSITIVITY[id].steeringRate, deadzone: PAD_SENSITIVITY[id].deadzone },
                }))
              }
            >
              <ChoiceText title={PAD_SENSITIVITY[id].label} detail={PAD_SENSITIVITY[id].detail} />
            </Choice>
          ))}
        </div>
        <div className="flex flex-col">
          <Toggle
            label="转向辅助"
            detail="摇杆转向最高可达前轮抓地极限，并帮助救车"
            checked={gamepadAssist}
            onChange={() => onSetGamepadAssist(!gamepadAssist)}
          />
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Toggle
                label="震动"
                detail="路肩、抱死、空转和草地"
                checked={gamepadRumble}
                onChange={onToggleGamepadRumble}
              />
            </div>
            <PillAction onClick={testRumble} className="h-[34px]!">
              测试
            </PillAction>
          </div>
        </div>
      </SetupCard>

      <SetupCard
        label="按键 · RT 油门 · LT 刹车 · 左摇杆转向"
        action={
          <span className="flex gap-2">
            <PillAction onClick={() => setShowMap((v) => !v)}>{showMap ? "隐藏按键图" : "按键图"}</PillAction>
            <PillAction onClick={() => onChangeSettings((s) => ({ ...s, padButtons: DEFAULT_PAD_BUTTONS }))}>重置</PillAction>
          </span>
        }
      >
        {showMap ? (
          <div className="rounded-2xl border border-[#262B3D] bg-[#08090D] p-3">
            <PadMap family={pad ? padFamilyOf(pad.id) : family} bindings={settings.padButtons} pad={pad} />
          </div>
        ) : null}
        <AutoGrid min={300} className="gap-x-[18px] gap-y-0.5">
          {PAD_ACTIONS.map(({ id, label }) => {
            const listening = capturing === id;
            const button = settings.padButtons[id];
            const bound = button !== null && button !== undefined;
            return (
              <BindRow key={id} label={label} listening={listening}>
                <button
                  type="button"
                  onClick={() => setCapturing(listening ? null : id)}
                  className={bindKeyClass(listening ? "listening" : bound ? "bound" : "empty", "min-w-[76px]")}
                >
                  {listening ? (
                    "按下…"
                  ) : (
                    <>
                      {bound && button <= 3 ? <FaceDot button={button} family={family} /> : null}
                      {padButtonLabel(button)}
                    </>
                  )}
                </button>
              </BindRow>
            );
          })}
        </AutoGrid>
        {capturing ? (
          <StatusPill tone="live">按手柄按键 · Esc 取消</StatusPill>
        ) : (
          <Hint>点击一个按键，然后按下你想要的按键。</Hint>
        )}
      </SetupCard>

      <SetupCard label="微调" action={<PillAction onClick={resetTuning}>重置微调</PillAction>}>
        <div className="flex flex-wrap gap-[22px]">
          <AutoGrid min={200} className="min-w-0 flex-[1_1_340px] gap-x-5 gap-y-2">
            <TuningSlider
              label="转向速度"
              value={tuning.steeringRate}
              min={0.1}
              max={1.5}
              step={0.05}
              format={(v) => `×${v.toFixed(2)}`}
              hint="摇杆转动转向辅助的速度"
              onChange={(v) => setTuning({ steeringRate: v })}
            />
            <TuningSlider
              label="内侧死区"
              value={tuning.deadzone}
              min={0}
              max={0.3}
              step={0.01}
              format={(v) => `${Math.round(v * 100)} %`}
              hint="中心附近被忽略的摇杆行程"
              onChange={(v) => setTuning({ deadzone: v })}
            />
            <TuningSlider
              label="外侧死区"
              value={tuning.outerDeadzone}
              min={0}
              max={0.3}
              step={0.01}
              format={(v) => `${Math.round(v * 100)} %`}
              hint="在摇杆到达物理极限前即可打满方向"
              onChange={(v) => setTuning({ outerDeadzone: v })}
            />
            <TuningSlider
              label="摇杆线性度"
              value={tuning.linearity}
              min={0.5}
              max={3}
              step={0.05}
              format={(v) => (Math.abs(v - 1) < 0.025 ? "1.00 = 线性" : v.toFixed(2))}
              hint="大于 1 时中心附近控制更精细"
              onChange={(v) => setTuning({ linearity: v })}
            />
            <TuningSlider
              label="油门曲线"
              value={tuning.throttleGamma}
              min={0.5}
              max={3}
              step={0.05}
              format={curveLabel}
              hint="大于 1 时轻踩更柔和"
              onChange={(v) => setTuning({ throttleGamma: v })}
            />
            <TuningSlider
              label="刹车曲线"
              value={tuning.brakeGamma}
              min={0.5}
              max={3}
              step={0.05}
              format={curveLabel}
              hint="大于 1 时轻刹控制更精细"
              onChange={(v) => setTuning({ brakeGamma: v })}
            />
          </AutoGrid>
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-3 sm:max-w-[240px]">
            <StickCurve deadzone={tuning.deadzone} outerDeadzone={tuning.outerDeadzone} linearity={tuning.linearity} />
            <TriggerBars throttleGamma={tuning.throttleGamma} brakeGamma={tuning.brakeGamma} />
          </div>
        </div>
        <div className="border-t border-[#262B3D] pt-2.5">
          <Toggle
            label="扳机震动（Xbox）"
            detail="LT 中 ABS 脉动，RT 中轮胎空转"
            checked={tuning.triggerRumble}
            onChange={() => setTuning({ triggerRumble: !tuning.triggerRumble })}
          />
        </div>
      </SetupCard>
    </div>
  );
};
