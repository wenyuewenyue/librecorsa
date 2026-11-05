"use client";

import React, { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Crown, Minus, Pencil, Play, Plus, Share2 } from "lucide-react";
import {
  hasTurnServer,
  loadUserTurnServer,
  saveUserTurnServer,
  type CarClassRule,
  type CollisionMode,
  type LobbyPlayer,
  type LobbySettings,
  type LobbyState,
  type P2PConnectionStatus,
  type PeerNetStats,
} from "@/lib/sim/multiplayer-sync";
import { TRACKS } from "@/lib/track-registry";
import { Segmented } from "@/components/menu/menu-ui";

export interface MultiplayerPanelProps {
  p2pStatus?: P2PConnectionStatus;
  initialRoomCode?: string;
  onHostP2PRoom?: (customCode?: string) => string;
  onJoinP2PRoom?: (roomCode: string) => void;
  onCancelJoinP2PRoom?: () => void;
  onCreateManualOffer?: () => Promise<string>;
  onAcceptManualOffer?: (offerToken: string) => Promise<string>;
  onAcceptManualAnswer?: (answerToken: string) => Promise<boolean>;
  /** The shared lobby this player is in, or null when not in one */
  lobby?: LobbyState | null;
  localPeerId?: string;
  isHost?: boolean;
  peerStats?: PeerNetStats[];
  /** This player's identity (edited in the Display panel) */
  profile?: { name: string; code: string; color: string };
  currentTrackId?: string;
  currentVehicle?: string;
  vehicleLabel?: (id: string) => string;
  /** Vehicle ids allowed by a car-class rule */
  vehiclesForClass?: (rule: CarClassRule) => string[];
  raceRunning?: boolean;
  onHostLocal?: () => void;
  onSetLobbySettings?: (patch: Partial<LobbySettings>) => void;
  onSetReady?: (ready: boolean) => void;
  onStartRace?: () => void;
  onAbortRace?: () => void;
  onSwitchTrack?: (trackId: string) => void;
  onSwitchVehicle?: (vehicle: string) => void;
  onOpenProfile?: () => void;
}

const MIN_LAPS = 1;
const MAX_LAPS = 50;

const COLLISION_OPTIONS: { value: CollisionMode; label: string }[] = [
  { value: "on", label: "开启" },
  { value: "ghost_lap1", label: "第 1 圈幽灵化" },
  { value: "off", label: "关闭" },
];

const CLASS_OPTIONS: { value: CarClassRule; label: string }[] = [
  { value: "any", label: "任意" },
  { value: "f1", label: "仅 F1" },
  { value: "gt3", label: "仅 GT3" },
];

const trackName = (id: string) => TRACKS.find((t) => t.id === id)?.name ?? id;
const optionLabel = <T extends string>(options: { value: T; label: string }[], value: T) =>
  options.find((o) => o.value === value)?.label ?? value;

/** Ping chip tint: green under 80 ms, amber under 160 ms, else crimson */
const pingChip = (ms: number) =>
  ms < 80 ? "bg-[#00E676]/[0.12] text-[#00E676]" : ms < 160 ? "bg-[#FFB300]/[0.12] text-[#FFB300]" : "bg-[#FF2A3C]/[0.12] text-[#FF2A3C]";

/**
 * A card inside the panel. In the pause menu it is a frosted card over the dimmed scene; inside the title
 * menu's panel sheet (`.lc-title-frame`) it becomes the darker inset card of the Racing Line boards.
 */
const CARD =
  "rounded-[24px] border border-white/[0.07] bg-[#0D0F15]/[0.82] p-[18px] [.lc-title-frame_&]:rounded-[22px] [.lc-title-frame_&]:border-[#262B3D] [.lc-title-frame_&]:bg-[#08090D]/60";
const CHIP =
  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-f1-mono text-[10px] font-extrabold tracking-[0.06em] whitespace-nowrap";
const PILL =
  "inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-[14px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const PILL_VOLT = `${PILL} border-0 bg-[#CCFF00] text-[#08090D] hover:bg-[#d9ff33]`;
