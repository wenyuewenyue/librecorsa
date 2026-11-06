/**
 * Setup sheets per car class, laid out the way drivers expect: the F1 cars share one sheet (aerodynamics,
 * transmission, suspension geometry, suspension, dampers, brakes, tyres) and the GT3 cars another (tyres,
 * electronics, mechanical grip, dampers, aero). One sheet serves every car of its class; each car only brings its own baseline
 * (ride heights, wheel rates, bump stops, preload, steering ratio, tyre ranges).
 *
 * A sheet is a view over the setup the cars already take: the chassis offsets (`ChassisSetup`), the tyre setup and
 * the electronics' starting dials. Each parameter reads its game-style value from that state and writes it back.
 */

import type { TyreSetup, VehicleModelId } from "@/types/f1";
import { type ChassisSetup, CHASSIS_LIMITS, type GarageTuner, STEER_RATIO_BASE } from "./car-setup";
import { VF26_CHASSIS } from "./vf26-data";
import { F12026_CAR_CONFIG } from "./f12026-car/F12026CarConfig";
import { AMG_GT3_CONFIG } from "./gt3/AmgGt3Config";

export type SetupClassId = "f1" | "gt3";

export const SETUP_CLASS: Record<VehicleModelId, SetupClassId> = {
  vf26: "f1",
  "f12026-car": "f1",
  "amg-gt3": "gt3",
};

export interface SetupState {
  chassis: ChassisSetup;
  tyre: TyreSetup;
  tuner: GarageTuner;
}

interface Range {
  min: number;
  max: number;
  step: number;
}

export interface TyreRanges {
  pressurePsi: Range;
  camberFrontDeg: Range;
  camberRearDeg: Range;
}

/** What raising (`more`) or lowering (`less`) a value does, in a few words */
export interface SetupEffect {
  more: string;
  less: string;
}

export interface SetupParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** The value the car leaves the factory with (for the electronics, a typical value: each car brings its own) */
  base: number;
  get(st: SetupState): number;
  set(st: SetupState, v: number): SetupState;
  format(v: number): string;
  fx: SetupEffect;
  /** `fx.more` is the slider's left side (more negative camber) */
  invert?: boolean;
  /** Which of the car's setup channels it writes (the garage can only change the ones it is given) */
  writes: "chassis" | "tyre" | "tuner";
}

export type SetupExtra = "compound" | "aeroPackage" | "assists" | "liveTyres";

export interface SetupGroup {
  id: string;
  label: string;
  short: string;
  params: SetupParam[];
  /** Pickers the garage draws above the group's sliders */
  extras?: SetupExtra[];
}

/** A car's own baseline, in the units the sheets show */
interface CarBaseline {
  rideFrontMm: number;
  rideRearMm: number;
  toeFrontDeg: number;
  toeRearDeg: number;
  wheelRateFrontNmm: number;
  wheelRateRearNmm: number;
  bumpStopRateFrontNmm: number;
  bumpStopRateRearNmm: number;
  bumpStopRangeFrontMm: number;
  bumpStopRangeRearMm: number;
  diffPreloadNm: number;
  steerRatio: number;
}

const rigidBaseline = (cfg: typeof F12026_CAR_CONFIG | typeof AMG_GT3_CONFIG, vehicle: VehicleModelId): CarBaseline => ({
  rideFrontMm: cfg.aero.front_target_height * 1000,
  rideRearMm: cfg.aero.rear_target_height * 1000,
  toeFrontDeg: 0,
  toeRearDeg: 0,
  wheelRateFrontNmm: cfg.suspensions.front.springs.wheel_rate / 1000,
  wheelRateRearNmm: cfg.suspensions.rear.springs.wheel_rate / 1000,
  bumpStopRateFrontNmm: cfg.suspensions.front.bumpStop.rate / 1000,
  bumpStopRateRearNmm: cfg.suspensions.rear.bumpStop.rate / 1000,
  bumpStopRangeFrontMm: cfg.suspensions.front.bumpStop.range * 1000,
  bumpStopRangeRearMm: cfg.suspensions.rear.bumpStop.range * 1000,
  diffPreloadNm: cfg.differential.settings.preload,
  steerRatio: STEER_RATIO_BASE[vehicle],
});

