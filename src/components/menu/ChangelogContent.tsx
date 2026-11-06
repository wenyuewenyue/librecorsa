import React from "react";
import { CHANGELOG, CURRENT_VERSION, type ChangelogKind } from "../../lib/changelog";

const KIND_COLOR: Record<ChangelogKind, string> = {
  新增: "text-[#CCFF00]",
  优化: "text-[#7DD3FC]",
  修复: "text-[#F87171]",
};

/** Full-screen, scrollable version log page for the title menu, newest first. */
export const ChangelogPage: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div
    className="fixed inset-0 z-50 flex flex-col bg-[#08090D]"
    role="dialog"
    aria-modal="true"
    aria-label="版本日志"
  >
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#262B3D] px-5 py-4 sm:px-8">
      <h1 className="lc-title m-0 text-[24px] leading-[1.1] text-[#F5F7FA]">
        版本日志 <span className="font-f1-mono text-[14px] font-bold tracking-[0.12em] text-[#CCFF00]">{CURRENT_VERSION}</span>
      </h1>
      <button
        type="button"
        onClick={onClose}
        className="h-11 shrink-0 cursor-pointer rounded-[14px] border border-[#262B3D] px-5 text-[15px] font-bold text-[#C5CBD8] hover:border-[#CCFF00] hover:text-[#F5F7FA]"
      >
        关闭
      </button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-[860px] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {CHANGELOG.map((entry) => (
          <section key={entry.version} className="mb-6 border-b border-[#262B3D]/70 pb-5 last:border-b-0">
            <h2 className="lc-title m-0 mb-2 text-[20px] leading-[1.1] text-[#F5F7FA]">{entry.version}</h2>
            <ul className="m-0 list-none p-0">
              {entry.items.map((item, i) => (
                <li key={i} className="mb-1.5 flex gap-2.5 text-[14px] leading-[1.6] text-[#C5CBD8] last:mb-0">
                  <span className={`shrink-0 font-bold ${KIND_COLOR[item.kind]}`}>{item.kind}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  </div>
);
