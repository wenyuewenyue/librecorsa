"use client";

import React, { useState } from "react";

/**
 * Rules page and pre-race rules gate.
 *
 * The dismissed flag for the pre-race gate lives under its own key on purpose:
 * it must never touch the player-settings key (`bugesera.settings.v1`) and must
 * never clear settings or scores. The rules text itself is kept in one place so
 * the full-screen page and the gate dialog always show the same wording.
 *
 * Every number below is taken from the implementation it describes
 * (`src/lib/sim/track-limits.ts`, `src/lib/sim/lap-recorder.ts`,
 * `scripts/leaderboard-worker/worker.ts`, `src/lib/input/bindings.ts`):
 * practice strikes add +3 s each, race strikes penalise every 3rd strike
 * (+3 s first, +5 s after), autopilot in a lap adds +30 s once, flashback is
 * free, the online board keeps the top 100 per track-and-car and one best row
 * per driver. There is no whole-lap invalidation any more: every completed lap
 * counts, at its classified time.
 */
export const RULES_GATE_DISMISSED_KEY = "librecorsa.rulesGateDismissed.v1";

export function isRulesGateDismissed(): boolean {
  try {
    return window.localStorage.getItem(RULES_GATE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissRulesGate(): void {
  try {
    window.localStorage.setItem(RULES_GATE_DISMISSED_KEY, "1");
  } catch {
    // Storage unavailable: the gate simply shows again next time.
  }
}

export interface RulesSection {
  id: string;
  title: string;
  items: string[];
}

export const RULES_SECTIONS: RulesSection[] = [
  {
    id: "modes",
    title: "模式",
    items: [
      "练习：从发车格开始，自由跑圈，单圈成绩计入个人最佳与排行榜。",
      "与 AI 竞速：与 5 台 AI 赛车同场，静止发车，按比赛规则计分与罚时，不产生个人最佳与上传圈速。",
      "联机：与好友点对点竞速，由房主开始比赛，按比赛规则计分与罚时，不产生个人最佳与上传圈速。",
    ],
  },
  {
    id: "track-limits",
    title: "赛道限制",
    items: [
      "判定在赛车回到沥青路面并稳定后进行，不在车轮刚压线的瞬间判定。",
      "短于 0.12 秒的轻触不计入判定。",
      "切弯心：抄近道即构成犯规判定，不论是否跑出赛道外多远。",
      "跑宽：出弯后与参考圈对比，快 0.1 秒以上才构成犯规判定；无参考圈时，跑宽且未收油（油门高于 0.6 且未刹车）即构成犯规判定。",
      "交还优势：犯规判定后 6 秒内交还所占时间优势可免罚；有参考圈时需跑出比参考圈更慢的差值，无参考圈时需松油门滑行（油门低于 0.3），滑行时长按出界时长计算，范围为 0.6–2.0 秒。",
      "赛道外超车：10 秒内未归还位置，在比赛模式中直接计 +5 秒罚时。",
    ],
  },
  {
    id: "practice-penalties",
    title: "练习模式罚时",
    items: [
      "练习模式不删除犯规圈：每次赛道限制犯规给当圈成绩加 +3 秒，多次犯规按次数累加。",
      "成绩以加罚后的时间为准：个人最佳、本地排行榜与线上排行榜均使用加罚后的时间，不使用原始驾驶时间。",
      "单圈卡片显示加罚秒数与分项明细，加罚秒数计入该圈成绩，不单独列为另一圈。",
      "罚时可叠加：同一圈的赛道限制罚时与自动驾驶罚时相加；闪回免费，不加罚时。",
    ],
  },
  {
    id: "lap-validity",
    title: "单圈有效性",
    items: [
      "不再有整圈作废：所有跑完的单圈都计入成绩，赛道限制犯规、闪回、自动驾驶都不删除单圈，只按下面规则加时或免费。",
      "单圈成绩以加罚后的时间为准：个人最佳、本地排行榜与线上排行榜均使用加罚后的时间，闪回免费圈使用原始时间。",
      "仍不计入的情况只有记录本身无法成立：圈过短或过长、无采样、分段或记录格式损坏等无法核对的记录不产生单圈成绩，这不是罚时规则。",
    ],
  },
  {
    id: "flashback-autopilot",
    title: "闪回与自动驾驶",
    items: [
      "闪回免费：即时回放中按 F 从回放点恢复驾驶，不收取时间罚时；闪回后的圈按原始时间正常计入个人最佳、幽灵车与排行榜。",
      "闪回传送点会被记录：排行榜用它核对闪回造成的样本跳变，未标记的跳变仍按速度超标拦截。",
      "只看回放不闪回不影响成绩：按 T 打开回放只看不恢复驾驶，本圈不受任何影响。",
      "自动驾驶 +30 秒：单圈内任意一帧处于自动驾驶状态，该圈成绩加 +30 秒，只加一次，不按自动驾驶时长累加。",
      "自动驾驶圈的加罚后时间用于个人最佳、幽灵车与上传；幽灵车仍按原始样本播放，分段最佳不取自动驾驶圈的分段。",
      "自动驾驶出圈后，下一圈重新手动驾驶，该圈仍可正常计时与记录，不再带上上一圈的自动驾驶罚时。",
      "越线时未判完的出界：该圈加 +3 秒，不作废。",
    ],
  },
  {
    id: "race-penalties",
    title: "比赛模式罚时",
    items: [
      "比赛模式不再删除单圈：赛道限制犯规先计警告，警告与罚时计入比赛总成绩。",
      "每累计 3 次警告计一次计时罚时：首次罚时 +3 秒，之后每次罚时 +5 秒。",
      "罚时计入比赛总成绩，比赛结果页显示警告次数与罚时秒数。",
      "赛道外超车且 10 秒内未归还位置，直接计 +5 秒罚时，不经过警告累计。",
    ],
  },
  {
    id: "leaderboard",
    title: "排行榜",
    items: [
      "本地排行榜：仅保存在当前浏览器中，按赛道与赛车分组显示。",
      "线上排行榜：按赛道与赛车分组，每组保留最快的前 100 条；同一车手在同一组中只保留最好的一圈，较慢的一圈不替换已有最好成绩。",
      "上传条件：单圈成绩为加罚后的时间（闪回免费圈为原始时间）；上传后按加罚后的时间排序。",
      "线上排行榜的合理性检查包括：记录格式完整、位置采样推算速度不超过 420 公里/小时；标记过的闪回跳变除外，未标记的跳变仍按速度超标拦截；未通过检查的记录不进入排行榜。",
      "同一网络地址每小时最多提交 10 次。",
      "本地个人最佳不受线上排行榜影响，线上成绩也不改写本地个人最佳。",
    ],
  },
  {
    id: "ghost",
    title: "幽灵车",
    items: [
      "幽灵车按赛道与赛车保存个人最佳，练习模式中与个人最佳同场行驶。",
      "排行榜中的一圈或已保存的幽灵车文件也可作为幽灵车行驶。",
      "幽灵车不发生碰撞，仅作为参照行驶轨迹。",
      "加罚圈的幽灵车样本仍为原始驾驶轨迹，罚时只体现在成绩时间中，不改变样本时间。",
    ],
  },
  {
    id: "multiplayer",
    title: "联机",
    items: [
      "联机方式：房间码点对点、手动交换连接信息点对点、同机多标签页本地联机。",
      "房间码为 6 位字符；手动方式通过复制连接信息完成连接，不经过房间码。",
      "联机比赛由房主开始，开始后按比赛模式的赛道限制与罚时规则计分。",
      "联机中各方驾驶数据点对点传输，断线或数据中断时对方赛车按最后状态预测行驶。",
    ],
  },
  {
    id: "controls",
    title: "常用操作",
    items: [
      "油门：W 或 ↑；刹车：S 或 ↓；左转：A 或 ←；右转：D 或 →。",
      "升挡：E；降挡：Q；增压（按住）：空格或 Shift；增压（锁定）：B；主动空力：X。",
      "视角：C；赛车线：R；自动驾驶：P；鼠标转向：V；半油门（按住）：F；即时回放：T；回放中按 F 闪回，免费且本圈正常计入。",
      "重开：Backspace；暂停菜单：Esc；静音：M；下一页仪表：Insert 或 I。",
      "键盘、手柄与方向盘按键均可在操作设置中重新绑定；Esc 与 / 为保留按键，不可绑定。",
    ],
  },
];

/** Which start mode the pre-race gate was opened from. */
export type RulesGateMode = "practice" | "ai" | "multiplayer";

/**
 * Sections shown in the pre-race gate, per mode. The full-screen page always
 * shows every section; the gate filters this same list, so the wording is
 * never copied into a second copy. AI races do not produce a personal best or
 * an upload, so the gate shows that as a short mode note (see below) instead
 * of the full leaderboard section.
 */
export const RULES_GATE_SECTION_IDS: Record<RulesGateMode, string[]> = {
  practice: ["track-limits", "practice-penalties", "lap-validity", "flashback-autopilot", "leaderboard", "ghost"],
  ai: ["track-limits", "race-penalties", "lap-validity"],
  multiplayer: ["track-limits", "race-penalties", "multiplayer", "leaderboard"],
};

const RULES_GATE_MODE_LABEL: Record<RulesGateMode, string> = {
  practice: "练习",
  ai: "与 AI 竞速",
  multiplayer: "联机",
};

const RULES_GATE_MODE_NOTE: Record<RulesGateMode, string> = {
  practice: "练习模式：单圈成绩计入个人最佳与排行榜。",
  ai: "与 AI 竞速不产生个人最佳与上传圈速。",
  multiplayer: "联机比赛由房主开始，按比赛规则计分与罚时。",
};

/** The shared rules body: used by both the full-screen page and the gate dialog. */
export const RulesBody: React.FC<{ sectionIds?: string[] }> = ({ sectionIds }) => {
  const sections = sectionIds
    ? RULES_SECTIONS.filter((section) => sectionIds.includes(section.id))
    : RULES_SECTIONS;
  return (
    <div className="flex flex-col gap-7">
      {sections.map((section) => (
        <section key={section.id} id={`rules-${section.id}`} aria-label={section.title}>
          <h2 className="lc-title mb-3 text-[19px] leading-[1.2] text-[#F5F7FA]">{section.title}</h2>
          <ul className="m-0 flex flex-col gap-2.5 pl-5 text-[14px] leading-[1.7] text-[#C5CBD8]">
            {section.items.map((item) => (
              <li key={item} className="marker:text-[#CCFF00]">
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

/** Full-screen, scrollable rules page for the title menu. */
export const RulesPage: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div
    className="fixed inset-0 z-50 flex flex-col bg-[#08090D]"
    role="dialog"
    aria-modal="true"
    aria-label="规则"
  >
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#262B3D] px-5 py-4 sm:px-8">
      <h1 className="lc-title m-0 text-[24px] leading-[1.1] text-[#F5F7FA]">规则</h1>
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
        <RulesBody />
      </div>
    </div>
  </div>
);

/**
 * Pre-race rules gate: blocks entry until confirmed. Checking “不再提示”
 * stores only the gate's own key; leaving it unchecked shows the gate again
 * on the next entry.
 */
export const RulesGateDialog: React.FC<{
  mode: RulesGateMode;
  onViewAll: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ mode, onViewAll, onConfirm, onCancel }) => {
  const [neverAgain, setNeverAgain] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="规则"
    >
      <div className="flex max-h-full w-full max-w-[860px] flex-col rounded-[24px] border border-[#262B3D] bg-[#11131A]">
        <div className="flex shrink-0 flex-col gap-1 border-b border-[#262B3D] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="lc-title m-0 text-[22px] leading-[1.1] text-[#F5F7FA]">
              规则 · {RULES_GATE_MODE_LABEL[mode]}
            </h1>
            <span className="shrink-0 text-[12px] text-[#8E96AA]">确认后开始进入游戏</span>
          </div>
          <p className="m-0 text-[13px] leading-[1.5] text-[#8E96AA]">{RULES_GATE_MODE_NOTE[mode]}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <RulesBody sectionIds={RULES_GATE_SECTION_IDS[mode]} />
        </div>
        <div className="flex shrink-0 flex-col gap-3 border-t border-[#262B3D] px-5 py-4">
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-[#C5CBD8]">
            <input
              type="checkbox"
              checked={neverAgain}
              onChange={(e) => setNeverAgain(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-[#CCFF00]"
            />
            不再提示
          </label>
          <button
            type="button"
            onClick={onViewAll}
            className="h-11 cursor-pointer self-start rounded-[14px] border border-[#262B3D] px-4 text-[14px] font-bold text-[#C5CBD8] hover:border-[#CCFF00] hover:text-[#F5F7FA]"
          >
            查看全部规则
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (neverAgain) dismissRulesGate();
                onConfirm();
              }}
              className="h-11 flex-1 cursor-pointer rounded-[14px] bg-[#CCFF00] text-[15px] font-bold text-[#08090D]"
            >
              确认并进入游戏
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="h-11 flex-1 cursor-pointer rounded-[14px] border border-[#262B3D] text-[15px] font-bold text-[#C5CBD8]"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
