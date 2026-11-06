"use client";

import React, { useState } from "react";
import {
  sanitizeColor,
  sanitizeDriverCode,
  sanitizeDriverName,
  type DriverProfile,
  type GraphicsQuality,
  type GraphicsSettings,
  type HudPreset,
  type HudSettings,
  type PlayerSettings,
  type TouchMode,
  type TouchSettings,
  type VirtualMirrorMode,
} from "@/lib/settings/player-settings";
import { Toggle } from "./PauseMenu";

export interface DisplayPanelProps {
  settings: PlayerSettings;
  onChangeSettings: (update: (prev: PlayerSettings) => PlayerSettings) => void;
  /** WebXR immersive-vr is available on this device */
  vrSupported: boolean;
  vrActive: boolean;
  onEnterVr: () => void;
  /** Automatic graphics test: re-runs the benchmark on demand (only from the title menu). */
  onRunGraphicsTest?: () => void;
  /** True while a benchmark is running; the button is disabled then. */
  graphicsTestRunning?: boolean;
  /** True when a benchmark cannot start here (e.g. a race is running); the button is disabled. */
  graphicsTestDisabled?: boolean;
}

const DRIVER_COLORS = ["#E10600", "#00D2BE", "#FF8700", "#0600EF", "#006F62", "#2B4562", "#B6BABD", "#CCFF00"] as const;

const HUD_PRESETS: { id: HudPreset; title: string; detail: string }[] = [
  { id: "broadcast", title: "转播", detail: "电视转播画面：排名塔、赛道图、遥测条" },
  { id: "dash", title: "方向盘仪表", detail: "方向盘屏幕，低位居中" },
  { id: "telemetry", title: "遥测", detail: "仪表盘加轮胎、G 值、动力、输入" },
  { id: "classic", title: "经典", detail: "原始角落面板" },
  { id: "minimal", title: "极简", detail: "仅速度、挡位和圈数" },
];

const QUALITY_CHOICES: { id: GraphicsQuality; title: string; detail: string }[] = [
  { id: "low", title: "低", detail: "无阴影和泛光，较低分辨率——适合笔记本和手机" },
  { id: "medium", title: "中", detail: "有阴影，无泛光" },
  { id: "high", title: "高", detail: "全部开启" },
];

const TOUCH_CHOICES: { id: TouchMode; title: string; detail: string }[] = [
  { id: "auto", title: "自动", detail: "手机和平板" },
  { id: "on", title: "开启", detail: "始终" },
  { id: "off", title: "关闭", detail: "从不" },
];

/**
 * A card of the panel: a frosted card in the pause menu, the darker inset card inside the title menu's
 * panel sheet (`.lc-title-frame`)
 */
const CARD =
  "flex min-w-0 flex-col gap-3.5 rounded-[24px] border border-white/[0.07] bg-[#0D0F15]/[0.82] p-[18px] text-[#F5F7FA] [.lc-title-frame_&]:rounded-[22px] [.lc-title-frame_&]:border-[#262B3D] [.lc-title-frame_&]:bg-[#08090D]/60";
const FIELD_LABEL = "lc-lbl text-[9px]";
const INPUT =
  "h-11 w-full min-w-0 rounded-[14px] border border-[#262B3D] bg-[#08090D] px-3.5 text-[15px] font-semibold text-[#F5F7FA] outline-none focus:border-[#CCFF00] focus:shadow-[0_0_0_4px_rgba(204,255,0,0.12)]";

/** Card header: status dot + mono label */
const CardHeader: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <div className="flex items-center gap-2">
    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
    <span className="lc-lbl">{label}</span>
  </div>
);

/** Labelled range slider with a live value, rounded to its step */
const RangeRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  hint?: string;
  dim?: boolean;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, format, hint, dim, onChange }) => (
  <label
    className={`flex flex-col gap-2.5 rounded-[14px] px-2 py-2 transition-opacity hover:bg-white/[0.04] ${dim ? "opacity-55" : ""}`}
  >
    <span className="flex items-center justify-between gap-3">
      <span className="text-[15px] font-bold text-[#F5F7FA]">{label}</span>
      <span className="font-f1-mono text-[13px] font-extrabold text-[#CCFF00] tabular-nums">{format(value)}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(Number(e.target.value).toFixed(2)))}
      className="lc-range"
      style={{ "--lc-fill": `${((value - min) / (max - min || 1)) * 100}%` } as React.CSSProperties}
    />
    {hint ? <span className="text-[12px] leading-snug text-[#8E96AA]">{hint}</span> : null}
  </label>
);