const BASELINES: Record<VehicleModelId, CarBaseline> = {
  vf26: {
    rideFrontMm: VF26_CHASSIS.front.staticRideHeight * 1000,
    rideRearMm: VF26_CHASSIS.rear.staticRideHeight * 1000,
    toeFrontDeg: VF26_CHASSIS.front.staticToeDeg,
    toeRearDeg: VF26_CHASSIS.rear.staticToeDeg,
    wheelRateFrontNmm: VF26_CHASSIS.front.springRate / 1000,
    wheelRateRearNmm: VF26_CHASSIS.rear.springRate / 1000,
    bumpStopRateFrontNmm: 0,
    bumpStopRateRearNmm: 0,
    bumpStopRangeFrontMm: 0,
    bumpStopRangeRearMm: 0,
    diffPreloadNm: 0,
    steerRatio: STEER_RATIO_BASE.vf26,
  },
  "f12026-car": rigidBaseline(F12026_CAR_CONFIG, "f12026-car"),
  "amg-gt3": rigidBaseline(AMG_GT3_CONFIG, "amg-gt3"),
};

const clampTo = (v: number, r: { min: number; max: number }) => Math.max(r.min, Math.min(r.max, v));

/**
 * A chassis offset shown on a game-style scale: display = base + offset × perUnit. The slider runs over the
 * display range [min, max] (clipped to what the offset allows).
 */
function chassisParam(
  key: keyof ChassisSetup,
  o: { id?: string; label: string; base: number; perUnit?: number; min: number; max: number; step: number; format: (v: number) => string; fx: SetupEffect }
): SetupParam {
  const k = o.perUnit ?? 1;
  const lim = CHASSIS_LIMITS[key];
  // Range in whole steps from the baseline, so the slider (which snaps to min + n·step) lands on the baseline
  const lo = Math.max(o.min, o.base + Math.min(lim.min * k, lim.max * k));
  const hi = Math.min(o.max, o.base + Math.max(lim.min * k, lim.max * k));
  const eps = 1e-6;
  return {
    id: o.id ?? key,
    label: o.label,
    min: Number((o.base + Math.ceil((lo - o.base) / o.step - eps) * o.step).toFixed(4)),
    max: Number((o.base + Math.floor((hi - o.base) / o.step + eps) * o.step).toFixed(4)),
    step: o.step,
    base: o.base,
    get: (st) => Number((o.base + st.chassis[key] * k).toFixed(4)),
    set: (st, v) => ({ ...st, chassis: { ...st.chassis, [key]: clampTo(Number(((v - o.base) / k).toFixed(4)), lim) } }),
    format: o.format,
    fx: o.fx,
    writes: "chassis",
  };
}

function tunerParam(
  key: keyof GarageTuner,
  o: { label: string; base: number; min: number; max: number; step: number; format: (v: number) => string; fx: SetupEffect }
): SetupParam {
  return {
    id: key,
    label: o.label,
    min: o.min,
    max: o.max,
    step: o.step,
    base: o.base,
    get: (st) => st.tuner[key] ?? o.base,
    set: (st, v) => ({ ...st, tuner: { ...st.tuner, [key]: v } }),
    format: o.format,
    fx: o.fx,
    writes: "tuner",
  };
}

function tyreParam(
  id: string,
  label: string,
  r: Range,
  base: number,
  get: (t: TyreSetup) => number,
  put: (t: TyreSetup, v: number) => TyreSetup,
  format: (v: number) => string,
  fx: SetupEffect,
  invert = false
): SetupParam {
  return {
    id,
    label,
    ...r,
    base,
    get: (st) => get(st.tyre),
    set: (st, v) => ({ ...st, tyre: put(st.tyre, v) }),
    format,
    fx,
    invert,
    writes: "tyre",
  };
}

const psi = (v: number) => `${v.toFixed(1)} psi`;
const deg2 = (v: number) => `${v.toFixed(2)}°`;
const camber = (v: number) => `${v.toFixed(1)}°`;
const toe = (v: number) => (Math.abs(v) < 0.005 ? "0.00°" : `${Math.abs(v).toFixed(2)}° ${v > 0 ? "内" : "外"}`);
const pct = (v: number) => `${Math.round(v)}%`;
const mm = (v: number) => `${Math.round(v)} mm`;
const int = (v: number) => String(Math.round(v));
/** Diff levels 1–12 on F1's 10–100 % scale */
const diffPct = (lvl: number) => `${Math.round(10 + ((lvl - 1) * 90) / 11)}%`;

