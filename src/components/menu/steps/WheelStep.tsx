"use client";

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PAD_ACTIONS, type PadAction } from "@/lib/input/bindings";
import {
  autoConfigureWheel,
  CAR_WHEEL_LOCKS_DEG,
  connectedPads,
  emptyWheelButtons,
  findPad,
  newlyPressedButton,
  padDisplayName,
  pedalValue,
  snapshotAxes,
  snapshotButtons,
  strongestAxisChange,
  WHEEL_ROTATION_PRESETS,
  WHEEL_TYPE_DEFAULTS,
  wheelSteerValue,
  type AxisBinding,
  type AxisSnapshot,
  type ButtonBinding,
  type PedalBinding,
  type WheelSettings,
  type WheelType,
} from "@/lib/input/device-input";
import { type FfbStatus, webHidFfb, wheelFfb } from "@/lib/input/wheel-ffb";
import { isFatalHidStatus, type WebHidFfbStatus } from "@/lib/input/webhid-ffb";
import { Choice, Toggle, TyreSlider } from "@/components/hud/PauseMenu";
import { suspendMenuNav, useGamepads, type PadState } from "../useMenuNav";
import { TuningSlider } from "./TuningSlider";
import { AutoGrid, BindRow, bindKeyClass, ChoiceText, Hint, PillAction, SetupCard, SolidPill, StatusPill, SubHead, TrackMeter } from "./setup-ui";
import type { SetupStepProps } from "./types";

type CalTarget = "steer" | "throttle" | "brake";

const STEER_DETECT = 0.12;
const PEDAL_DETECT = 0.2;

const PROMPTS: Record<CalTarget, { rest: string; act: string }> = {
  steer: { rest: "把方向盘扶正，然后按继续。", act: "现在把方向盘向左转约 90° 并保持。" },
  throttle: { rest: "把脚从油门上移开，然后按继续。", act: "把油门踩到底，然后松开。" },
  brake: { rest: "把脚从刹车上移开，然后按继续。", act: "把刹车踩到底，然后松开。" },
};

/**
 * Guided axis detection: a resting snapshot, then the axis that moves furthest. Steering records the
 * centre and direction; pedals record released and fully-pressed values (so inverted and combined-axis
 * pedals just work).
 */
