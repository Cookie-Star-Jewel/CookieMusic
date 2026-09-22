"use client";

import { useEffect, type RefObject } from "react";
import {
  MOUSE_RESTING,
  MOUSE_X_TARGETS,
  MOUSE_Y_TARGETS,
  OPTIMIZE_FLOAT,
  SCROLL_TARGETS,
  SMOOTHING_FACTOR,
  type Keyframe,
  type Target,
  type Track,
} from "./timeline";
import {
  DEFAULT_SONG,
  lyricLineForPanel,
  scrollFromTime,
  timeFromScroll,
  type SongData,
} from "./lyrics";

/* ------------------------------------------------------------------ *
 * IX2 maths, re-implemented 1:1
 * ------------------------------------------------------------------ */

/** `getItemConfigByKey` / the `b >= R` scan in the IX2 renderer. */
function sample(track: Keyframe[], percent: number): number {
  const first = track[0];
  if (percent <= first.at) return first.value;

  const last = track[track.length - 1];
  if (percent >= last.at) return last.value;

  for (let i = 0; i < track.length - 1; i += 1) {
    const a = track[i];
    const b = track[i + 1];
    if (percent >= a.at && percent < b.at) {
      const t = (percent - a.at) / (b.at - a.at);
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/** convert a value in the units the IX2 payload declares into CSS pixels */
function toPx(value: number, unit: string | undefined, vw: number, vh: number) {
  switch (unit) {
    case "vw":
      return (value * vw) / 100;
    case "vh":
      return (value * vh) / 100;
    default:
      return value;
  }
}

interface ResolvedTrack {
  /** IX2 default when a property is not driven: translate 0, rotate 0, scale 1 */
  moveX: number;
  moveY: number;
  moveZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  hasOpacity: boolean;
}

const EMPTY: ResolvedTrack = {
  moveX: 0,
  moveY: 0,
  moveZ: 0,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  hasOpacity: false,
};

function applyTrack(
  out: ResolvedTrack,
  track: Track | undefined,
  percent: number,
  vw: number,
  vh: number,
) {
  if (!track) return;
  const scalars = ["moveX", "moveY", "moveZ"] as const;
  for (const prop of scalars) {
    const kfs = track[prop];
    if (!kfs) continue;
    const value = sample(kfs, percent);
    out[prop] = toPx(value, kfs[0].unit, vw, vh);
  }
  for (const prop of ["rotateX", "rotateY", "rotateZ"] as const) {
    const kfs = track[prop];
    if (kfs) out[prop] = sample(kfs, percent);
  }
  if (track.scale) {
    const s = sample(track.scale, percent);
    out.scaleX = s;
    out.scaleY = s;
  }
  if (track.opacity) {
    out.opacity = sample(track.opacity, percent);
    out.hasOpacity = true;
  }
}

function transformOf(r: ResolvedTrack) {
  return `translate3d(${r.moveX}px, ${r.moveY}px, ${r.moveZ}px) rotateX(${r.rotateX}deg) rotateY(${r.rotateY}deg) rotateZ(${r.rotateZ}deg) scale3d(${r.scaleX}, ${r.scaleY}, 1)`;
}

/** optimizeFloat: round to 3 decimals, exactly like the IX2 runtime */
function optimize(v: number) {
  return Math.round(v * OPTIMIZE_FLOAT) / OPTIMIZE_FLOAT;
}

/**
 * IX2's per-frame smoothing step. `optimizeFloat` would stall the value three
 * decimals away from the target (0.001 never reaches 0), which leaves a visible
 * sub-pixel offset, so the value snaps once it is inside the rounding window.
 */
function smooth(current: number, target: number) {
  const next = optimize(current + (target - current) * SMOOTHING_FACTOR);
  return Math.abs(target - next) <= 1.5 / OPTIMIZE_FLOAT ? target : next;
}

/* ------------------------------------------------------------------ *
 * Binding
 * ------------------------------------------------------------------ */

interface Bound {
  el: HTMLElement;
  scroll?: Track;
  mouseX?: Track;
  mouseY?: Track;
  /**
   * IX2 only rewrites `transform` for elements that actually carry a transform
   * action. Elements animated for opacity alone keep the rotation their
   * stylesheet gives them.
   */
  writesTransform: boolean;
}

const TRANSFORM_PROPS = [
  "moveX",
  "moveY",
  "moveZ",
  "rotateX",
  "rotateY",
  "rotateZ",
  "scale",
] as const;

function drivesTransform(track: Track | undefined) {
  if (!track) return false;
  return TRANSFORM_PROPS.some((prop) => track[prop] !== undefined);
}

function bind(root: HTMLElement, targets: Target[]): Bound[] {
  const byElement = new Map<HTMLElement, Bound>();
  for (const target of targets) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(target.sel))) {
      let bound = byElement.get(el);
      if (!bound) {
        bound = { el, writesTransform: false };
        byElement.set(el, bound);
      }
      bound.scroll = target.scroll ?? bound.scroll;
      bound.mouseX = target.mouseX ?? bound.mouseX;
      bound.mouseY = target.mouseY ?? bound.mouseY;
      bound.writesTransform =
        bound.writesTransform ||
        drivesTransform(target.scroll) ||
        drivesTransform(target.mouseX) ||
        drivesTransform(target.mouseY);
    }
  }
  return Array.from(byElement.values());
}

