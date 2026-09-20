import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Track } from "./track";

export type { Track };

/**
 * Local music library.
 *
 * The browser cannot read arbitrary paths, so the Next server does the file
 * work and exposes three read-only endpoints. Every path coming back from the
 * client is an opaque id; it is decoded and re-validated against MUSIC_ROOTS
 * before a single byte is read.
 */

export const AUDIO_EXTENSIONS = [".mp3", ".flac", ".wav", ".m4a", ".ogg", ".ape", ".aac", ".wma"];

const DEFAULT_ROOTS = [path.join(os.homedir(), "Music"), "D:\\Music", "E:\\Music"];
const MAX_DEPTH = 4;

function configuredRoots() {
  const raw = process.env.MUSIC_ROOTS;
  if (raw && raw.trim()) {
    return raw.split(path.delimiter).map((r) => path.resolve(r.trim())).filter(Boolean);
  }
  return DEFAULT_ROOTS.map((r) => path.resolve(r));
}

export function roots() {
  return configuredRoots();
}

export function encodeId(absolutePath: string) {
  return Buffer.from(absolutePath, "utf8").toString("base64url");
}

export function decodeId(id: string): string | null {
  let decoded: string;
  try {
    decoded = Buffer.from(id, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded) return null;
  const absolute = path.resolve(decoded);
  const allowed = configuredRoots().some((root) => {
    const rel = path.relative(root, absolute);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
  return allowed ? absolute : null;
}

/** `七里香 - 周杰伦.flac` -> { title: '七里香', artist: '周杰伦' } */
function splitName(base: string) {
  const cleaned = base.replace(/\s*\(\d+\)$/, "").trim();
  const parts = cleaned.split(" - ");
  if (parts.length >= 2) {
    return { title: parts.slice(0, -1).join(" - ").trim(), artist: parts.at(-1)!.trim() };
  }
  return { title: cleaned, artist: "" };
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string, depth: number, out: string[]) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, depth + 1, out);
    } else if (AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

let cache: { at: number; tracks: Track[] } | null = null;
const CACHE_MS = 15_000;

export async function scanLibrary(force = false): Promise<Track[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.tracks;

  const files: string[] = [];
  for (const root of configuredRoots()) {
    if (await exists(root)) await walk(root, 0, files);
  }

  const tracks: Track[] = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file, ext);
    const { title, artist } = splitName(base);
    let sizeMB = 0;
    try {
      sizeMB = (await fs.stat(file)).size / 1048576;
    } catch {
      continue;
    }
    const lyric = path.join(path.dirname(file), `${base}.lrc`);
    tracks.push({
      id: encodeId(file),
      title,
      artist,
      album: path.basename(path.dirname(file)),
      ext: ext.slice(1).toUpperCase(),
      sizeMB: Math.round(sizeMB * 10) / 10,
      folder: path.dirname(file),
      hasLyric: await exists(lyric),
      hasTranslation: await exists(path.join(path.dirname(file), `${base}.tlyric.lrc`)),
    });
  }

  tracks.sort(
    (a, b) => a.folder.localeCompare(b.folder, "zh") || a.title.localeCompare(b.title, "zh"),
  );
  cache = { at: Date.now(), tracks };
  return tracks;
}

export async function readLyricFiles(audioPath: string) {
  const ext = path.extname(audioPath);
  const base = audioPath.slice(0, -ext.length);
  const main = `${base}.lrc`;
  const translation = `${base}.tlyric.lrc`;

  let lrc: string | null = null;
  try {
    lrc = await fs.readFile(main, "utf8");
  } catch {
    lrc = null;
  }

  let tlyric: string | null = null;
  if (await exists(translation)) {
    try {
      tlyric = await fs.readFile(translation, "utf8");
    } catch {
      tlyric = null;
    }
  }
  return { lrc, tlyric };
}

/**
 * 从音乐库删除一首歌：删除音频文件与同名 .lrc 歌词。
 * id 经 decodeId 反解并校验 MUSIC_ROOTS 白名单，防止越权路径删除。
 */
export async function deleteTrack(id: string): Promise<{ error?: string }> {
  const audio = decodeId(id);
  if (!audio) return { error: "无效或越界的文件路径" };
  try {
    await fs.unlink(audio);
  } catch {
    return { error: "删除失败：文件不存在或被占用" };
  }
  const lyric = audio.replace(/\.[^.]+$/, ".lrc");
  try {
    await fs.unlink(lyric);
  } catch {
    /* 没有歌词文件就直接跳过 */
  }
  cache = null;
  return {};
}