const FX = {
  frontWing: { more: "高速下前部抓地力更强，车尾更活", less: "车尾更稳，高速转向不足更明显" },
  rearWing: { more: "更稳定、牵引力更强，阻力更大", less: "直道更快，车尾更不稳" },
  diffOn: { more: "驱动力更强，动力转向过度", less: "对后轮更温和，内侧轮易打滑" },
  diffOff: { more: "松油门时更稳定，抗入弯", less: "入弯更灵活，可能感觉松散" },
  engineBraking: { more: "松油门时后部制动更强，易转向", less: "松油门时更平稳，刹车距离更长" },
  camberFront: { more: "弯中前部抓地力更强", less: "刹车更好，磨损更均匀" },
  camberRear: { more: "后部横向抓地力更强", less: "慢弯出弯牵引力更好" },
  toeFront: { more: "直道更稳，入弯更迟钝", less: "入弯更锐利，高速易发飘" },
  toeRear: { more: "车尾稳定，阻力稍大", less: "转向更灵活，稳定性下降" },
  springFront: { more: "响应更锐利，颠簸抓地力下降", less: "颠簸路面抓地力更强" },
  springRear: { more: "转向更灵活，牵引力下降", less: "牵引力更强，转向更迟钝" },
  arbFront: { more: "变向更快，转向不足", less: "弯中前部抓地力更强" },
  arbRear: { more: "转向更灵活，出弯牵引力下降", less: "后部抓地力更强，转向不足更明显" },
  rideFront: { more: "过路肩更安全，下压力下降", less: "下压力更强，底板可能失速" },
  rideRear: { more: "俯仰角更大：更锐利，车尾更活", less: "车尾更平稳，转向不足更明显" },
  brakePressure: { more: "刹车距离更短，更易抱死", less: "更易控制，刹车距离更长" },
  bias: { more: "刹车稳定，前轮先抱死", less: "入弯易转向，后轮先抱死" },
  migration: { more: "拖刹时易转向", less: "松开刹车时平衡保持不变" },
  coldPsi: { more: "升温更快，峰值抓地力下降", less: "抓地力更强，升温更慢" },
  tc: { more: "打滑更少，出弯更慢", less: "出弯更快，车尾可能甩出" },
  tc2: { more: "强切断：稳稳抓住打滑", less: "柔和切断：保留更多动力" },
  abs: { more: "不抱死，刹车距离更长", less: "操作精准时刹车距离更短" },
  map: { more: "油门更柔和，动力更小", less: "全动力，油门更灵敏" },
  steerRatio: { more: "转向更慢，锁止角更小", less: "转向更快，锁止角更大" },
  wheelRateFront: { more: "前部更锐利，颠簸抓地力下降", less: "颠簸路面抓地力更强" },
  wheelRateRear: { more: "转向更灵活，牵引力下降", less: "牵引力更强，转向更迟钝" },
  bumpStopRate: { more: "触及缓冲块时更硬", less: "触及缓冲块时更软" },
  bumpStopRange: { more: "触及缓冲块前行程更大", less: "更早触及缓冲块，平台更平" },
  preload: { more: "高速弯更稳，慢弯推头", less: "入弯易转向，出弯更松散" },
  bump: { more: "车身起伏更小，颠簸更颠", less: "吸震更好，车身起伏更大" },
  fastBump: { more: "过路肩更硬", less: "更能吸收路肩冲击" },
  rebound: { more: "重心回位更慢，出弯更稳", less: "轮胎更贴合路面" },
  fastRebound: { more: "过路肩后车轮回落更慢", less: "车轮回落更快" },
  ductFront: { more: "前刹车更凉，阻力更大", less: "前刹车更热，阻力更小" },
  ductRear: { more: "后刹车更凉，阻力更大", less: "后刹车更热，阻力更小" },
} satisfies Record<string, SetupEffect>;

export const ENGINE_MAP_LABELS = ["", "1 · 全力", "2 · 正赛", "3 · 平顺", "4 · 省油", "5 · 节能"];