/* ------------------------------------------------------------------ *
 * The hook — virtual loop scroll
 *
 * Native scrolling is disabled for this route (globals.css), so the wheel,
 * touch and keyboard input below feeds an unbounded virtual position. One
 * "loop" (a full 360° of tunnel rotation = five lyric panels) is worth
 * LOOP_VIEWPORTS viewport-heights of input. The smoothed position drives the
 * timeline through its wrapped 0-100% value — every track is periodic
 * (value(100%) === value(0%)), so the wrap back to 0% is invisible and the
 * tunnel can rotate forever.
 * ------------------------------------------------------------------ */

/** How much input, in viewport heights, equals one full loop of the tunnel. */
const LOOP_VIEWPORTS = 2.5;
/** Wheel input with deltaMode "line" is roughly 32px per notch. */
const WHEEL_LINE_PX = 32;
/** Arrow-key step in px. */
const ARROW_KEY_PX = 120;

export function useKarlInteractions(
  rootRef: RefObject<HTMLDivElement | null>,
  /**
   * 取"当前在响"的音频元素。本地同源歌走 Web Audio 引擎槽、在线跨域歌走原生
   * <audio>，两者会来回切，所以传**函数**而不是 ref（每次用时现取）。
   * 调用方必须传稳定引用（useCallback），否则本 effect 会每帧重建。
   */
  getAudio?: () => HTMLAudioElement | null,
  /** 当前歌曲数据（切歌时无需重建整个交互层，ref 实时读取）。 */
  songRef?: RefObject<SongData | null>,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const currentSong = () => songRef?.current ?? DEFAULT_SONG;

    const bound = bind(root, [...SCROLL_TARGETS, ...MOUSE_X_TARGETS, ...MOUSE_Y_TARGETS]);
    if (bound.length === 0) return;

    /* audio — the song drives the loop while playing ------------------- */
    let duration = DEFAULT_SONG.fallbackDuration;
    /** 每帧现取在响元素（本地/在线会切换），顺带刷新真实时长。 */
    const syncDuration = (a: HTMLAudioElement | null) => {
      if (a && Number.isFinite(a.duration) && a.duration > 0) duration = a.duration;
    };
    const seekAudio = (sLoops: number) => {
      const a = getAudio?.() ?? null;
      syncDuration(a);
      if (a) a.currentTime = timeFromScroll(sLoops, duration, currentSong());
    };

    /* virtual scroll state -------------------------------------------- */
    let virtual = 0; // px of input; unbounded, negative = above the start
    let loopPx = window.innerHeight * LOOP_VIEWPORTS;
    let scrollPos = 0; // smoothed position, in loops

    /* lyric panels ------------------------------------------------------ */
    const lyricPanels = Array.from(root.querySelectorAll<HTMLElement>("[data-lyric-panel]"));
    const lastLines: (string | null)[] = lyricPanels.map(() => null);
    const updateLyrics = () => {
      for (let i = 0; i < lyricPanels.length; i += 1) {
        const el = lyricPanels[i];
        const line = lyricLineForPanel(
          Number(el.dataset.lyricPanel),
          scrollPos,
          currentSong(),
        );
        if (line !== lastLines[i]) {
          el.textContent = line;
          lastLines[i] = line;
        }
      }
    };

    /* input handlers ---------------------------------------------------- */
    // 滚动类输入在移动虚拟位置的同时 seek 歌曲：播放中等于拖进度条
    // （"滚到哪句就唱到哪句"），暂停时则静默对齐音频位置。
    // 抽屉（播放列表 / 搜索歌曲 / 正在播放）打开期间滚轮完全归页面：
    // 无论鼠标在面板内还是遮罩上，都不劫持、不 seek，列表照常滚。
    const drawerOpen = () => document.querySelector(".animal-drawer-open") != null;
    const insideDrawer = (event: Event) =>
      (event.target as HTMLElement | null)?.closest?.(".animal-drawer-panel") != null;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // let pinch-zoom through
      if (insideDrawer(event) || drawerOpen()) return;
      event.preventDefault();
      const scale =
        event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? window.innerHeight : 1;
      virtual += event.deltaY * scale;
      seekAudio(virtual / loopPx);
    };

    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchY === null) return;
      if (insideDrawer(event) || drawerOpen()) {
        touchY = null;
        return;
      }
      event.preventDefault();
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      virtual += touchY - y;
      touchY = y;
      seekAudio(virtual / loopPx);
    };
    const onTouchEnd = () => {
      touchY = null;
    };

    const onKeydown = (event: KeyboardEvent) => {
      // leave keys alone when an interactive element has focus
      const el = event.target as HTMLElement | null;
      if (el?.closest?.("a, button, input, textarea, select, [contenteditable]")) return;
      const step = loopPx / 5; // one panel = one lyric line
      if (event.key === "ArrowDown") virtual += ARROW_KEY_PX;
      else if (event.key === "ArrowUp") virtual -= ARROW_KEY_PX;
      else if (event.key === "PageDown" || (event.key === " " && !event.shiftKey)) virtual += step;
      else if (event.key === "PageUp" || (event.key === " " && event.shiftKey)) virtual -= step;
      else return;
      event.preventDefault();
      seekAudio(virtual / loopPx);
    };

    /* mouse — unchanged IX2 behaviour ----------------------------------- */
    // The mouse groups declare `restingState: 50`, and the IX2 renderer falls
    // back to that value while no pointer event has been recorded yet — which
    // is why the page loads with the tunnel centred.
    let mouseXTarget = MOUSE_RESTING / 100; // 0..1
    let mouseYTarget = MOUSE_RESTING / 100;
    let mouseXPos = mouseXTarget;
    let mouseYPos = mouseYTarget;

    const onMouseMove = (event: MouseEvent) => {
      mouseXTarget = Math.min(event.clientX, window.innerWidth) / window.innerWidth;
      mouseYTarget = Math.min(event.clientY, window.innerHeight) / window.innerHeight;
    };

    const onMouseOut = (event: MouseEvent) => {
      // IX2 snaps a mouseout value to 0/1 when it is within 5% of an edge.
      const x = Math.min(event.clientX, window.innerWidth) / window.innerWidth;
      const y = Math.min(event.clientY, window.innerHeight) / window.innerHeight;
      if (event.clientX > window.innerWidth * 0.95 || event.clientX < window.innerWidth * 0.05) {
        mouseXTarget = Math.round(x);
      }
      if (event.clientY > window.innerHeight * 0.95 || event.clientY < window.innerHeight * 0.05) {
        mouseYTarget = Math.round(y);
      }
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mouseout", onMouseOut, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeydown);

    const onResize = () => {
      loopPx = window.innerHeight * LOOP_VIEWPORTS;
    };
    window.addEventListener("resize", onResize);

    // IX2 only writes when the rendered value changed.
    const lastRendered = new Map<HTMLElement, { transform: string; opacity: string }>();

    let frame = 0;
    const tick = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Playing: the song drives the loop. The driven target is anchored to
      // the nearest cycle of the current position, so seeks and the song's
      // own loop-back stay visually continuous (s and s+loopsPerCycle
      // rotate and read identically).
      const audio = getAudio?.() ?? null;
      syncDuration(audio);
      if (audio && !audio.paused && !audio.ended) {
        const song = currentSong();
        const s0 = scrollFromTime(audio.currentTime, duration, song);
        const cycle = Math.round((virtual / loopPx - s0) / song.loopsPerCycle);
        virtual = loopPx * (s0 + song.loopsPerCycle * cycle);
      }

      // continuous parameter groups, each smoothed independently
      scrollPos = smooth(scrollPos, virtual / loopPx);
      mouseXPos = smooth(mouseXPos, mouseXTarget);
      mouseYPos = smooth(mouseYPos, mouseYTarget);

      // sample the wrapped position: every track is periodic, so the loop
      // boundary (100% -> 0%) is visually seamless
      const scrollPct = (((scrollPos % 1) + 1) % 1) * 100;
      const mouseXPct = mouseXPos * 100;
      const mouseYPct = mouseYPos * 100;

      for (const item of bound) {
        const r: ResolvedTrack = { ...EMPTY };
        applyTrack(r, item.scroll, scrollPct, vw, vh);
        applyTrack(r, item.mouseX, mouseXPct, vw, vh);
        applyTrack(r, item.mouseY, mouseYPct, vw, vh);

        const transform = item.writesTransform ? transformOf(r) : "";
        const opacity = r.hasOpacity ? String(r.opacity) : "";

        const previous = lastRendered.get(item.el);
        if (previous && previous.transform === transform && previous.opacity === opacity) continue;

        if (transform) {
          item.el.style.transform = transform;
          item.el.style.transformStyle = "preserve-3d";
        }
        if (r.hasOpacity) item.el.style.opacity = opacity;
        lastRendered.set(item.el, { transform, opacity });
      }

      updateLyrics();

      frame = window.requestAnimationFrame(tick);
    };

    // IX2 renders one frame immediately on page update, then every frame.
    tick();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
    };
  }, [rootRef, getAudio, songRef]);
}
