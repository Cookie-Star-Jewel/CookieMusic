"use client";

/**
 * 过渡决策：把 A（退场曲）/ B（进场曲）的「歌词剖面 + 能量剖面」翻译成一份
 * 可执行的过渡计划（时长、退场曲塑形、进场曲引导）。
 *
 * ⚠️ 能力边界（必须知道，否则会以为实现错了）：
 * 本模块**不做音源分离**。spec 里「B 伴奏先淡入、B 人声后进」「A 的鼓和贝斯先走」
 * 「B 只先淡入 pad」这类要求，需要把一首歌拆成人声/鼓/贝斯/pad 分轨（demucs 之类的
 * AI 分轨），Web Audio 做不到，也违背「不引入重型音频库」的约束。
 * 这里用**低通塑形**做听感近似：把 B 的入场先压暗（听起来像伴奏铺底）再逐渐放开；
 * 把 A 的尾段低通下扫（低频先消失，听感上"鼓和贝斯先走"）。**这是近似，不是分轨。**
 */

import type { SongData } from "./lyrics";

/** 最后一句歌词唱完的估算尾巴（秒）——LRC 只有句首没有句尾，只能估。 */
export const VOCAL_TAIL_S = 4;
/** 判定"长间隙"的阈值（秒）：超过它的歌词缝是天然过渡窗口。 */
export const GAP_THRESHOLD_S = 4;
/** 低通扫频的下限（Hz）与混响湿声上限。 */
const LP_MUFFLED = 800;
const WET_MAX = 0.45;

export interface LyricProfile {
  /** 有人声（= 有同步歌词） */
  hasVocal: boolean;
  /** 第一句歌词的时间（无词为 0） */
  vocalStart: number;
  /** 估算的"最后一句唱完"时间（最后一句 + VOCAL_TAIL_S） */
  vocalEnd: number;
  /** 每句 [起, 止]（秒） */
  spans: [number, number][];
  /** 超过 GAP_THRESHOLD_S 的歌词间隙 */
  gaps: [number, number][];
  /** 最后一句唱完到曲末的尾奏长度（秒） */
  outro: number;
}

export interface EnergyProfile {
  /** 0..1 归一化能量分（响度 + 频谱亮度加权） */
  score: number;
  /** 是否来自真实波形分析（false = 启发式估计） */
  measured: boolean;
  source: "spectrum" | "heuristic";
}

export interface TransitionPlan {
  /** 过渡总时长（秒） */
  duration: number;
  /** 退场曲（A）尾段是否加低通扫频 + 混响 */
  tail: boolean;
  /** 低通扫频终点（Hz） */
  lpTo: number;
  /** 混响湿声终点 */
  wetTo: number;
  /** 进场曲（B）入场是否先压暗再放开（近似"伴奏先淡入"） */
  leadLowpass: boolean;
  /** 决策原因（排查用） */
  reason: string;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 从 SongData 提炼歌词剖面。
 * 判"有人声"的依据：`times.length >= 2`。`buildSongData` 在完全没有歌词时只产
 * 一行占位（`♪ 歌名`），times 长度就是 1，正好可区分。
 */
export function analyzeLyrics(song: SongData, duration: number): LyricProfile {
  const hasVocal = song.times.length >= 2 && !song.lines[0]?.startsWith("♪ ");
  if (!hasVocal) {
    return {
      hasVocal: false,
      vocalStart: 0,
      vocalEnd: 0,
      spans: [],
      gaps: [],
      outro: Math.max(duration, 0),
    };
  }

  const times = song.times;
  const last = times[times.length - 1];
  const spans: [number, number][] = [];
  const gaps: [number, number][] = [];
  for (let i = 0; i < times.length; i += 1) {
    const start = times[i];
    const end = i + 1 < times.length ? times[i + 1] : start + VOCAL_TAIL_S;
    spans.push([start, end]);
    if (i + 1 < times.length && times[i + 1] - start > GAP_THRESHOLD_S) {
      gaps.push([start, times[i + 1]]);
    }
  }

  return {
    hasVocal: true,
    vocalStart: times[0],
    vocalEnd: last + VOCAL_TAIL_S,
    spans,
    gaps,
    outro: Math.max(duration - (last + VOCAL_TAIL_S), 0),
  };
}

/**
 * 决策入口。
 *
 * 规则（对应 spec 的四种组合 + 能量分支）：
 * - A有词 + B有词：短交叉（6s），避免两句人声叠太久
 * - A有词 + B纯音乐：7s，A 人声加混响飘走（尾段低通 + wet 拉满）
 * - A纯音乐 + B有词：8s，B 入场先压暗再放开（近似"伴奏先淡入"）
 * - 都纯音乐：8s 起步，A 尾奏 > 20s 直接拉到 12s
 * - 能量差大（≥0.35）：时长拉到 10~16s，A 尾段低通 + 混响，B 压暗入场
 *
 * BPM 分支按约定不做：本机没有可靠的 beat grid，强行对齐比不对齐更糟，
 * 一律用氛围重叠（见 A2 默认）。
 */
export function decideTransition(
  a: { lyrics: LyricProfile; energy: EnergyProfile },
  b: { lyrics: LyricProfile; energy: EnergyProfile },
): TransitionPlan {
  const diff = Math.abs(a.energy.score - b.energy.score);
  const bigEnergy = diff >= 0.35;

  let duration: number;
  const bits: string[] = [];

  if (a.lyrics.hasVocal && b.lyrics.hasVocal) {
    duration = 6;
    bits.push("A有词+B有词→短交叉");
  } else if (a.lyrics.hasVocal && !b.lyrics.hasVocal) {
    duration = 7;
    bits.push("A有词+B纯音乐→人声飘走");
  } else if (!a.lyrics.hasVocal && b.lyrics.hasVocal) {
    duration = 8;
    bits.push("A纯音乐+B有词→B压暗入场");
  } else {
    duration = a.lyrics.outro > 20 ? 12 : 8;
    bits.push(a.lyrics.outro > 20 ? "都纯音乐+长尾奏→12s" : "都纯音乐→8s");
  }

  if (bigEnergy) {
    duration = a.lyrics.hasVocal ? 12 : 10;
    if (!b.lyrics.hasVocal && a.lyrics.outro > 20) duration = 16;
    bits.push(`能量差大(${diff.toFixed(2)})→拉长`);
  }

  duration = clamp(duration, 4, 16);

  // 退场曲塑形：只要有真实人声、或能量差大、或双方纯音乐，就让它"飘走"
  const tail = a.lyrics.hasVocal || bigEnergy || !b.lyrics.hasVocal;
  const lpTo = tail ? (bigEnergy ? LP_MUFFLED : 2000) : 20000;
  const wetTo = tail ? (bigEnergy ? WET_MAX : 0.3) : 0;

  // 进场曲压暗：能量差大、或 A 纯音乐而 B 有词（近似"伴奏先淡入"）
  const leadLowpass = bigEnergy || (!a.lyrics.hasVocal && b.lyrics.hasVocal);

  if (!a.energy.measured || !b.energy.measured) {
    bits.push("能量含启发式估计");
  }

  return { duration, tail, lpTo, wetTo, leadLowpass, reason: bits.join(" / ") };
}
