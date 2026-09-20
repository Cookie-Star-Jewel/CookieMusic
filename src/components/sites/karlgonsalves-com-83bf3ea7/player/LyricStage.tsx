"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { LyricLine } from "@/lib/lrc";
import { lineFloatAt } from "@/lib/lrc";
import { BuildingRing, CloudRing, LampRing } from "../root-8a5edab2/Rings";
import type { LiveAudio } from "./usePlayerEngine";

/**
 * 环的几何参数。
 *
 * 一个整圈放 7 句（51.43°/句）。只渲染 3 个槽：
 *   k=-1  刚唱完的那句，正在淡出
 *   k= 0  正在唱的那句，从正面开始、随着这句唱完向后上方飘走
 *   k= 1  下一句，从下方升起，正好在它变成「当前句」的那一刻落到正面
 *
 * 关键点：环的旋转只走「当前句的那一格」（0 → -51°），跨句时把槽内容整体后移
 * 一位、角度归零。因为交接点上位置和透明度都完全连续，所以永远看不到「回到第一句」。
 */
const SLOT_KEYS = [-1, 0, 1] as const;
const STEP_DEG = 360 / 7;
/** 用户滚动后多久恢复自动跟随。 */
const HANDOFF_MS = 900;
/** 这一句唱到多少比例才开始转到下一句。 */
const TURN_AT = 0.72;

/**
 * 环的转动量（0..1）。
 *
 * 前 72% 完全不转 —— 正在唱的那句就稳稳停在正面；最后 28% 才平滑地转一格，
 * 把下一句送上来。如果按 frac 线性转，当前句会在整句时间里一直往上飘、越来越
 * 大，那就没法读了。
 */
function turnAmount(frac: number) {
  if (frac <= TURN_AT) return 0;
  const x = Math.min(1, (frac - TURN_AT) / (1 - TURN_AT));
  return x * x * (3 - 2 * x);
}