const AxisCalibrator: React.FC<{
  target: CalTarget;
  exclude: { padId: string; axis: number }[];
  onSteer: (b: AxisBinding) => void;
  onPedal: (target: "throttle" | "brake", b: PedalBinding) => void;
  onCancel: () => void;
}> = ({ target, exclude, onSteer, onPedal, onCancel }) => {
  const [stage, setStage] = useState<"rest" | "act">("rest");
  const [meter, setMeter] = useState(0);
  const [canSavePedal, setCanSavePedal] = useState(false);
  const baseline = useRef<AxisSnapshot | null>(null);
  const locked = useRef<{ padId: string; axis: number; base: number; peak: number } | null>(null);
  // Reports once: a frame can still run after the result, before this calibrator unmounts
  const reported = useRef(false);
  const heldSince = useRef(0);

  useEffect(() => {
    if (stage !== "act") return;
    let raf = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const pads = connectedPads();
      const base = baseline.current;
      if (!base || reported.current) return;
      const excluded = (padId: string, axis: number) => exclude.some((e) => e.padId === padId && e.axis === axis);

      if (target === "steer") {
        const best = strongestAxisChange(base, pads, excluded);
        if (!best) return;
        setMeter(Math.min(1, Math.abs(best.delta) / STEER_DETECT));
        if (Math.abs(best.delta) < STEER_DETECT) {
          heldSince.current = 0;
          return;
        }
        if (!heldSince.current) heldSince.current = t;
        if (t - heldSince.current > 250) {
          reported.current = true;
          onSteer({ padId: best.padId, axis: best.axis, center: best.base, invert: best.delta > 0 });
        }
        return;
      }

      // Pedals: lock onto the first axis that clearly moves, follow it to its peak and back
      if (!locked.current) {
        const found = strongestAxisChange(base, pads, excluded);
        if (found && Math.abs(found.delta) > PEDAL_DETECT) {
          locked.current = { padId: found.padId, axis: found.axis, base: found.base, peak: found.value };
          setCanSavePedal(true);
        }
        setMeter(found ? Math.min(1, Math.abs(found.delta) / 1.2) : 0);
        return;
      }
      const l = locked.current;
      const value = findPad(pads, l.padId)?.axes[l.axis] ?? l.base;
      if (Math.abs(value - l.base) > Math.abs(l.peak - l.base)) l.peak = value;
      const peakDelta = Math.abs(l.peak - l.base);
      setMeter(Math.min(1, Math.abs(value - l.base) / Math.max(0.35, peakDelta)));
      if (peakDelta > 0.25 && Math.abs(value - l.base) < peakDelta * 0.25) {
        reported.current = true;
        onPedal(target, { padId: l.padId, axis: l.axis, idle: l.base, full: l.peak });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, target, exclude, onSteer, onPedal]);

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-[#CCFF00]/60 bg-[#CCFF00]/[0.08] p-3.5">
      <p className="lc-title m-0 text-[14px] text-[#F5F7FA]">{stage === "rest" ? PROMPTS[target].rest : PROMPTS[target].act}</p>
      {stage === "act" ? (
        <span className="block h-1.5 overflow-hidden rounded-full bg-[#08090D]">
          <span className="block h-full rounded-full bg-[#CCFF00] transition-[width]" style={{ width: `${Math.round(meter * 100)}%` }} />
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {stage === "rest" ? (
          <SolidPill
            tone="volt"
            onClick={() => {
              baseline.current = snapshotAxes(connectedPads());
              locked.current = null;
              heldSince.current = 0;
              setCanSavePedal(false);
              setStage("act");
            }}
          >
            继续
          </SolidPill>
        ) : target !== "steer" && canSavePedal ? (
          <SolidPill
            tone="volt"
            onClick={() => {
              const l = locked.current;
              if (!l || reported.current) return;
              reported.current = true;
              onPedal(target, { padId: l.padId, axis: l.axis, idle: l.base, full: l.peak });
            }}
          >
            保存
          </SolidPill>
        ) : null}
        <PillAction onClick={onCancel} className="h-[34px]!">
          取消
        </PillAction>
      </div>
    </div>
  );
};

/** Next button press on any device (wheel rim, button box, shifter) */
function useAnyButtonCapture(active: boolean, onButton: (b: ButtonBinding) => void, onCancel: () => void) {
  useEffect(() => {
    if (!active) return;
    const resume = suspendMenuNav();
    let prev = snapshotButtons(connectedPads());
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = connectedPads();
      const hit = newlyPressedButton(prev, pads);
      prev = snapshotButtons(pads);
      if (hit) onButton(hit);
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
      const wait = () => {
        if (connectedPads().some((p) => p.buttons.some((b) => b.pressed))) requestAnimationFrame(wait);
        else resume();
      };
      wait();
    };
  }, [active, onButton, onCancel]);
}

const shortPad = (padId: string) => padDisplayName(padId).slice(0, 18);

function liveSteer(pads: PadState[], w: WheelSettings) {
  if (!w.steer) return null;
  const pad = pads.find((p) => p.id === w.steer!.padId);
  if (!pad) return null;
  const raw = pad.axes[w.steer.axis] ?? w.steer.center;
  const norm = wheelSteerValue(raw, w.steer, w.rotationDeg, w.steerDeadzone);
  const deg = Math.max(-1, Math.min(1, (raw - w.steer.center) * (w.steer.invert ? -1 : 1))) * (w.rotationDeg / 2);
  return { norm, deg };
}

function livePedal(pads: PadState[], b: PedalBinding | null, gamma = 1) {
  if (!b) return null;
  const pad = pads.find((p) => p.id === b.padId);
  return pad ? pedalValue(pad.axes[b.axis] ?? b.idle, b, gamma) : null;
}

/** Where the force-feedback bridge stands, and how to start it when it is not running */
function FfbBridgeStatus({ status }: { status: FfbStatus }) {
  if (status.connection === "replaced") {
    return (
      <p role="status" className="m-0 rounded-[14px] bg-[#FFB300]/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-[#FFB300]">
        另一个标签页接管了方向盘。请关闭它，或在此处开关一次力反馈以夺回控制。
      </p>
    );
  }
  if (status.connection === "unreachable") {
    return (
      <p role="status" className="m-0 rounded-[14px] bg-[#FFB300]/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-[#FFB300]">
        桥接程序未运行。请在项目文件夹的终端中运行{" "}
        <code className="font-f1-mono text-[12px] font-bold text-[#F5F7FA]">npm run ffb</code>（Windows）并保持打开；
        本页面会在几秒内连接。
      </p>
    );
  }
  const [color, text] =
    status.connection !== "connected"
      ? ["#8E96AA", "正在本机寻找桥接程序…"]
      : status.error
        ? ["#FFB300", status.error]
        : status.device
          ? ["#22C55E", `正在驱动 ${status.device}`]
          : ["#8E96AA", "桥接已连接 · 等待方向盘…"];
  return (
    <p role="status" className="m-0 flex items-center gap-2 font-f1-mono text-[12px] font-bold" style={{ color }}>
      <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {text}
    </p>
  );
}

const connectHidWheel = () => {
  // requestDevice must run inside the click itself (it needs the click's user activation)
  void webHidFfb.connect();
};

/** Where the WebHID driver stands: pairing, the wheel it drives, or why it stopped */
function HidFfbStatusLine({ status, on }: { status: WebHidFfbStatus; on: boolean }) {
  const fatal = isFatalHidStatus(status);
  if (!on && !fatal) return null;
  const browserUnsupported = status.state === "unsupported" && status.device === null;
  const [color, text] =
    status.state === "ready"
      ? ["#22C55E", `正通过 WebHID 驱动 ${status.device ?? "方向盘"}`]
      : status.state === "connecting"
        ? ["#8E96AA", status.device ? `正在连接 ${status.device}…` : "正在连接…"]
        : fatal
          ? ["#FF2A3C", `${status.device ? `${status.device}：` : ""}${status.message ?? "WebHID 力反馈失败"}`]
          : ["#FFB300", status.message ?? "尚未配对方向盘：点击连接以选择"];
  const canConnect = !browserUnsupported && status.state !== "ready" && status.state !== "connecting";
  return (
    <div className="flex flex-col items-start gap-1.5 px-2 pt-1">
      <p role="status" className="m-0 flex items-center gap-2 font-f1-mono text-[12px] leading-relaxed font-bold" style={{ color }}>
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} />
        {text}
      </p>
      {fatal && !browserUnsupported ? (
        <Hint>WebHID 已关闭；力反馈改走桥接程序。{on ? "" : " 重新打开可重试。"}</Hint>
      ) : null}
      {on && canConnect ? (
        <SolidPill tone="volt" onClick={connectHidWheel}>
          连接方向盘
        </SolidPill>
      ) : null}
    </div>
  );
}

/** Wheel: type, steering calibration and rotation, pedal calibration, button mapping */
export const WheelStep: React.FC<SetupStepProps> = ({ settings, onChangeSettings }) => {
  const pads = useGamepads();
  const w = settings.wheel;
  const [calibrating, setCalibrating] = useState<CalTarget | null>(null);
  const [calAllSeq, setCalAllSeq] = useState(false);
  const [capturing, setCapturing] = useState<PadAction | null>(null);
  const [customRotation, setCustomRotation] = useState(false);
  const ffb = useSyncExternalStore(wheelFfb.subscribe, wheelFfb.getStatus, wheelFfb.getStatus);
  const hid = useSyncExternalStore(webHidFfb.subscribe, webHidFfb.getStatus, webHidFfb.getStatus);
  const hidBrowserUnsupported = hid.state === "unsupported" && hid.device === null;
  // WebHID drives the wheel only while it is switched on and ready; otherwise the bridge does
  const hidActive = w.hidFfb && hid.state === "ready";
  const ffbReady = hidActive || (ffb.connection === "connected" && ffb.device !== null && ffb.error === null);
  // The port field edits as text: a half-typed number must not snap to the range's edge while typing
  const [portText, setPortText] = useState(String(w.telemetryPort));

  const setWheel = useCallback(
    (patch: Partial<WheelSettings>) => onChangeSettings((s) => ({ ...s, wheel: { ...s.wheel, ...patch } })),
    [onChangeSettings]
  );

  // A recognised wheel base with no steering bound yet: bind its first axis and the type's defaults (calibrate to refine)
  useEffect(() => {
    if (w.steer || pads.length === 0) return;
    const patch = autoConfigureWheel(connectedPads(), w);
    if (patch) setWheel(patch);
  }, [pads.length, w, setWheel]);

  const calAllRef = useRef(calAllSeq);
  calAllRef.current = calAllSeq;

  const calibratingRef = useRef(calibrating);
  calibratingRef.current = calibrating;
  const onSteer = useCallback((steer: AxisBinding) => {
    if (calibratingRef.current !== "steer") return;
    setWheel({ steer });
    if (calAllRef.current) {
      setCalibrating("throttle");
    } else {
      setCalibrating(null);
    }
  }, [setWheel]);
  const onPedal = useCallback(
    (target: "throttle" | "brake", b: PedalBinding) => {
      // The result belongs to the calibrator that measured it: a late frame from the throttle step must never land on
      // the brake once the wizard has moved on (that bound both pedals to the throttle's axis)
      if (target !== calibratingRef.current) return;
      if (target === "throttle") {
        setWheel({ throttle: b });
        if (calAllRef.current) {
          setCalibrating("brake");
          return;
        }
      }
      if (target === "brake") {
        setWheel({ brake: b });
        setCalAllSeq(false);
      }
      setCalibrating(null);
    },
    [setWheel]
  );
  const onCancelCal = useCallback(() => {
    setCalAllSeq(false);
    setCalibrating(null);
  }, []);

  const onButton = useCallback(
    (b: ButtonBinding) => {
      if (!capturing) return;
      onChangeSettings((s) => {
        const buttons = { ...s.wheel.buttons };
        for (const k of Object.keys(buttons) as PadAction[]) {
          const cur = buttons[k];
          if (cur && cur.padId === b.padId && cur.button === b.button) buttons[k] = null;
        }
        buttons[capturing] = b;
        return { ...s, wheel: { ...s.wheel, buttons } };
      });
      setCapturing(null);
    },
    [capturing, onChangeSettings]
  );
  const onCancelCapture = useCallback(() => setCapturing(null), []);
  useAnyButtonCapture(capturing !== null, onButton, onCancelCapture);

  // Axes already taken, so the next calibration ignores them
  const excludeFor = useCallback(
    (target: CalTarget) =>
      [target !== "steer" ? w.steer : null, target !== "throttle" ? w.throttle : null, target !== "brake" ? w.brake : null]
        .filter((b): b is AxisBinding | PedalBinding => Boolean(b))
        .map((b) => ({ padId: b.padId, axis: b.axis })),
    [w.steer, w.throttle, w.brake]
  );
  const exclude = React.useMemo(() => (calibrating ? excludeFor(calibrating) : []), [calibrating, excludeFor]);

  const steer = liveSteer(pads, w);
  const throttle = livePedal(pads, w.throttle);
  const brake = livePedal(pads, w.brake, w.brakeGamma);

  const calRow = (target: CalTarget, label: string, bound: AxisBinding | PedalBinding | null, live: React.ReactNode) => (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <SubHead>{label}</SubHead>
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="truncate font-f1-mono text-[11px] font-bold text-[#8E96AA]">
            {bound ? `${shortPad(bound.padId)} · 轴 ${bound.axis}` : "未设置"}
          </span>
          <SolidPill
            disabled={calibrating !== null && calibrating !== target}
            onClick={() => {
              setCalAllSeq(false);
              setCalibrating(calibrating === target ? null : target);
            }}
            className={calibrating === target ? "lc-listen" : ""}
          >
            {bound ? "重新校准" : "校准"}
          </SolidPill>
        </span>
      </div>
      {calibrating === target ? (
        <AxisCalibrator key={target} target={target} exclude={exclude} onSteer={onSteer} onPedal={onPedal} onCancel={onCancelCal} />
      ) : bound ? (
        live
      ) : null}
    </div>
  );

  const notConnected = <Hint>设备未连接</Hint>;
  const customActive = customRotation || !(WHEEL_ROTATION_PRESETS as readonly number[]).includes(w.rotationDeg);
  const rotationPill = (active: boolean) =>
    `min-h-[40px] flex-1 cursor-pointer rounded-full border px-1.5 font-f1-mono text-[12px] font-extrabold transition-colors duration-200 ${
      active
        ? "border-[#CCFF00] bg-[#CCFF00] text-[#08090D]"
        : "border-[#262B3D] bg-transparent text-[#8E96AA] hover:border-[#3A4157] hover:text-[#F5F7FA]"
    }`;

  return (
    <div
      className="grid items-start gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))" }}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <SetupCard label="方向盘底座">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "direct_drive", title: "直驱", sub: "Fanatec DD、Moza、Simucube、Simagic… · 原始、无滤波" },
                { id: "belt_gear", title: "皮带 / 齿轮", sub: "Logitech、Thrustmaster、CSL Elite… · 轻滤波" },
              ] as const
            ).map((t) => (
              <Choice
                key={t.id}
                active={w.type === t.id}
                onClick={() => setWheel({ type: t.id as WheelType, ...WHEEL_TYPE_DEFAULTS[t.id] })}
              >
                <ChoiceText title={t.title} detail={t.sub} size={14} />
              </Choice>
            ))}
          </div>
        </SetupCard>

        <SetupCard
          label="转向"
          action={
            <SolidPill
              tone="volt"
              onClick={() => {
                setCalAllSeq(true);
                setCalibrating("steer");
              }}
            >
              全部校准
            </SolidPill>
          }
        >
          {pads.length === 0 ? (
            <Hint className="text-[13px]!">尚未找到方向盘。按方向盘上的按键将其唤醒。</Hint>
          ) : !w.throttle || !w.brake ? (
            <p className="m-0 rounded-[14px] bg-[#FFB300]/10 px-3.5 py-2.5 text-[13px] text-[#FFB300]">
              踏板尚未设置：按<strong>全部校准</strong>可一次设置转向、油门和刹车。
            </p>
          ) : null}
          {calRow(
            "steer",
            "转向轴",
            w.steer,
            steer ? (
              <TrackMeter
                compact
                centered
                label="方向盘"
                value={steer.norm}
                color="#00E5FF"
                detail={`${steer.deg >= 0 ? "" : "−"}${Math.abs(Math.round(steer.deg))}°`}
              />
            ) : (
              notConnected
            )
          )}
          <div className="flex flex-col gap-2.5 border-t border-[#262B3D] pt-3">
            <SubHead>转向角度 · 左右锁止</SubHead>
            <div className="flex gap-1.5">
              {WHEEL_ROTATION_PRESETS.map((deg) => (
                <button
                  key={deg}
                  type="button"
                  aria-pressed={!customRotation && w.rotationDeg === deg}
                  onClick={() => {
                    setCustomRotation(false);
                    setWheel({ rotationDeg: deg });
                  }}
                  className={rotationPill(!customRotation && w.rotationDeg === deg)}
                >
                  {deg}°
                </button>
              ))}
              <button
                type="button"
                aria-pressed={customActive}
                onClick={() => setCustomRotation(true)}
                className={rotationPill(customActive)}
              >
                自定义
              </button>
            </div>
            {customActive ? (
              <TyreSlider
                label="转向角度"
                value={w.rotationDeg}
                limits={{ min: 180, max: 2520, step: 10 }}
                format={(v) => `${v.toFixed(0)}°`}
                onChange={(v) => setWheel({ rotationDeg: v })}
              />
            ) : null}
            <Hint>
              请与方向盘驱动中的转向角度一致。转向在赛车锁止角度内为 1:1（F1 为 {CAR_WHEEL_LOCKS_DEG.vf26}°，
              GT3 为 {CAR_WHEEL_LOCKS_DEG["amg-gt3"]}°）；底座角度更小仍可打满方向。
            </Hint>
          </div>
          <AutoGrid min={180} className="gap-x-4 gap-y-1">
            <TyreSlider
              label="中心死区"
              value={Math.round(w.steerDeadzone * 1000) / 10}
              limits={{ min: 0, max: 10, step: 0.5 }}
              format={(v) => `${v.toFixed(1)} %`}
              onChange={(v) => setWheel({ steerDeadzone: v / 100 })}
            />
            <TyreSlider
              label="输入滤波"
              value={Math.round(w.steerSmoothingS * 1000)}
              limits={{ min: 0, max: 80, step: 5 }}
              format={(v) => (v === 0 ? "关闭" : `${v.toFixed(0)} ms`)}
              onChange={(v) => setWheel({ steerSmoothingS: v / 1000 })}
            />
          </AutoGrid>
        </SetupCard>

        <SetupCard
          label="按键 · 拨片、盘圈、按键盒"
          action={<PillAction onClick={() => setWheel({ buttons: emptyWheelButtons() })}>清除</PillAction>}
        >
          <AutoGrid min={260} className="gap-x-4 gap-y-0.5">
            {PAD_ACTIONS.map(({ id, label }) => {
              const listening = capturing === id;
              const b = w.buttons[id];
              return (
                <BindRow key={id} label={label} listening={listening}>
                  <button
                    type="button"
                    aria-label={b || listening ? undefined : `绑定 ${label}`}
                    onClick={() => setCapturing(listening ? null : id)}
                    className={`${bindKeyClass(listening ? "listening" : b ? "bound" : "empty", "min-w-[96px]")} h-[32px]! text-[11px]!`}
                  >
                    {listening ? "按下…" : b ? `按键 ${b.button}` : "+"}
                  </button>
                </BindRow>
              );
            })}
          </AutoGrid>
          {capturing ? (
            <StatusPill tone="live">在任意设备上按一个按键 · Esc 取消</StatusPill>
          ) : (
            <Hint>换挡拨片和暂停按键是必备的。</Hint>
          )}
        </SetupCard>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <SetupCard
          label="力反馈"
          action={
            <button
              type="button"
              role="switch"
              aria-checked={w.ffbEnabled}
              aria-label="力反馈"
              onClick={() => setWheel({ ffbEnabled: !w.ffbEnabled })}
              className={`relative h-[30px] w-16 shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 ${
                w.ffbEnabled ? "bg-[#22C55E]" : "bg-[#1B1F2B] shadow-[inset_0_0_0_1px_#262B3D]"
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-1/2 -translate-y-1/2 font-f1-mono text-[11px] font-extrabold ${
                  w.ffbEnabled ? "left-2.5 text-[#08090D]" : "right-2.5 text-[#8E96AA]"
                }`}
              >
                {w.ffbEnabled ? "开" : "关"}
              </span>
              <span
                aria-hidden
                className={`absolute top-[5px] h-5 w-5 rounded-full transition-[left] duration-[220ms] ease-[cubic-bezier(.2,.8,.2,1)] ${
                  w.ffbEnabled ? "left-[39px] bg-[#08090D]" : "left-[5px] bg-[#8E96AA]"
                }`}
              >
                {""}
              </span>
            </button>
          }
        >
          {w.ffbEnabled ? (
            <>
              <div className="rounded-[16px] border border-[#262B3D] bg-[#08090D] p-3">
                <Toggle
                  label="浏览器通过 WebHID 的力反馈（USB HID PID 直驱底座）"
                  detail={
                    hidBrowserUnsupported
                      ? (hid.message ?? "此浏览器不支持 WebHID")
                      : "无需外部辅助程序，直接从 Chrome/Edge 驱动 USB HID PID 方向盘。关闭时回退到本地桥接程序。"
                  }
                  checked={w.hidFfb && !hidBrowserUnsupported}
                  disabled={hidBrowserUnsupported}
                  onChange={() => {
                    if (w.hidFfb) {
                      setWheel({ hidFfb: false });
                      return;
                    }
                    connectHidWheel();
                    setWheel({ hidFfb: true });
                  }}
                />
                {hidBrowserUnsupported ? null : <HidFfbStatusLine status={hid} on={w.hidFfb} />}
              </div>
              {!w.hidFfb || hidBrowserUnsupported || ffb.connection === "connected" ? <FfbBridgeStatus status={ffb} /> : null}
              <AutoGrid min={190} className="gap-x-[18px] gap-y-1">
                <TyreSlider
                  label="强度"
                  value={Math.round(w.ffbGain * 100)}
                  limits={{ min: 0, max: 200, step: 5 }}
                  format={(v) => `${v.toFixed(0)} %`}
                  onChange={(v) => setWheel({ ffbGain: v / 100 })}
                />
                <TyreSlider
                  label="最小力"
                  value={Math.round(w.ffbMinForce * 100)}
                  limits={{ min: 0, max: 20, step: 1 }}
                  format={(v) => (v === 0 ? "关闭" : `${v.toFixed(0)} %`)}
                  onChange={(v) => setWheel({ ffbMinForce: v / 100 })}
                />
                <TyreSlider
                  label="路肩震动"
                  value={Math.round(w.ffbKerb * 100)}
                  limits={{ min: 0, max: 100, step: 5 }}
                  format={(v) => (v === 0 ? "关闭" : `${v.toFixed(0)} %`)}
                  onChange={(v) => setWheel({ ffbKerb: v / 100 })}
                />
                <TyreSlider
                  label="ABS 震动"
                  value={Math.round(w.ffbAbs * 100)}
                  limits={{ min: 0, max: 100, step: 5 }}
                  format={(v) => (v === 0 ? "关闭" : `${v.toFixed(0)} %`)}
                  onChange={(v) => setWheel({ ffbAbs: v / 100 })}
                />
                <TuningSlider
                  label="阻尼"
                  value={Math.round(w.ffbDamping * 100)}
                  min={0}
                  max={100}
                  step={1}
                  format={(v) => (v === 0 ? "关闭" : `${v} %`)}
                  hint="抑制盘圈快速转动，高速时稳定方向盘"
                  onChange={(v) => setWheel({ ffbDamping: v / 100 })}
                />
                <TuningSlider
                  label="平滑"
                  value={Math.round(w.ffbFilterS * 1000)}
                  min={0}
                  max={50}
                  step={1}
                  format={(v) => (v === 0 ? "0 = 原始" : `${v} ms`)}
                  hint="力反馈低通滤波。0 = 原始"
                  onChange={(v) => setWheel({ ffbFilterS: v / 1000 })}
                />
              </AutoGrid>
              <div className="flex flex-wrap items-center gap-2">
                <SolidPill disabled={!ffbReady} onClick={() => wheelFfb.test(w.ffbInvert)} className="h-10!">
                  测试方向
                </SolidPill>
                <button
                  type="button"
                  onClick={() => setWheel({ ffbInvert: !w.ffbInvert })}
                  className={`inline-flex h-10 cursor-pointer items-center rounded-full px-4 text-[13px] font-bold transition-colors duration-200 ${
                    w.ffbInvert
                      ? "border border-[#CCFF00] bg-[#CCFF00] text-[#08090D]"
                      : "border border-[#262B3D] bg-[#F5F7FA]/[0.08] text-[#F5F7FA] hover:border-[#3A4157]"
                  }`}
                >
                  {w.ffbInvert ? "已反向" : "反向"}
                </button>
              </div>
              <Hint>
                握住盘圈并按测试：应先向右拉一秒，再向左拉。如果先向左拉，请打开反向。方向盘的整体强度和阻尼保留在其自带软件中（Moza Pit House、Fanatec
                控制面板…）；请在那里关闭回正弹簧。
              </Hint>
            </>
          ) : (
            <Hint className="text-[13px]!">
              打开力反馈并点击<strong>连接方向盘</strong>，即可在 Chrome/Edge 中直接通过 WebHID 驱动方向盘（或运行 <code className="font-f1-mono text-[12px] font-bold text-[#F5F7FA]">npm run ffb</code>{" "}
              使用本地桥接程序）。
            </Hint>
          )}

          <div className="flex flex-col gap-2.5 rounded-[18px] border border-[#262B3D] bg-[#08090D] p-3.5">
            <SubHead>遥测输出</SubHead>
            <Toggle
              label="通过桥接程序发送 UDP 遥测（SimHub、仪表盘、低频震动器）"
              checked={w.telemetryOut}
              onChange={() => setWheel({ telemetryOut: !w.telemetryOut })}
            />
            <div className={`flex items-center justify-between gap-3 px-2 ${w.telemetryOut ? "" : "opacity-40"}`}>
              <span className="font-f1-mono text-[11px] font-bold text-[#8E96AA]">UDP 端口</span>
              <input
                type="number"
                inputMode="numeric"
                min={1024}
                max={65535}
                step={1}
                disabled={!w.telemetryOut}
                value={portText}
                onChange={(e) => {
                  setPortText(e.target.value);
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1024 && n <= 65535) setWheel({ telemetryPort: n });
                }}
                onBlur={() => setPortText(String(w.telemetryPort))}
                className="h-[34px] w-28 rounded-full border border-[#262B3D] bg-[#11131A] px-3 text-right font-f1-mono text-[13px] font-extrabold text-[#F5F7FA] tabular-nums disabled:cursor-not-allowed"
              />
            </div>
            <Hint>
              需要桥接程序运行：<span className="font-f1-mono text-[#F5F7FA]">npm run ffb</span>
            </Hint>
          </div>
        </SetupCard>

        <SetupCard label="踏板">
          {calRow(
            "throttle",
            "油门",
            w.throttle,
            throttle !== null ? <TrackMeter compact label="油门" value={throttle} /> : notConnected
          )}
          {calRow(
            "brake",
            "刹车",
            w.brake,
            brake !== null ? <TrackMeter compact label="刹车" value={brake} color="#FF2A3C" /> : notConnected
          )}
          <div className="flex flex-col gap-1 border-t border-[#262B3D] pt-2.5">
            <TyreSlider
              label="刹车曲线"
              value={w.brakeGamma}
              limits={{ min: 0.5, max: 2.5, step: 0.1 }}
              format={(v) => (Math.abs(v - 1) < 0.05 ? "线性" : v > 1 ? `渐进 ${v.toFixed(1)}` : `激进 ${v.toFixed(1)}`)}
              onChange={(v) => setWheel({ brakeGamma: v })}
            />
            <Hint className="px-2">
              压力传感器刹车通常线性最好；电位器踏板常用 1.3–1.6。不需要离合器。
            </Hint>
          </div>
        </SetupCard>
      </div>
    </div>
  );
};
