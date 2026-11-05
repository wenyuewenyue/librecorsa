"use client";

import React from "react";
import type { GraphicsTestResult } from "@/lib/settings/player-settings";
import { GRAPHICS_QUALITY_LABEL } from "@/lib/graphics-benchmark";

export type BenchmarkStage = "prompt" | "running" | "result" | "failed";

export interface BenchmarkUiState {
  stage: BenchmarkStage;
  /** Running stage label, e.g. 热身中 / 正式测试中 / 确认中 */
  runningLabel: string;
  progress: number;
  result: GraphicsTestResult | null;
  message: string | null;
}

interface Props {
  state: BenchmarkUiState | null;
  onStart: () => void;
  onSkip: () => void;
  onCancel: () => void;
  onCloseResult: () => void;
}

export const GraphicsBenchmarkOverlay: React.FC<Props> = ({ state, onStart, onSkip, onCancel, onCloseResult }) => {
  if (!state) return null;
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-[#08090D]/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-[520px] rounded-[24px] border border-[#262B3D] bg-[#0D0F15] p-6 text-[#F5F7FA] shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
        {state.stage === "prompt" ? (
          <>
            <h2 className="text-[20px] font-extrabold">自动检测画质</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#C5CBD8]">
              首次启动可执行画质检测。检测将自动运行一段赛道，并根据帧率推荐画质。检测约需 20 秒，期间使用自动驾驶，不记录成绩，不更改车辆、赛道与天气设置。
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[#8E96AA]">
              检测结果可在设置中手动更改；手动更改后，除非再次执行自动检测，否则不会被覆盖。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={onStart}
                className="min-h-[44px] flex-1 cursor-pointer rounded-full bg-[#CCFF00] px-4 text-[15px] font-extrabold text-[#08090D]"
              >
                开始检测
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="min-h-[44px] flex-1 cursor-pointer rounded-full border border-[#262B3D] bg-[#11131A] px-4 text-[15px] font-bold text-[#F5F7FA]"
              >
                跳过
              </button>
            </div>
          </>
        ) : state.stage === "running" ? (
          <>
            <h2 className="text-[20px] font-extrabold">正在检测画质</h2>
            <p className="mt-3 text-[15px] text-[#C5CBD8]">{state.runningLabel}</p>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[#262B3D]">
              <div className="h-full bg-[#CCFF00] transition-[width] duration-300" style={{ width: `${Math.round(state.progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-[#8E96AA]">检测期间切换窗口或操作输入设备可能影响帧率统计。</p>
            <button
              type="button"
              onClick={onCancel}
              className="mt-5 min-h-[44px] w-full cursor-pointer rounded-full border border-[#262B3D] bg-[#11131A] px-4 text-[15px] font-bold text-[#F5F7FA]"
            >
              取消检测
            </button>
          </>
        ) : state.stage === "result" && state.result ? (
          <>
            <h2 className="text-[20px] font-extrabold">检测完成</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#C5CBD8]">
              平均帧率 {state.result.avgFps.toFixed(1)} 帧/秒，最低 1% 帧率 {state.result.p1Fps.toFixed(1)} 帧/秒。
              已应用{GRAPHICS_QUALITY_LABEL[state.result.quality]}画质，渲染分辨率 {Math.round(state.result.renderScale * 100)}%。
            </p>
            {state.message ? <p className="mt-2 text-[13px] text-[#8E96AA]">{state.message}</p> : null}
            <button
              type="button"
              onClick={onCloseResult}
              className="mt-5 min-h-[44px] w-full cursor-pointer rounded-full bg-[#CCFF00] px-4 text-[15px] font-extrabold text-[#08090D]"
            >
              返回主菜单
            </button>
          </>
        ) : (
          <>
            <h2 className="text-[20px] font-extrabold">检测未完成</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#C5CBD8]">
              {state.message ?? "检测过程中出现问题，已应用低画质。可在设置中手动更改画质，或稍后再次执行自动检测。"}
            </p>
            <button
              type="button"
              onClick={onCloseResult}
              className="mt-5 min-h-[44px] w-full cursor-pointer rounded-full bg-[#CCFF00] px-4 text-[15px] font-extrabold text-[#08090D]"
            >
              确定
            </button>
          </>
        )}
      </div>
    </div>
  );
};
