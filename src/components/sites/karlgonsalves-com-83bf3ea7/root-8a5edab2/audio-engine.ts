"use client";

/**
 * Web Audio 双播放器引擎 —— **只服务同源音源**（本地曲库 /api/audio、导入的 blob:）。
 *
 * 为什么不能全用它：`createMediaElementSource()` 之后，若 `<audio>` 的 src 是跨域
 * 资源且对方没发 Access-Control-Allow-Origin，Web Audio 会输出**静音**（Chromium
 * 的 CORS 保护，不是报错，是静静地哑掉）。GD 的音频 CDN 直链是跨域的，所以那些歌
 * 继续走原生 `<audio>.volume`（见 KarlSite 的 online 路径）。
 *
 * 每个 slot 的节点图：
 *   el → MediaElementSource → lowpass →┬→ dry ────────────┐
 *                                       └→ wet → convolver ─┴→ master → destination
 * 等功率交叉淡化调度在 master.gain（`setValueCurveAtTime`，一次性排好，不用每帧改）；
 * 「乙」的 A 尾段飘走 = lowpass 20000→800Hz 扫频 + wet 0→0.45。
 *
 * MediaElementSource 每个 audio 元素**只能创建一次**，所以 slot 的元素在引擎创建时
 * 建好并复用（角色在 A/B 之间轮换，不重建元素）。
 */

/** 低通扫频的上/下限（Hz）。上限用满量程，等于"不作用"。 */
const LP_OPEN = 20000;
const LP_MUFFLED = 800;
/** 进场曲"压暗"的低通起点（Hz）。 */
const LEAD_HZ = 1200;
/** 首尾防爆音的最短斜坡（秒）——等功率曲线本身从 0 起、到 0 止，天然无爆音，
 *  这里只用于"直接起播/硬停"这类非过渡场景。 */
const RAMP = 0.012;
/** 曲线采样点数：够密到听不出台阶，又不至于过大。 */
const CURVE_STEPS = 128;

/** 一个可路由的播放器槽。 */
export interface WaSlot {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  lp: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  conv: ConvolverNode;
  /** 等功率淡入淡出的载体。 */
  master: GainNode;
}

export interface WaEngine {
  ctx: AudioContext;
  slots: WaSlot[];
}

let engine: WaEngine | null = null;

/** 程序生成混响脉冲响应（立体声、指数衰减白噪）。 */
function buildImpulse(ctx: AudioContext, seconds = 2.2, decay = 2.6): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/** 懒创建（首次用户手势时调用；AudioContext 在挂起态创建也能用，play 时 resume）。 */
export function getEngine(count = 2): WaEngine {
  if (engine) return engine;
  const ctx = new AudioContext();
  const slots: WaSlot[] = [];
  const lpMax = Math.min(LP_OPEN, Math.max(1000, ctx.sampleRate / 2 - 200));

  for (let i = 0; i < count; i += 1) {
    const el = new Audio();
    el.preload = "auto";
    // 同源音源加 crossOrigin 无副作用；万一误把跨域音源塞进来，
    // 会直接加载失败（onerror）而不是静音——比默默哑掉好排查。
    el.crossOrigin = "anonymous";

    const src = ctx.createMediaElementSource(el);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lpMax;
    lp.Q.value = 0.7;

    const dry = ctx.createGain();
    dry.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    const conv = ctx.createConvolver();
    conv.buffer = buildImpulse(ctx);
    const master = ctx.createGain();
    master.gain.value = 0;

    src.connect(lp);
    lp.connect(dry);
    dry.connect(master);
    lp.connect(wet);
    wet.connect(conv);
    conv.connect(master);
    master.connect(ctx.destination);

    slots.push({ el, src, lp, dry, wet, conv, master });
  }

  engine = { ctx, slots };
  return engine;
}

/** 同源判定：本地曲库（相对 /api/…）、导入的 blob:/data: 都算；跨域直链不算。 */
export function isSameOriginSrc(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("blob:") || url.startsWith("data:")) return true;
  if (url.startsWith("/")) {
    try {
      return typeof window !== "undefined";
    } catch {
      return false;
    }
  }
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** 取消该槽上所有已排程的自动化（切歌 / 拖动进度条时调用，避免旧曲线残留）。 */
function clearAutomation(slot: WaSlot, at: number) {
  slot.master.gain.cancelScheduledValues(at);
  slot.lp.frequency.cancelScheduledValues(at);
  slot.wet.gain.cancelScheduledValues(at);
}

/** 等功率淡入：master 0 → 1（sin 曲线）。 */
export function fadeIn(slot: WaSlot, duration: number, engineCtx?: AudioContext) {
  const ctx = engineCtx ?? slot.master.context;
  const at = ctx.currentTime;
  const curve = new Float32Array(CURVE_STEPS);
  for (let i = 0; i < CURVE_STEPS; i += 1) {
    const x = (i / (CURVE_STEPS - 1)) * (Math.PI / 2);
    curve[i] = Math.sin(x);
  }
  clearAutomation(slot, at);
  slot.master.gain.setValueAtTime(0, at);
  slot.master.gain.setValueCurveAtTime(curve, at, Math.max(duration, RAMP));
}

/** 等功率淡出：master 1 → 0（cos 曲线）。 */
export function fadeOut(slot: WaSlot, duration: number, engineCtx?: AudioContext) {
  const ctx = engineCtx ?? slot.master.context;
  const at = ctx.currentTime;
  const curve = new Float32Array(CURVE_STEPS);
  for (let i = 0; i < CURVE_STEPS; i += 1) {
    const x = (i / (CURVE_STEPS - 1)) * (Math.PI / 2);
    curve[i] = Math.cos(x);
  }
  clearAutomation(slot, at);
  slot.master.gain.setValueAtTime(1, at);
  slot.master.gain.setValueCurveAtTime(curve, at, Math.max(duration, RAMP));
}

