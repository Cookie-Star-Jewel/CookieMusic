/**
 * 歌词 + 歌曲同步映射（支持任意歌曲动态驱动隧道）。
 *
 * 隧道里的五块文字面板按滚动位置 s（单位：圈）轮播歌词行：每前进 1/5 圈
 * （72°），正对镜头的面板推进到下一句。行数组补齐到 5 的倍数（最后一句
 * 重复，对应器乐尾奏），一首歌正好对应 rows/5 圈隧道；歌曲循环回开头的
 * 瞬间，旋转与歌词同时回绕，视觉无缝。
 *
 * 歌曲时间与滚动圈数的对应：第 k 句在 s = k/5 时正对镜头（即该句的时间戳
 * τ_k 映射到 s = k/5），句与句之间线性插值。这样正面面板永远唱着"当前句"，
 * 与音频精确同步。
 */

import type { Lyrics } from "@/lib/lrc";

/** 一首可播放歌曲的全部驱动数据。 */
export interface SongData {
  title: string;
  artist: string;
  /** 音频地址：/api/audio?id=... 或本地导入的 blob: URL */
  audioUrl: string;
  /** 面板行数组（已补齐到 5 的倍数）。 */
  lines: string[];
  /** 每行的时间戳（秒），与补齐前的行一一对应，长度 >= 1。 */
  times: number[];
  /** 补齐后的总行数（5 的倍数）。 */
  count: number;
  /** 最后一句真实歌词的索引（times.length - 1）。 */
  lastK: number;
  /** 一首歌 = 多少圈隧道（count / 5）。 */
  loopsPerCycle: number;
  /** 音频 metadata 加载前的兜底时长（秒）。 */
  fallbackDuration: number;
}

/**
 * 用原始歌词行 + 时间戳构建 SongData。
 * - 行数补齐到 5 的倍数：结尾重复最后一句，对应尾奏；
 * - 没有时间戳（或数量不匹配）时按兜底时长均匀分布；
 * - 完全没有歌词时，五块面板都显示 "♪ 歌名"，滚动随进度匀速前进一圈。
 */
export function buildSongData(
  rawLines: string[],
  rawTimes: number[],
  fallbackDuration: number,
  audioUrl: string,
  title: string,
  artist = "",
): SongData {
  const lines = rawLines.length > 0 ? rawLines : [`♪ ${title}`];
  const hasTimes =
    rawTimes.length === lines.length &&
    rawTimes.length > 0 &&
    rawTimes.every((t) => Number.isFinite(t) && t >= 0) &&
    rawTimes.every((t, i) => i === 0 || t >= rawTimes[i - 1]);
  const times = hasTimes
    ? rawTimes.slice()
    : lines.map((_, i) => (fallbackDuration * i) / lines.length);

  const count = Math.max(5, Math.ceil(lines.length / 5) * 5);
  const padded = [
    ...lines,
    ...Array.from({ length: count - lines.length }, () => lines[lines.length - 1]),
  ];

  return {
    title,
    artist,
    audioUrl,
    lines: padded,
    times,
    count,
    lastK: times.length - 1,
    loopsPerCycle: count / 5,
    fallbackDuration: hasTimes
      ? Math.max(fallbackDuration, times[times.length - 1] + 3)
      : fallbackDuration,
  };
}

/** 从解析好的 LRC（/api/lyric 或本地 .lrc 文件）构建 SongData，过滤 credits 行。 */
export function songDataFromLyrics(
  lyrics: Lyrics,
  fallbackDuration: number,
  audioUrl: string,
  title: string,
  artist = "",
): SongData {
  const real = lyrics.lines.filter((line) => !line.credit && line.text.trim());
  const synced = real.length >= 2 && real.some((line) => line.time > 0);
  const finalTitle = title || lyrics.meta.ti || "未知歌曲";
  const finalArtist = artist || lyrics.meta.ar || "";
  if (!synced) {
    return buildSongData([], [], fallbackDuration, audioUrl, finalTitle, finalArtist);
  }
  return buildSongData(
    real.map((line) => line.text),
    real.map((line) => line.time),
    fallbackDuration,
    audioUrl,
    finalTitle,
    finalArtist,
  );
}

/* ------------------------------------------------------------------ *
 * 默认歌曲：The Show - Lenka
 * 来源：本地音乐库 The Show - Lenka.lrc（自带曲目，跳过开头 作词/作曲 credits 元数据）
 * ------------------------------------------------------------------ */

/** 歌曲音频（本地音乐库直读，id 为该曲文件名的 base64url，需本机存在对应文件）。 */
export const SONG_AUDIO_URL =
  "/api/audio?id=RTpcTVVTSUNcVGhlIFNob3cgLSBMZW5rYS5mbGFj";

