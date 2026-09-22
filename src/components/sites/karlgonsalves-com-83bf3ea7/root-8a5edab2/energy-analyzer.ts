"use client";

/**
 * 能量分析：给"能量差大"这个判定提供一个量化指标。
 *
 * 指标 = 响度（RMS）+ 频谱亮度（过零率 ZCR 作廉价代理）加权。
 * 为什么不用 BPM：需要 beat tracking，脏且重，与"不引入重型音频库"冲突。
 *
 * ⚠️ 只能分析**同源**音源（本地曲库 /api/audio、导入的 blob:）。
 * GD 跨域 CDN 直链既不能 fetch 也不能 decode，只能用启发式估计（见 heuristicEnergy）。
 * 这正是 A1=a 约定：本地做真实分析，在线退化为启发式。
 *
 * 代价与策略：decodeAudioData 要把整首歌解成 float32（5 分钟 ≈ 100MB 常驻），
 * 所以只在**开始播一首歌时后台预分析**、算完立刻丢掉 buffer，结果按 url 缓存。
 */

import { isSameOriginSrc } from "./audio-engine";
import type { EnergyProfile } from "./transition-plan";
import type { SongData } from "./lyrics";

/** 超过这个大小就不解码了（避免一次吃掉几百 MB）。 */
const MAX_DECODE_BYTES = 80 * 1024 * 1024;
/** RMS / ZCR 的归一化参考值（流行乐大致落在这个量级）。 */
const RMS_REF = 0.25;
const ZCR_REF = 0.15;

const cache = new Map<string, EnergyProfile>();
const inflight = new Map<string, Promise<EnergyProfile>>();

let sharedCtx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** 已算好的结果（没有就是 null）。 */
export function getCachedEnergy(url: string): EnergyProfile | null {
  return cache.get(url) ?? null;
}

/**
 * 没测到波形时的保守估计：用"每分钟歌词句数"（演唱密度）当能量代理。
 * 密度高 ≈ 情绪/能量高，对"高能 → 抒情"这类转折仍能给出方向。
 */
export function heuristicEnergy(song: SongData, duration: number): EnergyProfile {
  const lines = song.times.length;
  const perMinute = duration > 0 ? (lines * 60) / duration : 0;
  return {
    score: clamp01(perMinute / 40),
    measured: false,
    source: "heuristic",
  };
}

/** 取一个能量剖面：缓存 → 真实分析（仅同源）→ 启发式。 */
export async function resolveEnergy(
  url: string,
  song: SongData,
  duration: number,
): Promise<EnergyProfile> {
  const hit = cache.get(url);
  if (hit) return hit;

  if (!isSameOriginSrc(url)) {
    const h = heuristicEnergy(song, duration);
    cache.set(url, h);
    return h;
  }

  return analyzeEnergy(url).catch(() => {
    const h = heuristicEnergy(song, duration);
    cache.set(url, h);
    return h;
  });
}

/** 真实波形分析（同源才可用）：RMS + 过零率 → 0..1 能量分。 */
export async function analyzeEnergy(url: string): Promise<EnergyProfile> {
  const hit = cache.get(url);
  if (hit) return hit;
  const running = inflight.get(url);
  if (running) return running;

  const task = (async (): Promise<EnergyProfile> => {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_DECODE_BYTES) throw new Error("文件过大，跳过解码");

    const audio = await ctx().decodeAudioData(buf);
    let sumSq = 0;
    let crossings = 0;
    let prev = 0;
    let count = 0;
    // 双声道取均值即可，指标是相对量
    for (let ch = 0; ch < audio.numberOfChannels; ch += 1) {
      const data = audio.getChannelData(ch);
      for (let i = 0; i < data.length; i += 1) {
        const v = data[i];
        sumSq += v * v;
        if ((v >= 0) !== (prev >= 0)) crossings += 1;
        prev = v;
        count += 1;
      }
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    const zcr = count > 0 ? crossings / count : 0;

    const profile: EnergyProfile = {
      score: clamp01(0.65 * clamp01(rms / RMS_REF) + 0.35 * clamp01(zcr / ZCR_REF)),
      measured: true,
      source: "spectrum",
    };
    cache.set(url, profile);
    return profile;
  })();

  inflight.set(url, task);
  try {
    return await task;
  } finally {
    inflight.delete(url);
  }
}

/** 后台预分析（不阻塞、失败静默）——开始播一首歌时调一次。 */
export function prefetchEnergy(url: string, song: SongData, duration: number): void {
  if (cache.has(url)) return;
  if (!isSameOriginSrc(url)) {
    cache.set(url, heuristicEnergy(song, duration));
    return;
  }
  void analyzeEnergy(url).catch(() => {
    cache.set(url, heuristicEnergy(song, duration));
  });
}