/** Option card of a radio group (quality, touch mode): title over a short description, volt edge when picked */
const OptionCard: React.FC<{ active: boolean; title: string; detail: string; onClick: () => void; tall?: boolean }> = ({
  active,
  title,
  detail,
  onClick,
  tall,
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={active}
    onClick={onClick}
    className={`flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-[14px] px-3 py-2.5 text-left transition-[background-color,border-color] duration-200 ${
      tall ? "min-h-[92px]" : "min-h-[56px]"
    } ${
      active
        ? "border-[1.5px] border-[#CCFF00] bg-[#CCFF00]/[0.07]"
        : "border border-[#262B3D] bg-transparent hover:border-[#3A4157] hover:bg-white/[0.03]"
    }`}
  >
    <span className={`text-[15px] font-bold ${active ? "text-[#F5F7FA]" : "text-[#C5CBD8]"}`}>{title}</span>
    <span className={`text-[12px] leading-snug ${active ? "text-[#C5CBD8]" : "text-[#8E96AA]"}`}>{detail}</span>
  </button>
);

/** Schematic of where each HUD style puts its panels (decorative) */
const HudThumb: React.FC<{ preset: HudPreset; active: boolean }> = ({ preset, active }) => {
  const fill = active ? "#CCFF00" : "#5B6275";
  return (
    <svg viewBox="0 0 64 36" className="h-auto w-full rounded-lg bg-[#141822]" aria-hidden>
      {preset === "broadcast" ? (
        <>
          <rect x="3" y="3" width="13" height="15" rx="2" fill={fill} />
          <rect x="50" y="3" width="11" height="9" rx="2" fill={fill} />
          <rect x="18" y="28" width="28" height="5" rx="2.5" fill={fill} />
        </>
      ) : preset === "dash" ? (
        <>
          <rect x="3" y="3" width="9" height="5" rx="2" fill={fill} />
          <rect x="51" y="3" width="10" height="8" rx="2" fill="none" stroke={fill} />
          <rect x="20" y="21" width="24" height="12" rx="4" fill={fill} />
        </>
      ) : preset === "telemetry" ? (
        <>
          <rect x="3" y="3" width="11" height="14" rx="2" fill={fill} />
          <rect x="50" y="3" width="11" height="14" rx="2" fill={fill} />
          <rect x="3" y="22" width="11" height="11" rx="2" fill={fill} />
          <rect x="50" y="20" width="11" height="13" rx="2" fill={fill} />
          <rect x="21" y="23" width="22" height="10" rx="3" fill={fill} />
        </>
      ) : preset === "classic" ? (
        <>
          <rect x="3" y="3" width="12" height="12" rx="2" fill={fill} />
          <rect x="49" y="3" width="12" height="10" rx="2" fill={fill} />
          <rect x="3" y="23" width="12" height="10" rx="2" fill={fill} />
          <rect x="47" y="21" width="14" height="12" rx="2" fill={fill} />
          <rect x="26" y="3" width="12" height="3" rx="1.5" fill={fill} />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="12" height="8" rx="2" fill={fill} />
          <rect x="47" y="23" width="14" height="10" rx="2" fill={fill} />
        </>
      )}
    </svg>
  );
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const MIRROR_CHOICES: { id: VirtualMirrorMode; title: string; detail: string }[] = [
  { id: "auto", title: "自动", detail: "车载视角中无可见后视镜时开启" },
  { id: "always", title: "始终", detail: "所有驾驶视角，包括车后追踪" },
  { id: "off", title: "关闭", detail: "仅翼子板后视镜" },
];

/** Labelled pill segmented row */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={FIELD_LABEL}>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-full border border-[#262B3D] bg-[#08090D] p-1">
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.id)}
              className={`min-h-[38px] min-w-0 flex-1 cursor-pointer rounded-full px-2 text-[13px] font-bold whitespace-nowrap transition-colors ${
                active ? "bg-[#CCFF00] text-[#08090D]" : "text-[#8E96AA] hover:text-[#F5F7FA]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Driver identity, HUD layout, graphics and touch / ghost options, saved to the player's settings */
export const DisplayPanel: React.FC<DisplayPanelProps> = ({
  settings,
  onChangeSettings,
  vrSupported,
  vrActive,
  onEnterVr,
  onRunGraphicsTest,
  graphicsTestRunning,
  graphicsTestDisabled,
}) => {
  // Live text while the name or code field is being edited; null shows the saved value
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState<string | null>(null);

  const { profile, hud, graphics, touch } = settings;
  const activePreset = HUD_PRESETS.find((p) => p.id === hud.preset);

  const setProfile = (patch: Partial<DriverProfile>) =>
    onChangeSettings((prev) => ({ ...prev, profile: { ...prev.profile, ...patch } }));
  const setHud = (patch: Partial<HudSettings>) => onChangeSettings((prev) => ({ ...prev, hud: { ...prev.hud, ...patch } }));
  const setGraphics = (patch: Partial<GraphicsSettings>) =>
    onChangeSettings((prev) => ({ ...prev, graphics: { ...prev.graphics, ...patch } }));
  const setTouch = (patch: Partial<TouchSettings>) =>
    onChangeSettings((prev) => ({ ...prev, touch: { ...prev.touch, ...patch } }));

  const commitName = () => {
    const name = sanitizeDriverName(nameDraft ?? profile.name);
    // A name the player typed is theirs: the first upload no longer asks for one
    setProfile(name === profile.name ? {} : { name, generated: false });
    setNameDraft(null);
  };
  const commitCode = () => {
    setProfile({ code: sanitizeDriverCode(codeDraft ?? profile.code) });
    setCodeDraft(null);
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-start gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        {/* DRIVER */}
        <div className={CARD}>
          <CardHeader label="车手" color="#CCFF00" />
          <div className="grid grid-cols-[1fr_96px] gap-2.5">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={FIELD_LABEL}>姓名</span>
              <input
                type="text"
                maxLength={16}
                value={nameDraft ?? profile.name}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                className={INPUT}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={FIELD_LABEL}>代号</span>
              <input
                type="text"
                maxLength={3}
                value={codeDraft ?? profile.code}
                onChange={(e) => setCodeDraft(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                onBlur={commitCode}
                className={`${INPUT} px-3 text-center font-f1-mono font-extrabold tracking-[0.14em] uppercase`}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>颜色</span>
            <div className="flex flex-wrap items-center gap-2">
              {DRIVER_COLORS.map((c) => {
                const active = profile.color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={`颜色 ${c}`}
                    aria-pressed={active}
                    onClick={() => setProfile({ color: sanitizeColor(c) })}
                    style={{ backgroundColor: c }}
                    className={`h-[30px] w-[30px] shrink-0 cursor-pointer rounded-full transition-transform hover:scale-110 ${
                      active ? "border-2 border-[#F5F7FA] shadow-[0_0_0_3px_#CCFF00]" : "border-0"
                    }`}
                  />
                );
              })}
              <label className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[#3A4157] py-0 pr-2.5 pl-1 text-[12px] font-bold text-[#8E96AA] hover:text-[#F5F7FA]">
                <input
                  type="color"
                  value={profile.color.toLowerCase()}
                  onChange={(e) => setProfile({ color: sanitizeColor(e.target.value) })}
                  className="h-[22px] w-[22px] cursor-pointer rounded-full border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                />
                自定义
              </label>
            </div>
          </div>
          <p className="m-0 text-[12px] leading-snug text-[#8E96AA]">会在联机和排行榜中向其他玩家展示。</p>
        </div>

        {/* HUD */}
        <div className={CARD}>
          <CardHeader label="HUD" color="#00E5FF" />
          <div role="radiogroup" aria-label="布局" className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {HUD_PRESETS.map((p) => {
              const active = hud.preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={p.detail}
                  onClick={() => setHud({ preset: p.id })}
                  className={`flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-[14px] px-1.5 pt-1.5 pb-2 text-left transition-[background-color,border-color] duration-200 ${
                    active
                      ? "border-[1.5px] border-[#CCFF00] bg-[#CCFF00]/[0.07]"
                      : "border border-[#262B3D] bg-transparent hover:border-[#3A4157] hover:bg-white/[0.03]"
                  }`}
                >
                  <HudThumb preset={p.id} active={active} />
                  <span className={`text-[12px] leading-tight font-bold ${active ? "text-[#F5F7FA]" : "text-[#C5CBD8]"}`}>
                    {p.title}
                  </span>
                </button>
              );
            })}
          </div>
          {activePreset ? (
            <p className="-mt-1 mb-0 text-[12px] leading-snug text-[#8E96AA]">
              {activePreset.title} · {activePreset.detail}
            </p>
          ) : null}

          <RangeRow
            label="HUD 尺寸"
            value={hud.scale}
            min={0.75}
            max={1.5}
            step={0.05}
            format={formatPercent}
            onChange={(scale) => setHud({ scale })}
          />

          <div className="-mt-1 flex flex-col">
            <Toggle
              label="输入轨迹"
              detail="滚动的油门、刹车和转向轨迹"
              checked={hud.inputTrace}
              onChange={() => setHud({ inputTrace: !hud.inputTrace })}
            />
            <Toggle
              label="差距条"
              detail="顶部实时差距条：快于最佳圈时为绿色，带趋势箭头"
              checked={hud.deltaBar}
              onChange={() => setHud({ deltaBar: !hud.deltaBar })}
            />
            <Toggle
              label="单圈总结卡"
              detail="每圈后的分段、弯道速度和理论最佳"
              checked={hud.lapSummary}
              onChange={() => setHud({ lapSummary: !hud.lapSummary })}
            />
          </div>
        </div>

        {/* WIDGETS & CUES */}
        <div className={CARD}>
          <CardHeader label="小部件与提示" color="#FFB300" />
          <div className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>后视镜</span>
            <div role="radiogroup" aria-label="后视镜" className="grid grid-cols-3 gap-1.5">
              {MIRROR_CHOICES.map((m) => (
                <OptionCard
                  key={m.id}
                  active={hud.virtualMirror === m.id}
                  title={m.title}
                  detail={m.detail}
                  onClick={() => setHud({ virtualMirror: m.id })}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-3 min-[420px]:grid-cols-2">
            <Segmented
              label="计时塔"
              value={hud.towerGaps}
              options={[
                { id: "interval", label: "间隔" },
                { id: "leader", label: "距领先者" },
              ]}
              onChange={(towerGaps) => setHud({ towerGaps })}
            />
            <Segmented
              label="赛道图"
              value={hud.mapMode}
              options={[
                { id: "full", label: "整圈" },
                { id: "local", label: "放大" },
              ]}
              onChange={(mapMode) => setHud({ mapMode })}
            />
          </div>
          <div className="-mt-1 flex flex-col">
            <Toggle
              label="接近雷达"
              detail="有车辆并排或在 25 m 内时淡入"
              checked={hud.radar}
              onChange={() => setHud({ radar: !hud.radar })}
            />
            <Toggle
              label="分段差距"
              detail="在赛道同一点测得的前后车时间差"
              checked={hud.splitGaps}
              onChange={() => setHud({ splitGaps: !hud.splitGaps })}
            />
            <Toggle
              label="自动收起 MFD"
              detail="最后一次方向键操作 3.5 s 后收起为状态胶囊"
              checked={hud.mfdAutoCollapse}
              onChange={() => setHud({ mfdAutoCollapse: !hud.mfdAutoCollapse })}
            />
            <Toggle
              label="DRS 提示音"
              detail="DRS 可用时两声提示，襟翼打开时一声提示音"
              checked={hud.drsBeep}
              onChange={() => setHud({ drsBeep: !hud.drsBeep })}
            />
            <Toggle
              label="换挡提示音"
              detail="转速限制前 150 rpm 短促提示音"
              checked={hud.shiftBeep}
              onChange={() => setHud({ shiftBeep: !hud.shiftBeep })}
            />
            <div className="pt-2">
              <Segmented
                label="驾驶舱头部动态"
                value={hud.headMovement}
                options={[
                  { id: "natural", label: "自然" },
                  { id: "static", label: "锁定" },
                ]}
                onChange={(headMovement) => setHud({ headMovement })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {/* GRAPHICS */}
        <div className={CARD}>
          <CardHeader label="画面" color="#FF8700" />
          <div role="radiogroup" aria-label="画质" className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-3">
            {QUALITY_CHOICES.map((q) => (
              <OptionCard
                key={q.id}
                tall
                active={graphics.quality === q.id}
                title={q.title}
                detail={q.detail}
                onClick={() => setGraphics({ quality: q.id })}
              />
            ))}
          </div>

          <RangeRow
            label="渲染分辨率"
            value={graphics.renderScale}
            min={0.5}
            max={1.5}
            step={0.05}
            format={formatPercent}
            hint="越低越流畅"
            onChange={(renderScale) => setGraphics({ renderScale })}
          />

          {onRunGraphicsTest ? (
            <div className="flex flex-col gap-2 border-t border-[#262B3D] pt-3">
              <button
                type="button"
                disabled={Boolean(graphicsTestRunning || graphicsTestDisabled)}
                onClick={onRunGraphicsTest}
                className="min-h-[44px] cursor-pointer rounded-full border border-[#CCFF00] bg-[#CCFF00]/[0.12] px-4 text-[14px] font-bold text-[#CCFF00] transition-colors hover:bg-[#CCFF00]/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {graphicsTestRunning ? "正在检测画质…" : "自动检测画质"}
              </button>
              {settings.graphicsTest ? (
                <span className="text-[12px] leading-snug text-[#8E96AA]">
                  上次检测结果：平均 {settings.graphicsTest.avgFps.toFixed(1)} 帧/秒，最卡的 1% 为{" "}
                  {settings.graphicsTest.p1Fps.toFixed(1)} 帧/秒，检测时定为
                  {settings.graphicsTest.quality === "low" ? "低" : settings.graphicsTest.quality === "medium" ? "中" : "高"}画质。
                  手动更改不会被自动检测覆盖，除非再次执行自动检测。
                </span>
              ) : (
                <span className="text-[12px] leading-snug text-[#8E96AA]">
                  执行自动检测将运行一段赛道并根据帧率推荐画质，约需 20 秒。检测仅可在主菜单中进行。
                </span>
              )}
              {graphicsTestDisabled && !graphicsTestRunning ? (
                <span className="text-[12px] text-[#8E96AA]">检测仅可在主菜单中进行。</span>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-[#262B3D] px-2 pt-3">
            <span className="w-[34px] shrink-0 text-[15px] font-bold">VR</span>
            {vrSupported ? (
              <button
                type="button"
                disabled={vrActive}
                onClick={onEnterVr}
                className="inline-flex min-h-[40px] cursor-pointer items-center rounded-full border border-[#CCFF00] bg-[#CCFF00]/[0.12] px-4 text-[13px] font-bold text-[#CCFF00] transition-colors hover:bg-[#CCFF00]/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {vrActive ? "VR 中" : "进入 VR（WebXR）"}
              </button>
            ) : (
              <span className="min-w-0 flex-1 text-[12px] leading-snug text-[#8E96AA]">
                未检测到 VR 头显（需要支持 WebXR 的浏览器，如 Quest Browser 或开启 SteamVR/OpenXR 的 Chrome）
              </span>
            )}
          </div>
        </div>

        {/* TOUCH & GHOST */}
        <div className={CARD}>
          <CardHeader label="触屏与幽灵车" color="#00D2BE" />
          <div className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>触屏控制</span>
            <div role="radiogroup" aria-label="触屏控制" className="grid grid-cols-3 gap-1.5">
              {TOUCH_CHOICES.map((t) => (
                <OptionCard
                  key={t.id}
                  active={touch.mode === t.id}
                  title={t.title}
                  detail={t.detail}
                  onClick={() => setTouch({ mode: t.id })}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col">
            <Toggle
              label="倾斜转向"
              detail="倾斜设备代替屏幕滑块转向"
              checked={touch.tiltSteer}
              onChange={() => setTouch({ tiltSteer: !touch.tiltSteer })}
            />
            <RangeRow
              label="倾斜范围"
              value={touch.tiltRangeDeg}
              min={10}
              max={60}
              step={1}
              format={(v) => `${v}°`}
              hint="满转角对应的倾斜角度"
              dim={!touch.tiltSteer}
              onChange={(tiltRangeDeg) => setTouch({ tiltRangeDeg })}
            />
          </div>

          <div className="border-t border-[#262B3D] pt-2">
            <Toggle
              label="与最佳圈幽灵车竞速"
              detail="你的个人最佳圈会在这条赛道上与你同场竞速"
              checked={settings.ghost}
              onChange={() => onChangeSettings((prev) => ({ ...prev, ghost: !prev.ghost }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