/**
 * Bump and rebound, slow and fast, front and rear: clicks 0–16 with the baseline at 8, each click 5 % of the
 * car's own baseline damping. Every car shares the page; the physics scales each car's damper curves.
 */
const dampers = (): SetupParam[] => {
  const damper = (key: keyof ChassisSetup, label: string, fx: SetupEffect) =>
    chassisParam(key, { label, base: 8, perUnit: 1 / 5, min: 0, max: 16, step: 1, format: int, fx });
  return [
    damper("bumpFrontPct", "前压缩阻尼", FX.bump),
    damper("bumpRearPct", "后压缩阻尼", FX.bump),
    damper("fastBumpFrontPct", "前高速压缩阻尼", FX.fastBump),
    damper("fastBumpRearPct", "后高速压缩阻尼", FX.fastBump),
    damper("reboundFrontPct", "前回弹阻尼", FX.rebound),
    damper("reboundRearPct", "后回弹阻尼", FX.rebound),
    damper("fastReboundFrontPct", "前高速回弹阻尼", FX.fastRebound),
    damper("fastReboundRearPct", "后高速回弹阻尼", FX.fastRebound),
  ];
};

/** The parameters every car shares on its electronics page */
const electronics = (): SetupParam[] => [
  tunerParam("tcLevel", { label: "TC 1", base: 5, min: 0, max: 12, step: 1, format: (v) => (v === 0 ? "关" : int(v)), fx: FX.tc }),
  tunerParam("tc2Level", { label: "TC 2", base: 6, min: 1, max: 12, step: 1, format: int, fx: FX.tc2 }),
  tunerParam("absLevel", { label: "ABS", base: 5, min: 0, max: 12, step: 1, format: (v) => (v === 0 ? "关" : int(v)), fx: FX.abs }),
  tunerParam("engineMap", { label: "引擎模式", base: 2, min: 1, max: 5, step: 1, format: (v) => ENGINE_MAP_LABELS[v] ?? int(v), fx: FX.map }),
];

// 每条轮胎单独设定冷胎压（前左 / 前右 / 后左 / 后右）
const tyrePressures = (r: TyreRanges, d: TyreSetup): SetupParam[] =>
  (
    [
      ["fl", "psiFL", "前左胎压"],
      ["fr", "psiFR", "前右胎压"],
      ["rl", "psiRL", "后左胎压"],
      ["rr", "psiRR", "后右胎压"],
    ] as const
  ).map(([k, key, label]) =>
    tyreParam(key, label, r.pressurePsi, d.coldPressurePsi[k], (t) => t.coldPressurePsi[k], (t, v) => ({ ...t, coldPressurePsi: { ...t.coldPressurePsi, [k]: v } }), psi, FX.coldPsi)
  );

const cambers = (r: TyreRanges, d: TyreSetup): SetupParam[] => [
  tyreParam("camberFront", "前轮外倾角", r.camberFrontDeg, d.camberDeg.front, (t) => t.camberDeg.front, (t, v) => ({ ...t, camberDeg: { ...t.camberDeg, front: v } }), camber, FX.camberFront, true),
  tyreParam("camberRear", "后轮外倾角", r.camberRearDeg, d.camberDeg.rear, (t) => t.camberDeg.rear, (t, v) => ({ ...t, camberDeg: { ...t.camberDeg, rear: v } }), camber, FX.camberRear, true),
];