const PILL_DARK = `${PILL} border border-[#262B3D] bg-[#1B1F2B] text-[#F5F7FA] hover:border-[#3A4157] hover:bg-[#262B3D]`;
const PILL_CYAN = `${PILL} border-0 bg-[#00E5FF] px-5 text-[#08090D] hover:opacity-90`;
const stepButtonClass =
  "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[#262B3D] bg-[#1B1F2B] text-[#F5F7FA] transition-colors hover:border-[#CCFF00] disabled:cursor-not-allowed disabled:opacity-40";
const inputClass =
  "h-11 w-full min-w-0 rounded-[14px] border border-[#262B3D] bg-[#08090D] px-3.5 font-f1-mono text-[13px] text-[#F5F7FA] placeholder:text-[#8E96AA]/50 focus:border-[#CCFF00] focus:shadow-[0_0_0_4px_rgba(204,255,0,0.12)] focus:outline-none";

function ReadValue({ children }: { children: React.ReactNode }) {
  return <span className="text-[14px] leading-tight font-bold text-[#F5F7FA]">{children}</span>;
}

/** Host's choice of a lobby rule (a pill segmented control), or its value for everyone else */
function RuleRow<T extends string>({
  label,
  value,
  options,
  editable,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  editable: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="lc-lbl w-[74px] shrink-0 text-[9px]">{label}</span>
      {editable ? (
        <Segmented
          label={label}
          className="min-w-0 flex-1 [&_button]:min-h-9 [&_button]:px-2 [&_button]:text-[12px] [&_button]:whitespace-nowrap"
          options={options.map((o) => ({ id: o.value, label: o.label }))}
          value={value}
          onChange={onChange}
        />
      ) : (
        <ReadValue>{optionLabel(options, value)}</ReadValue>
      )}
    </div>
  );
}

function NetBadge({ stats }: { stats?: PeerNetStats }) {
  if (!stats) return null;
  return (
    <>
      {stats.relayed ? (
        <span
          title="数据经由房主中转"
          className={`${CHIP} uppercase shadow-[inset_0_0_0_1px_rgba(0,229,255,0.5)] text-[#00E5FF]`}
        >
          中转
        </span>
      ) : null}
      {stats.rttMs == null ? (
        <span className={`${CHIP} text-[#8E96AA] shadow-[inset_0_0_0_1px_#262B3D]`}>测量中…</span>
      ) : (
        <span className={`${CHIP} ${pingChip(stats.rttMs)}`}>
          {Math.round(stats.rttMs)} 毫秒 · 掉包 {Math.round(stats.lossPct)}%
        </span>
      )}
    </>
  );
}