const SONG_LINES: string[] = [
  "I'm just a little bit",
  "Caught in the middle",
  "Life is a maze",
  "And love is a riddle",
  "I don't know where to go",
  "Can't do it alone",
  "I've tried",
  "And I don't know why",
  "Slow it down",
  "Make it stop",
  "Or else my heart is going to pop",
  "Cause it's too much",
  "Yeah it's a lot",
  "To be something I'm not",
  "I'm a fool",
  "Out of love",
  "Cause I just can't get enough",
  "I'm just a little bit",
  "Caught in the middle",
  "Life is a maze",
  "And love is a riddle",
  "I don't know where to go",
  "can't do it alone",
  "I've tried",
  "And I don't know why",
  "I am just a little girl",
  "Lost in the moment",
  "I'm so scared",
  "But I don't show it",
  "I can't figure it out",
  "It's bringing me down",
  "I know",
  "I've got to let it go",
  "And just enjoy the show",
  "The sun is hot",
  "In the sky",
  "Just like a giant spotlight",
  "The people follow the sign",
  "And synchronize in time",
  "It's a joke",
  "Nobody knows",
  "They've got a ticket to that show",
  "Yeah",
  "I'm just a little bit",
  "Caught in the middle",
  "Life is a maze",
  "And love is a riddle",
  "I don't know where to go",
  "can't do it alone",
  "I've tried",
  "And I don't know why",
  "I am just a little girl",
  "Lost in the moment",
  "I'm so scared",
  "But I don't show it",
  "I can't figure it out",
  "It's bringing me down",
  "I know",
  "I've got to let it go",
  "And just enjoy the show",
  "Oh oh",
  "Just enjoy the show",
  "Oh oh",
  "I'm just a little bit",
  "Caught in the middle",
  "Life is a maze",
  "And love is a riddle",
  "I don't know where to go",
  "can't do it alone",
  "I've tried",
  "And I don't know why",
  "I am just a little girl",
  "Lost in the moment",
  "I'm so scared",
  "But I don't show it",
  "I can't figure it out",
  "It's bringing me down",
  "I know",
  "I've got to let it go",
  "And just enjoy the show",
  "Dum de dum",
  "Dudum de dum",
  "Just enjoy the show",
  "Dudum de dum",
  "Dudum de dum",
  "Just enjoy the show",
  "I want my money back",
  "I want my money back",
  "I want my money back",
  "Just enjoy the show",
  "I want my money back",
  "I want my money back",
  "I want my money back",
  "Just enjoy the show",
];

/** 每句的时间戳（秒），与 SONG_LINES 一一对应。 */
const SONG_TIMES: number[] = [
1.26, 3.18, 4.84, 7.06, 8.86, 11.56, 13.31, 14.71, 21.58, 23.57, 25.42, 29.34, 31.28, 34.14, 37.3, 39.17, 41.48, 47.93, 49.99, 51.68, 53.73, 55.63, 58.34, 60.11, 61.51, 63.87, 65.6, 67.33, 69.29, 71.23, 74.22, 75.74, 77.06, 81.61, 83.92, 85.98, 87.93, 91.82, 96.57, 99.79, 101.63, 103.96, 109.9, 110.67, 112.45, 114.25, 116.18, 118.04, 120.76, 122.6, 124.01, 126.37, 128.03, 129.8, 131.84, 133.64, 136.59, 138.16, 139.57, 144.13, 149.4, 152.02, 157.23, 161.06, 163.16, 164.95, 166.91, 168.89, 171.42, 173.25, 174.69, 176.88, 178.67, 180.42, 182.46, 184.46, 187.35, 188.93, 190.21, 194.88, 197.33, 199.15, 202.18, 205.08, 206.88, 209.99, 212.53, 214.22, 216.14, 217.8, 220.26, 222, 223.79, 225.78,
];

/** 页面初始默认歌曲。 */
export const DEFAULT_SONG: SongData = buildSongData(
  SONG_LINES,
  SONG_TIMES,
  235.69,
  SONG_AUDIO_URL,
  "The Show",
  "Lenka",
);

/* ------------------------------------------------------------------ *
 * 面板 / 时间映射（全部由 SongData 参数化）
 * ------------------------------------------------------------------ */

/**
 * 面板 j（0..4，对应 page_a..page_e）在滚动位置 s（单位：圈，可无限增大或为负）时显示的行。
 *
 * 几何：面板 j 在 s ≡ 0.2j 时正对镜头。文字只在面板转到隧道背面
 * （s ≡ 0.2j + 0.5，离镜头最远）时才切换到下一批，避免正面的文字可见地跳变。
 * 每圈展示 5 行（j=0..4 各一行），一首歌 loopsPerCycle 圈正好轮完全部行。
 */
export function lyricLineForPanel(j: number, s: number, song: SongData): string {
  const index = 5 * Math.floor(s - 0.2 * j + 0.5) + j;
  return song.lines[((index % song.count) + song.count) % song.count];
}

/**
 * 歌曲时间 t（秒）→ 滚动位置 s（圈，0..loopsPerCycle）。
 * 前奏（第一句之前）保持 s = 0（第一句提前在正面待命）；句间线性插值；
 * 尾奏从最后一句匀速转到周期末尾。
 */
export function scrollFromTime(t: number, duration: number, song: SongData): number {
  const { times, lastK, count } = song;
  if (t <= times[0]) return 0;
  for (let k = 0; k < lastK; k += 1) {
    if (t < times[k + 1]) {
      return (k + (t - times[k]) / (times[k + 1] - times[k])) / 5;
    }
  }
  const tail = Math.max(duration, times[lastK] + 1) - times[lastK];
  const frac = Math.min(Math.max((t - times[lastK]) / tail, 0), 1);
  return (lastK + frac * (count - lastK)) / 5;
}

/**
 * 滚动位置 s（圈，任意实数）→ 歌曲时间 t（秒，0..duration）。
 * scrollFromTime 的逆映射；s 先折算到 0..loopsPerCycle，滚动越过周期
 * 边界等价于歌曲从头/从尾循环。
 */
export function timeFromScroll(s: number, duration: number, song: SongData): number {
  const { times, lastK, count, loopsPerCycle } = song;
  const sc = ((s % loopsPerCycle) + loopsPerCycle) % loopsPerCycle;
  if (sc <= 0) return 0;
  for (let k = 0; k < lastK; k += 1) {
    const hi = (k + 1) / 5;
    if (sc < hi) {
      const frac = (sc - k / 5) * 5;
      return times[k] + frac * (times[k + 1] - times[k]);
    }
  }
  const tail = Math.max(duration, times[lastK] + 1) - times[lastK];
  const frac = Math.min(((sc - lastK / 5) * 5) / (count - lastK), 1);
  return times[lastK] + frac * tail;
}
