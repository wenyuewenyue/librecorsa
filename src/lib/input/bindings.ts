/**
 * Rebindable controls: keyboard codes and controller / wheel buttons per action.
 * The defaults reproduce the original hard-coded layout exactly.
 */

export type KeyAction =
  | "throttle"
  | "brake"
  | "steerLeft"
  | "steerRight"
  | "boostHold"
  | "boostLatch"
  | "aero"
  | "shiftUp"
  | "shiftDown"
  | "camera"
  | "racingLine"
  | "mute"
  | "autopilot"
  | "mouseSteer"
  | "restart"
  | "throttleHalf"
  | "replay"
  | "mfdPage"
  | "keysOverlay";

/** Actions a controller or wheel button can trigger */
export type PadAction =
  | "boost"
  | "aero"
  | "shiftUp"
  | "shiftDown"
  | "camera"
  | "racingLine"
  | "restart"
  | "pause"
  | "mfd"
  | "mfdPage"
  | "hud";

export type KeyBindings = Record<KeyAction, string[]>;

/** Each action shows a primary and an alternative key (more when the defaults have them) */
export const KEY_SLOTS = 2;

export const KEY_ACTIONS: readonly { id: KeyAction; label: string }[] = [
  { id: "throttle", label: "油门" },
  { id: "brake", label: "刹车" },
  { id: "steerLeft", label: "左转" },
  { id: "steerRight", label: "右转" },
  { id: "boostHold", label: "增压（按住）" },
  { id: "boostLatch", label: "增压（锁定）" },
  { id: "aero", label: "主动空力 X / Z" },
  { id: "shiftUp", label: "升挡" },
  { id: "shiftDown", label: "降挡" },
  { id: "camera", label: "视角" },
  { id: "racingLine", label: "赛车线" },
  { id: "mute", label: "静音" },
  { id: "autopilot", label: "自动驾驶" },
  { id: "mouseSteer", label: "鼠标转向" },
  { id: "restart", label: "重开" },
  { id: "throttleHalf", label: "半油门（按住）" },
  { id: "replay", label: "即时回放" },
  { id: "mfdPage", label: "下一页仪表" },
  { id: "keysOverlay", label: "按键显示" },
];

export const PAD_ACTIONS: readonly { id: PadAction; label: string }[] = [
  { id: "shiftUp", label: "升挡" },
  { id: "shiftDown", label: "降挡" },
  { id: "boost", label: "增压" },
  { id: "aero", label: "主动空力 X / Z" },
  { id: "camera", label: "视角" },
  { id: "racingLine", label: "赛车线" },
  { id: "restart", label: "重开" },
  { id: "pause", label: "暂停菜单" },
  { id: "mfd", label: "打开/关闭仪表" },
  { id: "mfdPage", label: "下一页仪表" },
  { id: "hud", label: "显示/隐藏 HUD" },
];

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  throttle: ["KeyW", "ArrowUp"],
  brake: ["KeyS", "ArrowDown"],
  steerLeft: ["KeyA", "ArrowLeft"],
  steerRight: ["KeyD", "ArrowRight"],
  boostHold: ["Space", "ShiftLeft", "ShiftRight"],
  boostLatch: ["KeyB"],
  aero: ["KeyX"],
  shiftUp: ["KeyE"],
  shiftDown: ["KeyQ"],
  camera: ["KeyC"],
  racingLine: ["KeyR"],
  mute: ["KeyM"],
  autopilot: ["KeyP"],
  mouseSteer: ["KeyV"],
  restart: ["Backspace"],
  throttleHalf: ["KeyF"],
  replay: ["KeyT"],
  mfdPage: ["Insert", "KeyI"],
  keysOverlay: ["KeyH"],
};

/** Keys that cannot be bound: Esc opens the menu, "/" starts the /boost command */
export const RESERVED_CODES: ReadonlySet<string> = new Set(["Escape", "Slash"]);

/** Standard-mapping controller buttons (Xbox layout names) */
export type PadButtonBindings = Record<PadAction, number | null>;