function smooth01(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * 每个槽的透明度。
 *
 * 关键是**不要做长时间交叉淡入淡出**：两条半透明的大字叠在一起会糊成一团。
 * 所以顺序是「旧句先退场（turn 0.10→0.55）→ 新句再进场（turn 0.55→1）」，
 * 中间任何时刻只有一条是真正可读的。
 *
 * 三个槽在换句点上首尾相接，所以看不到跳变：
 *   旧 k=0 在 turn=1 是 0.12  ->  换句后变 k=-1，frac=0 也是 0.12
 *   旧 k=1 在 turn=1 是 1.00  ->  换句后变 k=0，turn=0 也是 1.00
 */
function slotOpacity(k: number, frac: number, turn: number) {
  if (k === 0) return 1 - 0.88 * smooth01((turn - 0.1) / 0.45);
  if (k === -1) return 0.12 * (1 - Math.min(1, frac / 0.2));
  return 0.18 + 0.82 * smooth01((turn - 0.55) / 0.45);
}

interface Props {
  lines: LyricLine[];
  live: RefObject<LiveAudio>;
  playing: boolean;
  duration: number;
  title: string;
  /** seek 到某一时刻 */
  seek: (seconds: number) => void;
  /** 当前所处的「句」发生变化，供外部（比如控制条）使用 */
  onLineChange?: (index: number) => void;
}

/** 一行歌词占的「em 宽度」：中日韩字符按 1，拉丁按 0.56。 */
function unitsOf(text: string) {
  let units = 0;
  for (const ch of text) units += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 1 : 0.56;
  return Math.max(1, Math.round(units * 100) / 100);
}

/** 连续「句号」→ 秒。句内线性插值，所以拖滚动条时进度是平滑的。 */
function timeForFloat(lines: LyricLine[], float: number, duration: number) {
  if (lines.length === 0) return 0;
  const i = Math.floor(float);
  const frac = float - i;
  const a = lines[Math.min(Math.max(i, 0), lines.length - 1)];
  const b = lines[Math.min(Math.max(i + 1, 0), lines.length - 1)];
  const t = a.time + frac * Math.max(0, b.time - a.time);
  return duration > 0 ? Math.min(t, duration - 0.05) : t;
}

/**
 * 「正在播放」板块的主体：3D 隧道 + 歌词环 + 滚动轨道。
 *
 * 滚动就是播放进度：播放时滚动位置自动跟着走，用户一滚就反过来 seek 歌曲。
 * 环只有 6 个槽，槽 k 显示第 (当前句 + k) 句；每前进一句，槽内容整体后移一位、
 * 角度归零 —— 所以永远接得上「正在唱的那句」，不会有回到第一句的瞬间。
 */
export default function LyricStage({
  lines,
  live,
  playing,
  duration,
  title,
  seek,
  onLineChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const rotationsRef = useRef<HTMLDivElement[]>([]);

  /** 槽内容需要跟着「当前句」重渲染，所以 base 走 state（每句一次，很便宜） */
  const [base, setBase] = useState(0);
  const baseRef = useRef(0);

  const linesRef = useRef(lines);
  const playingRef = useRef(playing);
  const durationRef = useRef(duration);
  const seekRef = useRef(seek);
  const lastInputRef = useRef(0);
  const lastSeekRef = useRef(0);

  useEffect(() => {
    linesRef.current = lines;
    playingRef.current = playing;
    durationRef.current = duration;
    seekRef.current = seek;
    // 换歌时把当前句号往下压一位，下一帧 rAF 会按新的 float 重新定基，
    // 不需要在这里 setState（React Compiler 会为此报 set-state-in-effect）。
    baseRef.current = -1;
  }, [lines, playing, duration, seek]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    rotationsRef.current = Array.from(root.querySelectorAll<HTMLDivElement>(".rotation.axis"));
    if (ringRef.current) {
      ringRef.current.style.transform = "rotateX(0deg)";
    }
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const markInput = () => {
      lastInputRef.current = performance.now();
    };
    const events: (keyof HTMLElementEventMap)[] = ["wheel", "touchstart", "touchmove", "keydown", "pointerdown"];
    for (const name of events) scroller.addEventListener(name, markInput, { passive: true });
    return () => {
      for (const name of events) scroller.removeEventListener(name, markInput);
    };
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let frame = 0;
    const tick = () => {
      const list = linesRef.current;
      const viewport = window.innerHeight || 1;

      const now = performance.now();
      const userDriving = !playingRef.current || now - lastInputRef.current < HANDOFF_MS;
      const maxScroll = Math.max(0, scroller.scrollHeight - viewport);

      let float: number;
      if (userDriving || list.length === 0) {
        float = viewport > 0 ? scroller.scrollTop / viewport : 0;
      } else {
        float = lineFloatAt(list, live.current?.time ?? 0);
        const target = Math.min(maxScroll, Math.max(0, float * viewport));
        if (Math.abs(target - scroller.scrollTop) > 0.5) {
          scroller.scrollTop = target;
        }
      }

      // 最后一句停在它自己的下标上（滚动轨道也只有 length-1 屏）
      float = Math.max(0, Math.min(list.length > 0 ? list.length - 1 : 0, float));

      // 用户拖动 / 暂停时，反手把歌曲 seek 过去
      if (userDriving && list.length > 0 && now - lastSeekRef.current > 120) {
        const target = timeForFloat(list, float, durationRef.current);
        const current = live.current?.time ?? 0;
        if (Math.abs(target - current) > 0.25) {
          lastSeekRef.current = now;
          seekRef.current(target);
        }
      }

      const index = list.length > 0 ? Math.floor(float) : 0;
      const frac = list.length > 0 ? float - index : 0;

      // ---- 伪循环：环只转「当前句那一格」，跨句时靠槽内容整体后移来接上 ----
      // 环角度与每槽透明度都由 rAF 直接写 DOM（不走 React），槽自身的角度是常量。
      const turn = turnAmount(frac);
      if (ringRef.current) {
        ringRef.current.style.transform = `rotateX(${-STEP_DEG * turn}deg)`;
      }
      for (const k of SLOT_KEYS) {
        const node = slotRefs.current[k];
        if (node) node.style.opacity = String(slotOpacity(k, frac, turn));
      }

      // ---- 隧道（建筑 / 路灯）跟着整首歌的进度转一圈 ----
      const total = durationRef.current;
      const progress = total > 0 ? Math.min(1, (live.current?.time ?? 0) / total) : 0;
      const spin = -180 + 345 * progress;
      for (const node of rotationsRef.current) {
        node.style.transform = `rotateX(${spin}deg) rotateY(0deg) rotateZ(0deg)`;
      }

      if (index !== baseRef.current) {
        baseRef.current = index;
        setBase(index);
        onLineChange?.(index);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [live, onLineChange]);

  const spacerHeight = `${Math.max(1, lines.length) * 100}vh`;

  return (
    <div className="player-tunnel" ref={rootRef}>
      <div className="camera">
        <div className="axis" />
        <BuildingRing side="left" />
        <BuildingRing side="right" />
        <LampRing side="left" />
        <LampRing side="right" />
        <CloudRing />

        <div className="pages tilt axis">
          <div className="pages rotate axis" ref={ringRef}>
            {SLOT_KEYS.map((k) => {
              const line = lines[base + k];
              return (
                <div
                  key={k}
                  className="angle axis"
                  ref={(node) => {
                    slotRefs.current[k] = node;
                  }}
                  style={{
                    transform: `rotateX(${k * STEP_DEG}deg)`,
                    transformStyle: "preserve-3d",
                    opacity: slotOpacity(k, 0, 0),
                  }}
                >
                  <div className="lyric-slot">
                    {line ? (
                      <>
                        <div
                          className="lyric-line"
                          style={{ ["--units" as string]: unitsOf(line.text) }}
                        >
                          {line.text}
                        </div>
                        {line.translation ? (
                          <div
                            className="lyric-translation"
                            style={{ ["--units" as string]: unitsOf(line.translation) }}
                          >
                            {line.translation}
                          </div>
                        ) : null}
                      </>
                    ) : k === 0 ? (
                      <div className="lyric-placeholder">
                        {lines.length === 0 ? `${title} · 暂无歌词` : "· · ·"}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="world axis" />
      </div>

      <div className="now-scroller" ref={scrollerRef}>
        <div className="now-track-spacer" style={{ height: spacerHeight }} />
      </div>
    </div>
  );
}