/** The F1 sheet: shared by every F1 car */
function f1Sheet(b: CarBaseline, r: TyreRanges, d: TyreSetup): SetupGroup[] {
  return [
    {
      id: "aero",
      label: "空气动力学",
      short: "空力",
      extras: ["aeroPackage"],
      params: [
        chassisParam("frontWingClicks", { label: "前翼", base: 25, min: 0, max: 50, step: 1, format: int, fx: FX.frontWing }),
        chassisParam("rearWingClicks", { label: "后翼", base: 25, min: 0, max: 50, step: 1, format: int, fx: FX.rearWing }),
      ],
    },
    {
      id: "transmission",
      label: "传动系统",
      short: "传动",
      params: [
        tunerParam("diffExit", { label: "油门差速器", base: 5, min: 1, max: 12, step: 1, format: diffPct, fx: FX.diffOn }),
        tunerParam("diffEntry", { label: "松油门差速器", base: 3, min: 1, max: 12, step: 1, format: diffPct, fx: FX.diffOff }),
        chassisParam("engineBrakingPct", { label: "发动机制动", base: 100, min: 50, max: 100, step: 5, format: pct, fx: FX.engineBraking }),
      ],
    },
    {
      id: "geometry",
      label: "悬架几何",
      short: "几何",
      params: [
        ...cambers(r, d),
        chassisParam("toeFrontDeg", { label: "前轮前束角", base: b.toeFrontDeg, min: -0.5, max: 0.3, step: 0.01, format: toe, fx: FX.toeFront }),
        chassisParam("toeRearDeg", { label: "后轮前束角", base: b.toeRearDeg, min: -0.1, max: 0.5, step: 0.01, format: toe, fx: FX.toeRear }),
      ],
    },
    {
      id: "suspension",
      label: "悬架",
      short: "悬架",
      params: [
        // 1–41 as in the games: each step 1.5 % of the baseline rate, 21 the baseline
        chassisParam("springFrontPct", { label: "前悬架", base: 21, perUnit: 1 / 1.5, min: 1, max: 41, step: 1, format: int, fx: FX.springFront }),
        chassisParam("springRearPct", { label: "后悬架", base: 21, perUnit: 1 / 1.5, min: 1, max: 41, step: 1, format: int, fx: FX.springRear }),
        chassisParam("arbFrontPct", { label: "前防倾杆", base: 11, perUnit: 1 / 5, min: 1, max: 21, step: 1, format: int, fx: FX.arbFront }),
        chassisParam("arbRearPct", { label: "后防倾杆", base: 11, perUnit: 1 / 5, min: 1, max: 21, step: 1, format: int, fx: FX.arbRear }),
        chassisParam("rideHeightFrontMm", { label: "前离地高度", base: Math.round(b.rideFrontMm), min: Math.round(b.rideFrontMm) - 8, max: Math.round(b.rideFrontMm) + 10, step: 1, format: mm, fx: FX.rideFront }),
        chassisParam("rideHeightRearMm", { label: "后离地高度", base: Math.round(b.rideRearMm), min: Math.round(b.rideRearMm) - 10, max: Math.round(b.rideRearMm) + 15, step: 1, format: mm, fx: FX.rideRear }),
      ],
    },
    {
      id: "dampers",
      label: "减振器",
      short: "减振器",
      params: dampers(),
    },
    {
      id: "brakes",
      label: "刹车",
      short: "刹车",
      params: [
        chassisParam("brakePowerPct", { label: "制动压力", base: 100, min: 80, max: 100, step: 1, format: pct, fx: FX.brakePressure }),
        tunerParam("brakeBiasPct", { label: "前制动偏置", base: 56, min: 50, max: 70, step: 0.5, format: (v) => `${v.toFixed(1)}%`, fx: FX.bias }),
        tunerParam("brakeMigrationPct", { label: "制动迁移", base: 2.5, min: 0, max: 6, step: 0.5, format: (v) => `${v.toFixed(1)}%`, fx: FX.migration }),
      ],
    },
    {
      id: "tyres",
      label: "轮胎",
      short: "轮胎",
      extras: ["compound", "liveTyres"],
      params: tyrePressures(r, d),
    },
    {
      id: "electronics",
      label: "电子系统",
      short: "电子",
      extras: ["assists"],
      params: electronics(),
    },
  ];
}