export const DEFAULT_PAD_BUTTONS: PadButtonBindings = {
  boost: 0, // A
  aero: 2, // X
  camera: 3, // Y
  shiftDown: 4, // LB
  shiftUp: 5, // RB
  racingLine: null,
  restart: 8, // View
  pause: 9, // Menu
  mfd: 10, // LS click (L3)
  mfdPage: 1, // B
  hud: 11, // RS click (R3)
};

/** Window events the game loop fires for the HUD's own pad toggles (the MFD and the HUD listen for them) */
export const HUD_TOGGLE_EVENT = { mfd: "lc:toggle-mfd", mfdPage: "lc:mfd-page", hud: "lc:toggle-hud", keysOverlay: "lc:show-keys-overlay" } as const;

/** Fixed standard-mapping axes / buttons for the pedals and steering on a controller */
export const PAD_THROTTLE_BUTTON = 7; // RT
export const PAD_BRAKE_BUTTON = 6; // LT

export const STANDARD_BUTTON_NAMES: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "LB",
  5: "RB",
  6: "LT",
  7: "RT",
  8: "View",
  9: "Menu",
  10: "LS",
  11: "RS",
  12: "D-pad ↑",
  13: "D-pad ↓",
  14: "D-pad ←",
  15: "D-pad →",
  16: "Home",
};

export const padButtonLabel = (button: number | null | undefined) =>
  button === null || button === undefined ? "—" : (STANDARD_BUTTON_NAMES[button] ?? `按键 ${button}`);

/** Readable label for a KeyboardEvent.code */
export function keyLabel(code: string | undefined): string {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Space: "Space",
    ShiftLeft: "L-Shift",
    ShiftRight: "R-Shift",
    ControlLeft: "L-Ctrl",
    ControlRight: "R-Ctrl",
    AltLeft: "L-Alt",
    AltRight: "R-Alt",
    Backspace: "⌫",
    Enter: "Enter",
    Tab: "Tab",
    CapsLock: "Caps",
    Comma: ",",
    Period: ".",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
    Insert: "Ins",
  };
  return named[code] ?? code;
}

/** code → action lookup for the key handlers */
export function buildKeyLookup(bindings: KeyBindings): Map<string, KeyAction> {
  const map = new Map<string, KeyAction>();
  for (const { id } of KEY_ACTIONS) {
    for (const code of bindings[id] ?? []) {
      if (code && !map.has(code)) map.set(code, id);
    }
  }
  return map;
}

/**
 * Binds `code` to `action`'s `slot`. A key already used elsewhere moves here, and the
 * binding it replaces moves to where that key was (a swap), so no action silently loses its key.
 */
export function rebindKey(bindings: KeyBindings, action: KeyAction, slot: number, code: string): KeyBindings {
  if (RESERVED_CODES.has(code)) return bindings;
  const next: KeyBindings = Object.fromEntries(
    Object.entries(bindings).map(([k, v]) => [k, [...v]])
  ) as KeyBindings;
  const previous = next[action][slot];
  for (const { id } of KEY_ACTIONS) {
    const idx = next[id].indexOf(code);
    if (idx === -1) continue;
    if (id === action && idx === slot) return bindings;
    if (previous) next[id][idx] = previous;
    else next[id].splice(idx, 1);
  }
  while (next[action].length <= slot) next[action].push("");
  next[action][slot] = code;
  next[action] = next[action].filter(Boolean);
  return next;
}

/** Removes the key in `action`'s `slot` */
export function clearKey(bindings: KeyBindings, action: KeyAction, slot: number): KeyBindings {
  const next = { ...bindings, [action]: bindings[action].filter((_, i) => i !== slot) };
  return next;
}

/** Binds a controller button; a button already used by another action is unbound there */
export function rebindPadButton(bindings: PadButtonBindings, action: PadAction, button: number): PadButtonBindings {
  const next = { ...bindings };
  for (const key of Object.keys(next) as PadAction[]) {
    if (next[key] === button) next[key] = null;
  }
  next[action] = button;
  return next;
}