/**
 * 「乙」：A（退场曲）尾段飘走 —— 低通从 20k 指数扫到 800Hz，同时混响湿声 0 → 0.45。
 * 与淡出同时长、同时刻排程。
 */
export function applyTail(
  slot: WaSlot,
  duration: number,
  engineCtx?: AudioContext,
  /** 低通扫频终点（Hz），默认 800 */
  lpTo: number = LP_MUFFLED,
  /** 混响湿声终点，默认 0.45 */
  wetTo = 0.45,
) {
  const ctx = engineCtx ?? slot.master.context;
  const at = ctx.currentTime;
  const lpMax = Math.min(LP_OPEN, Math.max(1000, ctx.sampleRate / 2 - 200));
  const steps = CURVE_STEPS;

  // 低通：指数插值（人耳对频率是对数感知，线性扫会前半段几乎没变化）
  const freq = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    freq[i] = lpMax * Math.pow(Math.max(lpTo, 100) / lpMax, t);
  }
  slot.lp.frequency.cancelScheduledValues(at);
  slot.lp.frequency.setValueAtTime(lpMax, at);
  slot.lp.frequency.setValueCurveAtTime(freq, at, Math.max(duration, RAMP));

  // 混响湿声：线性 0 → wetTo
  const wet = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    wet[i] = wetTo * (i / (steps - 1));
  }
  slot.wet.gain.cancelScheduledValues(at);
  slot.wet.gain.setValueAtTime(0, at);
  slot.wet.gain.setValueCurveAtTime(wet, at, Math.max(duration, RAMP));
}

/**
 * 「进场曲压暗」：近似 spec 的「B 伴奏先淡入、B 人声后进」——入场瞬间把低通压到
 * 1200Hz（听起来像伴奏铺底，人声细节被闷掉），在过渡的前 60% 里指数放开到全开。
 *
 * ⚠️ 这是**听感近似**，不是音源分离：Web Audio 无法把一首歌拆成人声/伴奏。
 * ⚠️ 调用顺序：必须排在 `fadeIn` **之后** —— clearAutomation 会把同槽的
 *    lp.frequency 自动化一起取消，先调本函数会被抹掉。
 */
export function applyLeadIn(slot: WaSlot, duration: number, engineCtx?: AudioContext) {
  const ctx = engineCtx ?? slot.master.context;
  const at = ctx.currentTime;
  const lpMax = Math.min(LP_OPEN, Math.max(1000, ctx.sampleRate / 2 - 200));
  const steps = CURVE_STEPS;
  const freq = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    freq[i] = LEAD_HZ * Math.pow(lpMax / LEAD_HZ, t);
  }
  const span = Math.max(duration * 0.6, RAMP);
  slot.lp.frequency.cancelScheduledValues(at);
  slot.lp.frequency.setValueAtTime(LEAD_HZ, at);
  slot.lp.frequency.setValueCurveAtTime(freq, at, span);
}

/**
 * 参数复位（下次用这个槽时是干净状态）：低通全开、无混响、master 归零。
 *
 * ⚠️ 同时把 `el.volume` 拉回 1 —— 元素的 `volume` 与 master 增益是**两套音量**：
 * 本地路径正常只该用 master，但历史代码里有 `fadeAudio` 写过 `el.volume`（且从不复位），
 * 会让复用槽永远偏小/无声。这里做防御性复位，保证槽干净。
 */
export function resetSlot(slot: WaSlot, engineCtx?: AudioContext) {
  const ctx = engineCtx ?? slot.master.context;
  const at = ctx.currentTime;
  clearAutomation(slot, at);
  const lpMax = Math.min(LP_OPEN, Math.max(1000, ctx.sampleRate / 2 - 200));
  slot.lp.frequency.setValueAtTime(lpMax, at);
  slot.wet.gain.setValueAtTime(0, at);
  slot.master.gain.setValueAtTime(0, at);
  slot.el.volume = 1;
}

/** 立即停声并复位（取消过渡或切歌时用）；静默认在斜坡末尾之后，避免尾部爆音。 */
export function stopSlot(slot: WaSlot, engineCtx?: AudioContext) {
  const ctx = engineCtx ?? slot.master.context;
  const at = ctx.currentTime;
  clearAutomation(slot, at);
  slot.master.gain.setValueAtTime(slot.master.gain.value, at);
  slot.master.gain.linearRampToValueAtTime(0, at + RAMP);
  // 延时清理前先记下"要停的是哪一首"：若这 22ms 内槽被复用（换了 src），
  // 就不能再 pause/清 src，否则会误杀刚载入的新歌。
  const stopSrc = slot.el.src;
  window.setTimeout(() => {
    if (slot.el.src !== stopSrc) return;
    try {
      slot.el.pause();
      slot.el.removeAttribute("src");
      slot.el.load();
    } catch {
      /* 忽略 */
    }
  }, Math.ceil(RAMP * 1000) + 10);
}

/** 直接起播（非过渡）：排一个短斜坡再满格，避免爆音。 */
export function startSlotAtFull(slot: WaSlot, engineCtx?: AudioContext) {
  const ctx = engineCtx ?? slot.master.context;
  const at = ctx.currentTime;
  clearAutomation(slot, at);
  slot.el.volume = 1; // 与 resetSlot 同理：元素音量必须是满的，音量只由 master 决定
  slot.master.gain.setValueAtTime(0, at);
  slot.master.gain.linearRampToValueAtTime(1, at + RAMP);
}

/** 插槽是否为静默（用于判断"没有在响的槽"）。 */
export function isSlotSilent(slot: WaSlot) {
  return slot.master.gain.value <= 0.001;
}
