"use client";

/**
 * GD 音乐台公共 API 客户端（官方文档版，music-api.gdstudio.xyz）。
 *
 * 2026-09-16 GD 更新后旧站点（music.gdstudio.xyz，POST + jsjiami 签名）下线：
 * 实测本机浏览器对该域名网络层不可达，旧的双域名探测 + 签名链路全部失效
 * —— 表现为「搜不了歌」（pickBase 抛「GD 音乐台无法访问」）。
 *
 * 现走官方文档的免签名公共 API：GET + 查询参数。请求仍从渲染层直连：
 * 该域名在 Cloudflare 后面，对真浏览器放行、对脚本客户端（server fetch/curl）
 * 回 503 挑战页拿不到 JSON；且实测跨域 fetch 可读（CORS 放行，对照 baidu 被拦）。
 *
 * 稳定音乐源：netease / joox / bilibili；频率限制 5 分钟 50 次（正常手动使用碰不到）。
 */

const API_BASE = "https://music-api.gdstudio.xyz/api.php";

/**
 * GET 调 api.php。网络层瞬断（实测偶发 Failed to fetch）重试一次；
 * HTTP 状态错误不重试（重试还是那个码），直接抛给搜索面板显示。
 */
async function gdApi<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${API_BASE}?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`GD API HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err: unknown) {
      if (err instanceof Error && /^GD API HTTP/.test(err.message)) throw err;
      lastError = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("GD 请求失败");
}

/* ---------------- 对外 API（签名不变，调用方无感） ---------------- */

export interface GdSong {
  id: string;
  /** 歌词接口用的 id（官方响应里与下载 id 可能不同） */
  lyricId: string;
  name: string;
  artist: string;
  album: string;
  source: string;
  /** 秒 */
  duration: number;
  hasHires: boolean;
}

/**
 * 对齐旧 gd_core.py 的字段映射。2026-09 公共搜索响应字段：
 * id（=track_id，取歌/歌词正主）、name、artist（数组）、album、pic_id、
 * url_id（文档标注废弃，实测与 id 同值，留作兜底）、lyric_id、source。
 * 旧版的 extra_data（duration / has_hires）已不再返回 → 时长显示「—」。
 */
function normalizeGdSong(raw: Record<string, unknown>, fallbackSource: string): GdSong {
  const extra = (raw.extra_data ?? null) as Record<string, unknown> | null;
  const artist = raw.artist;
  return {
    id: String(raw.id ?? raw.url_id ?? ""),
    lyricId: String(raw.lyric_id ?? raw.id ?? raw.url_id ?? ""),
    name: String(raw.name ?? ""),
    artist: Array.isArray(artist) ? artist.join(", ") : String(artist ?? ""),
    album: String(raw.album ?? ""),
    source: String(raw.source ?? fallbackSource),
    duration: Math.round(Number(extra?.duration ?? raw.duration ?? 0)) || 0,
    hasHires: Boolean(extra?.has_hires ?? raw.has_hires),
  };
}

export async function gdSearch(keyword: string, count = 30): Promise<GdSong[]> {
  const data = await gdApi<Array<Record<string, unknown>>>({
    types: "search",
    name: keyword,
    source: "netease",
    count: String(count),
    pages: "1",
  });
  return Array.isArray(data) ? data.map((raw) => normalizeGdSong(raw, "netease")) : [];
}

export interface GdStreamUrl {
  url: string;
  br: number;
}

export async function gdGetUrl(
  id: string,
  source: string,
  br = 999,
): Promise<GdStreamUrl> {
  const data = await gdApi<GdStreamUrl & { size?: number }>({
    types: "url",
    id,
    source,
    br: String(br),
  });
  if (!data?.url) throw new Error("无可用音源");
  return { url: data.url, br: data.br ?? br };
}

export interface GdLyric {
  lrc: string | null;
  tlyric: string | null;
}

/** 繁转简走 server 端 opencc（/api/gd/t2s），对齐原 gd_core.py 的 to_simplified。 */
async function toSimplified(text: string): Promise<string> {
  try {
    const res = await fetch("/api/gd/t2s", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = (await res.json()) as { ok: boolean; text?: string };
    if (data.ok && typeof data.text === "string") return data.text;
  } catch {
    /* 转换失败就返回原文 */
  }
  return text;
}

export async function gdGetLyric(
  id: string,
  source: string,
  title: string,
  artist: string,
): Promise<GdLyric> {
  try {
    const data = await gdApi<{ lyric?: string; tlyric?: string }>({
      types: "lyric",
      id,
      source,
    });
    if (data?.lyric) {
      const [lrc, tlyric] = await Promise.all([
        toSimplified(data.lyric),
        data.tlyric ? toSimplified(data.tlyric) : Promise.resolve(null),
      ]);
      return { lrc, tlyric };
    }
  } catch {
    /* GD 歌词失败回退 lrclib */
  }
  try {
    const qs = new URLSearchParams({
      track_name: title,
      artist_name: artist.split(",")[0]?.trim() || "",
    });
    const res = await fetch(`https://lrclib.net/api/get?${qs}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return { lrc: null, tlyric: null };
    const data = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string };
    const lrc = data.syncedLyrics || data.plainLyrics || "";
    return lrc ? { lrc, tlyric: null } : { lrc: null, tlyric: null };
  } catch {
    return { lrc: null, tlyric: null };
  }
}
