"use client";

import React, { useMemo, useRef, useState } from "react";
import { Download, RotateCw } from "lucide-react";
import type { LeaderboardEntry } from "@/lib/sim/lap-types";
import { sanitizeDriverCode, sanitizeDriverName } from "@/lib/settings/player-settings";
import { formatLapTime } from "./hud-format";

/**
 * A card of the panel: a frosted card in the pause menu, the darker inset card inside the title menu's
 * panel sheet (`.lc-title-frame`)
 */
const CARD =
  "flex min-w-0 flex-col gap-2.5 rounded-[24px] border border-white/[0.07] bg-[#0D0F15]/[0.82] p-[18px] text-[#F5F7FA] [.lc-title-frame_&]:rounded-[22px] [.lc-title-frame_&]:border-[#262B3D] [.lc-title-frame_&]:bg-[#08090D]/60";
/** Toolbar pill */
const BUTTON =
  "inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-full border border-[#262B3D] bg-[#08090D]/60 px-3.5 text-[13px] font-bold text-[#C5CBD8] transition-colors hover:border-[#CCFF00] hover:text-[#CCFF00] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#262B3D] disabled:hover:text-[#C5CBD8]";
/** Small in-row pill (race ghost, driver key) */
const SMALL_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[#262B3D] bg-transparent px-2.5 text-[12px] font-bold whitespace-nowrap text-[#C5CBD8] transition-colors hover:border-[#CCFF00] hover:text-[#CCFF00]";
/** Text input, identical to the settings screen's driver fields (height, radius, focus glow included) */
const INPUT =
  "h-11 w-full min-w-0 rounded-[14px] border border-[#262B3D] bg-[#08090D] px-3.5 text-[15px] font-semibold text-[#F5F7FA] outline-none focus:border-[#CCFF00] focus:shadow-[0_0_0_4px_rgba(204,255,0,0.12)]";
const FIELD_LABEL = "lc-lbl text-[9px]";

const CardHeader: React.FC<{ label: string; color: string; children?: React.ReactNode }> = ({ label, color, children }) => (
  <div className="flex items-center gap-2">
    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
    <span className="lc-lbl">{label}</span>
    {children}
  </div>
);

/** One ranked lap: position, code, name over car and date, lap time and an optional ghost race button */
const LeaderRow: React.FC<{
  index: number;
  entry: LeaderboardEntry;
  vehicleLabel: (id: string) => string;
  onRaceGhost?: (entry: LeaderboardEntry) => void;
  onDelete?: (entry: LeaderboardEntry) => void;
  deleteLabel?: string;
  deleteDisabled?: boolean;
  highlight?: boolean;
}> = ({ index, entry, vehicleLabel, onRaceGhost, onDelete, deleteLabel, deleteDisabled, highlight }) => (
  <li
    className={`grid min-h-[52px] items-center gap-x-2.5 rounded-[14px] px-3 py-1.5 transition-colors ${
      onRaceGhost && onDelete
        ? "grid-cols-[22px_40px_minmax(0,1fr)_auto] sm:grid-cols-[26px_44px_minmax(0,1fr)_auto_auto_auto]"
        : onRaceGhost || onDelete
          ? "grid-cols-[22px_40px_minmax(0,1fr)_auto] sm:grid-cols-[26px_44px_minmax(0,1fr)_auto_auto]"
          : "grid-cols-[22px_40px_minmax(0,1fr)_auto] sm:grid-cols-[26px_44px_minmax(0,1fr)_auto]"
    } ${highlight ? "bg-[#CCFF00]/[0.06]" : "hover:bg-white/[0.04]"}`}
  >
    <span className={`lc-data text-[16px] ${index === 0 ? "text-[#CCFF00]" : "text-[#8E96AA]"}`}>{index + 1}</span>
    <span className="font-f1-mono text-[12px] font-extrabold tracking-[0.1em] text-[#F5F7FA]">{entry.code}</span>
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[14px] font-bold text-[#F5F7FA] uppercase">{entry.name}</span>
      <span className="truncate text-[12px] text-[#8E96AA]" title={new Date(entry.recordedAt).toLocaleString()}>
        {vehicleLabel(entry.vehicle)} · {new Date(entry.recordedAt).toLocaleDateString()}
      </span>
    </span>
    <span className="lc-data text-[18px] text-[#F5F7FA]">{formatLapTime(entry.lapTimeMs)}</span>
    {onRaceGhost ? (
      <button
        type="button"
        onClick={() => onRaceGhost(entry)}
        className={`${SMALL_BUTTON} h-[30px] col-span-full mt-1 justify-self-end sm:col-span-1 sm:mt-0`}
      >
        与幽灵车竞速
      </button>
    ) : null}
    {onDelete ? (
      <button
        type="button"
        onClick={() => onDelete(entry)}
        disabled={deleteDisabled}
        className={`${SMALL_BUTTON} h-[30px] col-span-full mt-1 justify-self-end sm:col-span-1 sm:mt-0`}
      >
        {deleteLabel ?? "删除"}
      </button>
    ) : null}
  </li>
);

export interface LeaderboardPanelProps {
  trackName: string;
  vehicleLabel: (id: string) => string;
  local: LeaderboardEntry[];
  remote: LeaderboardEntry[];
  remoteEnabled: boolean;
  loading: boolean;
  onRefresh: () => void;
  onRaceGhost?: (entry: LeaderboardEntry) => void;
  onImportGhost?: (file: File) => void;
  onExportBest?: () => void;
  /** Uploads the saved local best for this track and car to the online board */
  onUploadBest?: () => void;
  uploadState?: "idle" | "sending" | "sent" | "error";
  uploadRank?: number | null;
  uploadError?: string | null;
  /** Driver key (claims the name on the online board): export to a file, import from one, and the last result */
  onExportDriverKey?: () => void;
  onImportDriverKey?: (file: File) => void;
  driverKeyNotice?: string | null;
  /** Current driver identity, and a patch for it (same saved profile the settings screen edits) */
  profileName?: string;
  profileCode?: string;
  onChangeProfile?: (patch: { name?: string; code?: string }) => void;
  /** Deletes one online row (shown only for rows under the current driver name) */
  onDeleteRemote?: (entry: LeaderboardEntry) => void;
  deletingId?: string | null;
  deleteError?: string | null;
}

/** Personal bests and online times for one track, with refresh, ghost import / export and ghost racing */
export const LeaderboardPanel: React.FC<LeaderboardPanelProps> = ({
  trackName,
  vehicleLabel,
  local,
  remote,
  remoteEnabled,
  loading,
  onRefresh,
  onRaceGhost,
  onImportGhost,
  onExportBest,
  onUploadBest,
  uploadState = "idle",
  uploadRank = null,
  uploadError = null,
  onExportDriverKey,
  onImportDriverKey,
  driverKeyNotice = null,
  profileName,
  profileCode,
  onChangeProfile,
  onDeleteRemote,
  deletingId = null,
  deleteError = null,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const keyFileRef = useRef<HTMLInputElement | null>(null);

  // Two-step delete: first tap arms the row's delete button, second tap deletes it
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const handleDeleteClick = (entry: LeaderboardEntry) => {
    if (!entry.id || !onDeleteRemote) return;
    if (pendingDeleteId !== entry.id) {
      setPendingDeleteId(entry.id);
      return;
    }
    setPendingDeleteId(null);
    onDeleteRemote(entry);
  };

  // Live text while the name or code field is being edited; null shows the saved value
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const commitName = () => {
    if (profileName === undefined || !onChangeProfile) return;
    const name = sanitizeDriverName(nameDraft ?? profileName);
    if (name !== profileName) onChangeProfile({ name });
    setNameDraft(null);
  };
  const commitCode = () => {
    if (profileCode === undefined || !onChangeProfile) return;
    const code = sanitizeDriverCode(codeDraft ?? profileCode);
    if (code !== profileCode) onChangeProfile({ code });
    setCodeDraft(null);
  };

  // Fastest first, whatever order the caller passed
  const localSorted = useMemo(() => [...local].sort((a, b) => a.lapTimeMs - b.lapTimeMs), [local]);
  const remoteSorted = useMemo(() => [...remote].sort((a, b) => a.lapTimeMs - b.lapTimeMs), [remote]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear so picking the same file again still fires onChange
    e.target.value = "";
    if (file && onImportGhost) onImportGhost(file);
  };
  const handleKeyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file && onImportDriverKey) onImportDriverKey(file);
  };

  return (
    <div className="flex flex-col gap-4 text-[#F5F7FA]">
      {/* Toolbar (the title menu's sheet already shows the leaderboard heading) */}
      <div className="flex flex-wrap items-end justify-between gap-3 [.lc-title-frame_&]:justify-end">
        <div className="flex min-w-0 flex-col gap-1.5 [.lc-title-frame_&]:hidden">
          <span className="lc-lbl text-[#CCFF00]">排行榜</span>
          <span className="lc-title text-[24px] leading-none">{trackName}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRefresh} disabled={loading} className={BUTTON}>
            <RotateCw aria-hidden className={`h-[15px] w-[15px] ${loading ? "animate-spin" : ""}`} strokeWidth={2.2} />
            {loading ? "刷新中…" : "刷新"}
          </button>
          {onImportGhost ? (
            <>
              <button type="button" onClick={() => fileRef.current?.click()} className={BUTTON}>
                导入幽灵车文件…
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />
            </>
          ) : null}
          {onExportBest ? (
            <button type="button" onClick={onExportBest} className={BUTTON}>
              <Download aria-hidden className="h-[15px] w-[15px]" strokeWidth={2.2} />
              导出我的最佳
            </button>
          ) : null}
        </div>
      </div>

      {/* Driver identity, edited here instead of in the settings screen */}
      {profileName !== undefined && profileCode !== undefined && onChangeProfile ? (
        <section className={CARD} aria-label="车手">
          <CardHeader label="车手" color="#CCFF00" />
          <div className="grid grid-cols-[1fr_96px] gap-2.5">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={FIELD_LABEL}>姓名</span>
              <input
                type="text"
                maxLength={16}
                value={nameDraft ?? profileName}
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
                value={codeDraft ?? profileCode}
                onChange={(e) => setCodeDraft(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                onBlur={commitCode}
                className={`${INPUT} px-3 text-center font-f1-mono font-extrabold tracking-[0.14em] uppercase`}
              />
            </label>
          </div>
          <p className="m-0 text-[12px] leading-relaxed text-[#8E96AA]">
            改名后上传的成绩显示新名字；已上传的成绩仍保留旧名字。
          </p>
        </section>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-4 [.lc-title-frame_&]:gap-5">
        {/* Local personal bests */}
        <section className={CARD} aria-label="你的个人最佳">
          <CardHeader label="你的个人最佳" color="#CCFF00" />
          {localSorted.length === 0 ? (
            <p className="m-0 px-1 py-2 text-[13px] text-[#8E96AA]">这条赛道上尚未记录圈速。</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
              {localSorted.map((e, i) => (
                <LeaderRow key={`${e.recordedAt}-${i}`} index={i} entry={e} vehicleLabel={vehicleLabel} highlight={i === 0} />
              ))}
            </ol>
          )}
          {remoteEnabled && onUploadBest && localSorted.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-[#262B3D] pt-3.5">
              <button
                type="button"
                onClick={onUploadBest}
                disabled={uploadState === "sending" || uploadState === "sent"}
                className={`${SMALL_BUTTON} h-9 border-[#CCFF00] text-[#CCFF00] disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {uploadState === "sending" ? "上传中…" : uploadState === "sent" ? (uploadRank != null ? `已上传 · P${uploadRank}` : "已上传") : uploadState === "error" ? "上传失败 — 重试" : "上传我的最佳"}
              </button>
              {uploadState === "error" && uploadError ? <span className="text-[12px] text-[#FF2A3C]">{uploadError}</span> : null}
              {uploadState === "sent" ? <span className="text-[12px] text-[#8E96AA]">已上传到在线榜，点刷新可查看。</span> : null}
            </div>
          ) : null}
        </section>

        {/* Online times */}
        <section className={CARD} aria-label="在线">
          <CardHeader label="在线" color="#00E5FF">
            {loading && remoteEnabled ? (
              <span className="lc-breathe ml-auto font-f1-mono text-[10px] font-extrabold tracking-[0.12em] text-[#00E5FF]">
                加载中…
              </span>
            ) : null}
          </CardHeader>
          {!remoteEnabled ? (
            <p className="m-0 px-1 py-2 text-[13px] text-[#8E96AA]">
              此版本暂无在线成绩。你的个人最佳圈列在上方。
            </p>
          ) : loading && remoteSorted.length === 0 ? (
            <p className="m-0 px-1 py-2 text-[13px] text-[#8E96AA]">正在加载在线成绩…</p>
          ) : remoteSorted.length === 0 ? (
            <p className="m-0 px-1 py-2 text-[13px] text-[#8E96AA]">这条赛道暂无在线成绩。</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
              {remoteSorted.map((e, i) => {
                const isOwn = profileName !== undefined && profileCode !== undefined && e.name === profileName && e.code === profileCode;
                return (
                  <LeaderRow
                    key={e.id ?? `${e.code}-${e.recordedAt}-${i}`}
                    index={i}
                    entry={e}
                    vehicleLabel={vehicleLabel}
                    onRaceGhost={onRaceGhost}
                    onDelete={isOwn && e.id && onDeleteRemote ? handleDeleteClick : undefined}
                    deleteLabel={deletingId === e.id ? "删除中…" : pendingDeleteId === e.id ? "确认删除？" : "删除"}
                    deleteDisabled={deletingId === e.id}
                  />
                );
              })}
            </ol>
          )}
          {deleteError ? <p className="m-0 px-1 text-[12px] text-[#FF2A3C]">{deleteError}</p> : null}
          {remoteEnabled && (onExportDriverKey || onImportDriverKey) ? (
            <div className="mt-1.5 flex flex-col gap-2.5 border-t border-[#262B3D] pt-3.5">
              <p className="m-0 text-[12px] leading-relaxed text-[#8E96AA]">
                <span className="font-f1-mono font-extrabold tracking-[0.1em] text-[#F5F7FA]">车手密钥</span> · 首次上传即会认领你的名字，此浏览器会保存对应的密钥。导出密钥后，可在其他浏览器或设备上以同一名字竞速，并请妥善保管该文件。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {onExportDriverKey ? (
                  <button type="button" onClick={onExportDriverKey} className={`${SMALL_BUTTON} h-9`}>
                    导出密钥
                  </button>
                ) : null}
                {onImportDriverKey ? (
                  <>
                    <button type="button" onClick={() => keyFileRef.current?.click()} className={`${SMALL_BUTTON} h-9`}>
                      导入密钥…
                    </button>
                    <input
                      ref={keyFileRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={handleKeyFile}
                    />
                  </>
                ) : null}
                {driverKeyNotice ? <span className="text-[12px] text-[#F5F7FA]">{driverKeyNotice}</span> : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};
