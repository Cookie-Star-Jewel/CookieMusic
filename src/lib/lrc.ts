/**
 * LRC parsing.
 *
 * Handles the shapes the GD downloader actually writes:
 *   [00:27.38] 窗外的麻雀 在电线杆上多嘴
 *   [00:00.000] 作词 : 林秋离          <- credit lines, demoted to metadata
 *   [ar:周杰伦] / [ti:七里香] / [offset:+300]   <- tag lines
 * plus a matched `<base>.tlyric.lrc` translation track.
 */

export interface LyricLine {
  /** seconds */
  time: number;
  text: string;
  /** translation for the same timestamp, when a .tlyric.lrc exists */
  translation?: string;
  /** credit / info line rather than a lyric */
  credit?: boolean;
}

export interface Lyrics {
  lines: LyricLine[];
  meta: Record<string, string>;
  /** true when at least one line carries a timestamp */
  synced: boolean;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[(ar|ti|al|by|offset|length|re|ve):\s*(.*?)\]$/i;
const CREDIT = /^(作词|作曲|编曲|制作人|监制|混音|录音|吉他|贝斯|鼓|和声|母带|出品|发行|词|曲|OP|SP|配唱)\s*[:：]/;

function toSeconds(mm: string, ss: string, frac?: string) {
  const fracValue = frac ? Number(`0.${frac.padEnd(3, "0").slice(0, 3)}`) : 0;
  return Number(mm) * 60 + Number(ss) + fracValue;
}

/** Parse one LRC document into timestamp → text pairs (a line may carry several timestamps). */
function parseTags(source: string) {
  const pairs: { time: number; text: string }[] = [];
  const meta: Record<string, string> = {};

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const metaMatch = line.match(META_TAG);
    if (metaMatch) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    TIME_TAG.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = TIME_TAG.exec(line))) {
      stamps.push(toSeconds(match[1], match[2], match[3]));
      lastEnd = match.index + match[0].length;
    }
    if (stamps.length === 0) continue;

    const text = line.slice(lastEnd).trim();
    for (const time of stamps) pairs.push({ time, text });
  }

  pairs.sort((a, b) => a.time - b.time);
  return { pairs, meta };
}

/**
 * @param lrc   the main lyric file
 * @param tlyric optional translation file, matched by rounded timestamp
 */
export function parseLyrics(lrc: string, tlyric?: string | null): Lyrics {
  const { pairs, meta } = parseTags(lrc);

  const translations = new Map<string, string>();
  if (tlyric) {
    for (const { time, text } of parseTags(tlyric).pairs) {
      translations.set(time.toFixed(2), text);
    }
  }

  const lines: LyricLine[] = [];
  for (const { time, text } of pairs) {
    if (!text) continue;
    lines.push({
      time,
      text,
      translation: translations.get(time.toFixed(2)),
      credit: CREDIT.test(text),
    });
  }

  const offset = Number(meta.offset ?? 0);
  if (Number.isFinite(offset) && offset !== 0) {
    const shift = offset / 1000;
    for (const line of lines) line.time += shift;
  }

  // Credit lines only make sense as a header; anything after the first real
  // lyric is almost always a stray tag, so treat this as a soft signal only.
  const lastRealIndex = lines.reduce((acc, line, index) => (line.credit ? acc : index), -1);
  for (let i = lastRealIndex + 1; i < lines.length; i += 1) {
    if (lines[i].credit) lines[i].credit = true;
  }

  return {
    lines,
    meta,
    synced: lines.some((line) => line.time > 0),
  };
}

/** Index of the line being sung at `time` (seconds). -1 before the first line. */
export function lineIndexAt(lines: LyricLine[], time: number) {
  if (lines.length === 0) return -1;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Continuous position in "lines", with the fraction towards the next line.
 *
 * The last line has no successor to interpolate towards, so it stays pinned at
 * its own index — otherwise it would drift away and fade out while it is still
 * the line being sung (and a one-line lyric would never be readable at all).
 */
export function lineFloatAt(lines: LyricLine[], time: number) {
  const index = lineIndexAt(lines, time);
  if (index < 0) return 0;
  const next = lines[index + 1];
  if (!next) return index;
  const span = next.time - lines[index].time;
  if (span <= 0) return index;
  return index + Math.min(1, Math.max(0, (time - lines[index].time) / span));
}