/** The GT3 sheet: shared by every GT3 car */
function gt3Sheet(b: CarBaseline, r: TyreRanges, d: TyreSetup): SetupGroup[] {
  const rate = (key: keyof ChassisSetup, label: string, baseNmm: number, fx: SetupEffect) =>
    // The slider runs in % of the baseline; the readout is the rate itself
    chassisParam(key, { label, base: 0, min: -100, max: 100, step: CHASSIS_LIMITS[key].step, format: (v) => `${Math.round(baseNmm * (1 + v / 100))} N/mm`, fx });
  return [
    {
      id: "tyres",
      label: "轮胎",
      short: "轮胎",
      extras: ["compound", "liveTyres"],
      params: [
        ...tyrePressures(r, d),
        chassisParam("toeFrontDeg", { label: "前轮前束角", base: b.toeFrontDeg, min: -0.4, max: 0.4, step: 0.01, format: toe, fx: FX.toeFront }),
        chassisParam("toeRearDeg", { label: "后轮前束角", base: b.toeRearDeg, min: -0.4, max: 0.4, step: 0.01, format: toe, fx: FX.toeRear }),
        ...cambers(r, d),
      ],
    },
    {
      id: "electronics",
      label: "电子系统",
      short: "电子",
      extras: ["assists"],
      params: electronics(),
    },
    {
      id: "mechanical",
      label: "机械抓地力",
      short: "机械",
      params: [
        chassisParam("arbFrontPct", { label: "前防倾杆", base: 11, perUnit: 1 / 5, min: 1, max: 21, step: 1, format: int, fx: FX.arbFront }),
        chassisParam("arbRearPct", { label: "后防倾杆", base: 11, perUnit: 1 / 5, min: 1, max: 21, step: 1, format: int, fx: FX.arbRear }),
        chassisParam("brakePowerPct", { label: "制动功率", base: 100, min: 80, max: 100, step: 1, format: pct, fx: FX.brakePressure }),
        tunerParam("brakeBiasPct", { label: "制动偏置", base: 71, min: 60, max: 78, step: 0.5, format: (v) => `${v.toFixed(1)}%`, fx: FX.bias }),
        chassisParam("steerRatioDelta", { label: "转向比", base: b.steerRatio, min: 10, max: 16, step: 0.2, format: (v) => v.toFixed(1), fx: FX.steerRatio }),
        rate("springFrontPct", "前轮刚度", b.wheelRateFrontNmm, FX.wheelRateFront),
        rate("springRearPct", "后轮刚度", b.wheelRateRearNmm, FX.wheelRateRear),
        rate("bumpStopRateFrontPct", "前缓冲块刚度", b.bumpStopRateFrontNmm, FX.bumpStopRate),
        rate("bumpStopRateRearPct", "后缓冲块刚度", b.bumpStopRateRearNmm, FX.bumpStopRate),
        chassisParam("bumpStopRangeFrontMm", { label: "前缓冲块行程", base: Math.round(b.bumpStopRangeFrontMm), min: 5, max: 40, step: 1, format: mm, fx: FX.bumpStopRange }),
        chassisParam("bumpStopRangeRearMm", { label: "后缓冲块行程", base: Math.round(b.bumpStopRangeRearMm), min: 5, max: 40, step: 1, format: mm, fx: FX.bumpStopRange }),
        chassisParam("diffPreloadNm", { label: "差速器预载", base: b.diffPreloadNm, min: 20, max: 300, step: 10, format: (v) => `${Math.round(v)} Nm`, fx: FX.preload }),
      ],
    },
    {
      id: "dampers",
      label: "减振器",
      short: "减振器",
      params: dampers(),
    },
    {
      id: "aero",
      label: "空力",
      short: "空力",
      extras: ["aeroPackage"],
      params: [
        chassisParam("rideHeightFrontMm", { label: "前离地高度", base: Math.round(b.rideFrontMm), min: Math.round(b.rideFrontMm) - 15, max: Math.round(b.rideFrontMm) + 15, step: 1, format: mm, fx: FX.rideFront }),
        chassisParam("rideHeightRearMm", { label: "后离地高度", base: Math.round(b.rideRearMm), min: Math.round(b.rideRearMm) - 15, max: Math.round(b.rideRearMm) + 15, step: 1, format: mm, fx: FX.rideRear }),
        chassisParam("rearWingClicks", { label: "后翼", base: 5, min: 0, max: 10, step: 1, format: int, fx: FX.rearWing }),
        chassisParam("brakeDuctFront", { label: "前刹车风道", base: 3, min: 0, max: 6, step: 1, format: int, fx: FX.ductFront }),
        chassisParam("brakeDuctRear", { label: "后刹车风道", base: 3, min: 0, max: 6, step: 1, format: int, fx: FX.ductRear }),
      ],
    },
  ];
}

/** The setup sheet of a car: its class's parameters on that car's baseline */
export function setupSheet(vehicle: VehicleModelId, tyreRanges: TyreRanges, tyreDefaults: TyreSetup): SetupGroup[] {
  const b = BASELINES[vehicle];
  return SETUP_CLASS[vehicle] === "gt3" ? gt3Sheet(b, tyreRanges, tyreDefaults) : f1Sheet(b, tyreRanges, tyreDefaults);
}