/** Peer-to-peer multiplayer: room codes over a public WebRTC broker, or a manual SDP exchange */
export const MultiplayerPanel: React.FC<MultiplayerPanelProps> = ({
  p2pStatus,
  initialRoomCode = "",
  onHostP2PRoom,
  onJoinP2PRoom,
  onCancelJoinP2PRoom,
  onCreateManualOffer,
  onAcceptManualOffer,
  onAcceptManualAnswer,
  lobby,
  localPeerId,
  isHost = false,
  peerStats,
  profile,
  currentTrackId,
  currentVehicle,
  vehicleLabel,
  vehiclesForClass,
  raceRunning = false,
  onHostLocal,
  onSetLobbySettings,
  onSetReady,
  onStartRace,
  onAbortRace,
  onSwitchTrack,
  onSwitchVehicle,
  onOpenProfile,
}) => {
  // Connect box
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode);
  const [copiedLink, setCopiedLink] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // Manual connection (advanced)
  const [sdpInput, setSdpInput] = useState("");
  const [generatedToken, setGeneratedToken] = useState("");
  const [copiedToken, setCopiedToken] = useState(false);
  const [sdpBusy, setSdpBusy] = useState(false);

  // TURN relay (advanced)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [turnUrl, setTurnUrl] = useState("");
  const [turnUser, setTurnUser] = useState("");
  const [turnCred, setTurnCred] = useState("");
  const [turnConfigured, setTurnConfigured] = useState(false);
  const [turnError, setTurnError] = useState("");
  const [turnSaved, setTurnSaved] = useState(false);

  // Ready toggle: mirrors this player's lobby entry, and applies immediately when pressed
  const serverReady = lobby?.players.find((p) => p.peerId === localPeerId)?.ready ?? false;
  const [ready, setReadyLocal] = useState(serverReady);

  // Browser-only values are read after mount so server and client markup match
  useEffect(() => {
    const saved = loadUserTurnServer();
    if (saved) {
      setTurnUrl(Array.isArray(saved.urls) ? (saved.urls[0] ?? "") : saved.urls);
      setTurnUser(typeof saved.username === "string" ? saved.username : "");
      setTurnCred(typeof saved.credential === "string" ? saved.credential : "");
    }
    setTurnConfigured(hasTurnServer());
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    setReadyLocal(serverReady);
  }, [serverReady]);

  const runSdp = async (fn: () => Promise<void>) => {
    setSdpBusy(true);
    try {
      await fn();
    } finally {
      setSdpBusy(false);
    }
  };

  const activeCode = (p2pStatus?.roomCode || roomCodeInput.trim()).replace(/^(RWA|LC)-/i, "").toUpperCase();

  const getInviteUrl = (): string | null => {
    if (!activeCode || typeof window === "undefined") return null;
    return `${window.location.origin}${window.location.pathname}?room=LC-${activeCode}`;
  };

  const copyLink = () => {
    const url = getInviteUrl();
    if (!url) return;
    navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const shareInvite = async () => {
    const url = getInviteUrl();
    if (!url || typeof navigator === "undefined" || typeof navigator.share !== "function") return;
    try {
      await navigator.share({ title: "WY赛车比赛", text: "加入我的比赛", url });
    } catch {
      // Share sheet dismissed or unavailable
    }
  };

  const toggleReady = () => {
    const next = !ready;
    setReadyLocal(next);
    onSetReady?.(next);
  };

  const setLaps = (laps: number) => {
    onSetLobbySettings?.({ laps: Math.min(MAX_LAPS, Math.max(MIN_LAPS, laps)) });
  };

  const saveTurn = () => {
    const url = turnUrl.trim();
    if (!/^turns?:/i.test(url)) {
      setTurnError("地址必须以 turn: 或 turns: 开头");
      return;
    }
    setTurnError("");
    saveUserTurnServer({
      urls: url,
      username: turnUser.trim() || undefined,
      credential: turnCred || undefined,
    });
    setTurnConfigured(hasTurnServer());
    setTurnSaved(true);
    setTimeout(() => setTurnSaved(false), 1800);
  };

  const clearTurn = () => {
    saveUserTurnServer(null);
    setTurnUrl("");
    setTurnUser("");
    setTurnCred("");
    setTurnError("");
    setTurnConfigured(hasTurnServer());
  };

  const hostRoom = () => {
    const code = onHostP2PRoom?.(roomCodeInput || undefined);
    if (code) setRoomCodeInput(code);
  };

  const connected = p2pStatus?.connectedWebRtcPeers ?? 0;
  const hostedCode = p2pStatus?.roomCode;

  const renderLobby = (state: LobbyState) => {
    const settings = state.settings;
    const hostPlayer = state.players.find((p) => p.peerId === state.hostId);
    const isHostPlayer = (p: LobbyPlayer) => p.isHost || p.peerId === state.hostId;

    // Warnings for this player, compared with the host's race settings
    const trackMismatch = currentTrackId !== undefined && currentTrackId !== settings.trackId;
    const allowedVehicles = vehiclesForClass ? vehiclesForClass(settings.carClass) : null;
    const vehicleBlocked = !!allowedVehicles && !!currentVehicle && !allowedVehicles.includes(currentVehicle);

    return (
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="lc-title text-[18px] leading-tight text-[#F5F7FA]">
            大厅 · 房主 <span className="text-[#CCFF00]">{hostPlayer?.name ?? "—"}</span>
          </span>
          {isHost ? <span className={`${CHIP} bg-[#CCFF00]/[0.12] text-[#CCFF00] uppercase`}>你是房主</span> : null}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className={`${CARD} flex flex-col gap-2 !p-3 !rounded-[18px]`}>
            <span className="lc-lbl text-[9px]">圈数</span>
            {isHost ? (
              <div className="flex items-center justify-between gap-1.5">
                <button
                  type="button"
                  aria-label="减少圈数"
                  disabled={settings.laps <= MIN_LAPS}
                  onClick={() => setLaps(settings.laps - 1)}
                  className={stepButtonClass}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="lc-data min-w-8 text-center text-[24px] leading-none text-[#F5F7FA]">{settings.laps}</span>
                <button
                  type="button"
                  aria-label="增加圈数"
                  disabled={settings.laps >= MAX_LAPS}
                  onClick={() => setLaps(settings.laps + 1)}
                  className={stepButtonClass}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <span className="lc-data text-[24px] leading-none text-[#F5F7FA]">{settings.laps}</span>
            )}
          </div>

          <div className={`${CARD} flex flex-col gap-2 !p-3 !rounded-[18px]`}>
            <span className="lc-lbl text-[9px]">赛道</span>
            <ReadValue>{trackName(settings.trackId)}</ReadValue>
          </div>

          <RuleRow
            label="碰撞"
            value={settings.collisions}
            options={COLLISION_OPTIONS}
            editable={isHost}
            onChange={(collisions) => onSetLobbySettings?.({ collisions })}
          />
          <RuleRow
            label="车辆级别"
            value={settings.carClass}
            options={CLASS_OPTIONS}
            editable={isHost}
            onChange={(carClass) => onSetLobbySettings?.({ carClass })}
          />
        </div>

        <ul className="flex flex-col gap-1.5">
          {state.players.map((p) => {
            const isMe = p.peerId === localPeerId;
            const carName = p.vehicle ? (vehicleLabel?.(p.vehicle) ?? p.vehicle) : "—";
            return (
              <li
                key={p.peerId}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[16px] border border-[#262B3D] bg-[#11131A] px-3 py-2.5"
              >
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                <div className="flex min-w-0 flex-[1_1_90px] flex-col">
                  <span className="flex min-w-0 items-center gap-2 text-[14px] font-bold text-[#F5F7FA]">
                    <span className="font-f1-mono text-[12px] font-extrabold tracking-[0.1em]">{p.code}</span>
                    <span className="truncate">
                      {p.name}
                      {isMe ? <span className="font-normal text-[#8E96AA]">（你）</span> : null}
                    </span>
                  </span>
                  <span className="truncate text-[12px] text-[#8E96AA]">{carName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {isHostPlayer(p) ? (
                    <span className={`${CHIP} bg-[#CCFF00]/[0.12] text-[#CCFF00] uppercase`}>
                      <Crown className="h-3 w-3" strokeWidth={2.4} />
                      房主
                    </span>
                  ) : null}
                  {!isMe ? <NetBadge stats={peerStats?.find((s) => s.peerId === p.peerId)} /> : null}
                  <span
                    className={`${CHIP} uppercase ${
                      p.ready ? "bg-[#00E676]/[0.12] text-[#00E676]" : "text-[#8E96AA] shadow-[inset_0_0_0_1px_#262B3D]"
                    }`}
                  >
                    {p.ready ? "已准备" : "未准备"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {trackMismatch || vehicleBlocked ? (
          <div className="flex flex-col gap-2">
            {trackMismatch ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[16px] border border-[#FFB300]/40 bg-[#FFB300]/[0.08] px-3.5 py-2.5">
                <span className="text-[13px] font-semibold text-[#FFB300]">房主在 {trackName(settings.trackId)}</span>
                {onSwitchTrack ? (
                  <button
                    type="button"
                    onClick={() => onSwitchTrack(settings.trackId)}
                    className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#FFB300]/60 bg-[#FFB300]/15 px-3.5 text-[13px] font-bold text-[#FFB300] hover:bg-[#FFB300]/25"
                  >
                    切换赛道
                  </button>
                ) : null}
              </div>
            ) : null}
            {vehicleBlocked && allowedVehicles ? (
              <div className="flex flex-col gap-2 rounded-[16px] border border-[#FFB300]/40 bg-[#FFB300]/[0.08] px-3.5 py-2.5">
                <span className="text-[13px] font-semibold text-[#FFB300]">
                  你的车辆不允许参加 {optionLabel(CLASS_OPTIONS, settings.carClass)} 比赛。请选择：
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {allowedVehicles.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSwitchVehicle?.(id)}
                      disabled={!onSwitchVehicle}
                      className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#FFB300]/60 bg-[#FFB300]/15 px-3.5 text-[13px] font-bold text-[#FFB300] hover:bg-[#FFB300]/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {vehicleLabel?.(id) ?? id}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {isHost ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={raceRunning}
              onClick={() => onStartRace?.()}
              className="inline-flex h-14 cursor-pointer items-center justify-center gap-3 rounded-full border-0 bg-[#CCFF00] text-[#08090D] shadow-[0_0_0_5px_rgba(204,255,0,0.12),0_14px_34px_rgba(204,255,0,0.2)] transition-colors hover:bg-[#d9ff33] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <Play aria-hidden className="h-[18px] w-[18px]" fill="currentColor" strokeWidth={0} />
              <span className="lc-disp text-[22px]">{raceRunning ? "比赛进行中" : "开始比赛"}</span>
            </button>
            {raceRunning && onAbortRace ? (
              <button
                type="button"
                onClick={() => onAbortRace()}
                className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-full border border-[#FF2A3C]/60 bg-[#FF2A3C]/[0.12] px-4 text-[14px] font-bold text-[#FF2A3C] hover:bg-[#FF2A3C]/25"
              >
                为所有人结束比赛
              </button>
            ) : null}
            {!raceRunning ? (
              <span className="text-center text-[12px] text-[#8E96AA]">未准备的玩家仍会一同开始。</span>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-pressed={ready}
              disabled={!onSetReady}
              onClick={toggleReady}
              className={`inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2.5 rounded-full border-0 text-[#08090D] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                ready
                  ? "bg-[#00E676] shadow-[0_0_0_5px_rgba(0,230,118,0.12)] hover:bg-[#2BEB8A]"
                  : "bg-[#CCFF00] shadow-[0_0_0_5px_rgba(204,255,0,0.12),0_14px_34px_rgba(204,255,0,0.2)] hover:bg-[#d9ff33]"
              }`}
            >
              {ready ? <Check aria-hidden className="h-5 w-5" strokeWidth={3} /> : null}
              <span className="lc-disp text-[22px]">{ready ? "已准备" : "准备"}</span>
            </button>
            <span className="text-center text-[12px] text-[#8E96AA]">
              {raceRunning ? "比赛进行中。" : "轻触切换。由房主开始比赛。"}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`grid items-start gap-[22px] text-[#F5F7FA] ${
        lobby ? "grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))]" : "max-w-xl grid-cols-1"
      }`}
    >
      {/* Room */}
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className={`${CARD} flex flex-col gap-3.5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="lc-lbl">房间代码</span>
            <span
              className={`${CHIP} h-[26px] text-[11px] uppercase ${
                p2pStatus?.state === "connected"
                  ? "bg-[#00E676]/[0.12] text-[#00E676]"
                  : p2pStatus?.state === "signaling"
                    ? "bg-[#FFB300]/[0.12] text-[#FFB300]"
                    : "text-[#8E96AA] shadow-[inset_0_0_0_1px_#262B3D]"
              }`}
            >
              <span className="relative inline-flex h-[7px] w-[7px]">
                {p2pStatus?.state === "connected" ? (
                  <span className="lc-ping absolute inset-0 rounded-full bg-current" />
                ) : null}
                <span className="relative h-[7px] w-[7px] rounded-full bg-current" />
              </span>
              {connected} 人已连接
            </span>
          </div>
          {hostedCode ? (
            <div
              className="font-f1-mono text-[40px] leading-none font-extrabold tracking-[0.14em] break-all text-[#CCFF00] tabular-nums sm:text-[46px]"
              aria-label={`房间代码 ${hostedCode}`}
            >
              {hostedCode}
            </div>
          ) : (
            <p className="m-0 text-[14px] leading-snug text-[#8E96AA]">
              暂无房间。创建一个房间，或输入朋友的代码加入。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!activeCode} onClick={copyLink} className={`flex-1 ${hostedCode ? PILL_VOLT : PILL_DARK}`}>
              {copiedLink ? <Check aria-hidden className="h-4 w-4" strokeWidth={2.4} /> : <Copy aria-hidden className="h-4 w-4" strokeWidth={2.2} />}
              {copiedLink ? "链接已复制" : "复制链接"}
            </button>
            {canShare ? (
              <button type="button" disabled={!activeCode} onClick={() => void shareInvite()} className={`flex-1 ${PILL_DARK}`}>
                <Share2 aria-hidden className="h-4 w-4" strokeWidth={2.2} />
                分享…
              </button>
            ) : null}
          </div>
          <div className="h-px bg-[#262B3D]" />
          <div className="flex flex-col gap-2">
            <span className="lc-lbl text-[10px]">{hostedCode ? "加入另一个房间" : "创建或加入房间"}</span>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                maxLength={6}
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                placeholder="代码"
                aria-label="房间代码"
                className="h-11 min-w-[7rem] flex-1 rounded-full border border-[#262B3D] bg-[#08090D] px-4 font-f1-mono text-[15px] font-extrabold tracking-[0.3em] text-[#F5F7FA] uppercase placeholder:text-[#8E96AA]/50 focus:border-[#CCFF00] focus:shadow-[0_0_0_4px_rgba(204,255,0,0.12)] focus:outline-none"
              />
              <button
                type="button"
                disabled={roomCodeInput.trim().length < 3}
                onClick={() => {
                  if (roomCodeInput.trim().length >= 3) onJoinP2PRoom?.(roomCodeInput.trim());
                }}
                className={PILL_CYAN}
              >
                加入
              </button>
              {p2pStatus?.mode === "room_guest" && p2pStatus?.state === "signaling" ? (
                <button type="button" onClick={() => onCancelJoinP2PRoom?.()} className={PILL_DARK}>
                  取消
                </button>
              ) : null}
              <button type="button" onClick={hostRoom} className={hostedCode ? PILL_DARK : PILL_VOLT}>
                创建
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={!onHostLocal}
            onClick={() => onHostLocal?.()}
            className="self-start cursor-pointer text-left text-[13px] font-semibold text-[#00E5FF] hover:text-[#CCFF00] hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
          >
            用这些标签页对战（同一浏览器）
          </button>
        </div>

        {profile ? (
          <div className="flex min-w-0 items-center gap-2.5 rounded-full border border-[#262B3D] bg-[#08090D]/60 py-1.5 pr-3 pl-3.5">
            <span className="lc-lbl text-[9px]">你</span>
            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
            <span className="font-f1-mono text-[12px] font-extrabold tracking-[0.1em]">{profile.code}</span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{profile.name}</span>
            {onOpenProfile ? (
              <button
                type="button"
                onClick={onOpenProfile}
                className="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 px-1 text-[13px] font-bold text-[#00E5FF] hover:text-[#CCFF00]"
              >
                <Pencil aria-hidden className="h-3.5 w-3.5" strokeWidth={2.2} />
                编辑
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className={`border border-[#262B3D] transition-[border-radius] ${
            advancedOpen ? "rounded-[22px] bg-[#08090D]/60" : "rounded-[22px] bg-transparent"
          }`}
        >
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 rounded-[22px] px-4 py-2 text-left hover:bg-white/[0.04]"
          >
            <span className="lc-title text-[14px] text-[#8E96AA]">高级 · 手动连接与 TURN 中转</span>
            <span className="flex shrink-0 items-center gap-2">
              {turnConfigured ? <span className={`${CHIP} bg-[#00E5FF]/[0.12] text-[#00E5FF] uppercase`}>TURN 中转</span> : null}
              <ChevronDown
                aria-hidden
                className={`h-4 w-4 text-[#8E96AA] transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                strokeWidth={2.2}
              />
            </span>
          </button>

          {advancedOpen ? (
            <div className="flex flex-col gap-4 border-t border-[#262B3D] p-4">
              <div className="flex flex-col gap-2.5">
                <span className="lc-title text-[14px] text-[#FFB300]">手动连接（无中介服务器）</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={sdpBusy}
                    onClick={() =>
                      runSdp(async () => {
                        const offer = await onCreateManualOffer?.();
                        if (offer) setGeneratedToken(offer);
                      })
                    }
                    className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#00E5FF]/50 bg-[#00E5FF]/[0.12] px-3.5 text-[12px] font-bold text-[#00E5FF] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    1 · 创建提议（房主）
                  </button>
                  <button
                    type="button"
                    disabled={sdpBusy || !sdpInput.trim()}
                    onClick={() =>
                      runSdp(async () => {
                        const ans = await onAcceptManualOffer?.(sdpInput.trim());
                        if (ans) setGeneratedToken(ans);
                      })
                    }
                    className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#FFB300]/50 bg-[#FFB300]/[0.12] px-3.5 text-[12px] font-bold text-[#FFB300] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    2 · 粘贴提议，获取应答
                  </button>
                  <button
                    type="button"
                    disabled={sdpBusy || !sdpInput.trim()}
                    onClick={() =>
                      runSdp(async () => {
                        await onAcceptManualAnswer?.(sdpInput.trim());
                      })
                    }
                    className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#00E676]/50 bg-[#00E676]/[0.12] px-3.5 text-[12px] font-bold text-[#00E676] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    3 · 接受应答（房主）
                  </button>
                </div>
                <input
                  type="text"
                  value={sdpInput}
                  onChange={(e) => setSdpInput(e.target.value)}
                  placeholder="在此粘贴对方玩家的令牌"
                  aria-label="连接令牌"
                  className={inputClass}
                />
                {generatedToken ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedToken}
                      aria-label="生成的令牌"
                      className={`${inputClass} flex-1 !border-[#00E676]/50 text-[#00E676]`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(generatedToken).catch(() => undefined);
                        setCopiedToken(true);
                        setTimeout(() => setCopiedToken(false), 1800);
                      }}
                      className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[#00E676] px-4 text-[13px] font-bold text-[#08090D]"
                    >
                      {copiedToken ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
                      {copiedToken ? "已复制" : "复制"}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-2.5 border-t border-[#262B3D] pt-4">
                <span className="lc-title text-[14px] text-[#00E5FF]">TURN 中转</span>
                <p className="m-0 text-[12px] leading-snug text-[#8E96AA]">
                  玩家处于严格 NAT 或使用移动数据时需要。免费 TURN：Cloudflare Calls、Metered.ca。仅对新连接生效。
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={turnUrl}
                    onChange={(e) => setTurnUrl(e.target.value)}
                    placeholder="turn:host:3478"
                    aria-label="TURN 地址"
                    autoComplete="off"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={turnUser}
                    onChange={(e) => setTurnUser(e.target.value)}
                    placeholder="用户名"
                    aria-label="TURN 用户名"
                    autoComplete="off"
                    className={inputClass}
                  />
                  <input
                    type="password"
                    value={turnCred}
                    onChange={(e) => setTurnCred(e.target.value)}
                    placeholder="凭证"
                    aria-label="TURN 凭证"
                    autoComplete="new-password"
                    className={inputClass}
                  />
                </div>
                {turnError ? <p className="m-0 text-[12px] font-semibold text-[#FF2A3C]">{turnError}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={!turnUrl.trim()} onClick={saveTurn} className={`${PILL_CYAN} min-h-9 text-[13px]`}>
                    {turnSaved ? "已保存" : "保存"}
                  </button>
                  <button type="button" onClick={clearTurn} className={`${PILL_DARK} min-h-9 text-[13px] hover:!border-[#FF2A3C]`}>
                    清除
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <p className="m-0 font-f1-mono text-[11px] leading-normal text-[#8E96AA]/80">
          {p2pStatus?.statusText ?? "同一浏览器的标签页会自动连接。其他设备请使用房间代码。"}
          {p2pStatus?.state === "signaling" && p2pStatus?.iceState
            ? {
                checking: " · 直连：检查中",
                connected: " · 直连：已连接",
                completed: " · 直连：已连接",
                failed: " · 直连：已失败",
                disconnected: " · 直连：已断开",
                new: "",
                closed: "",
              }[p2pStatus.iceState] ?? ""
            : ""}
        </p>
      </div>

      {lobby ? renderLobby(lobby) : null}
    </div>
  );
};
