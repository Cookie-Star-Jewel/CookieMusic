"use client";

/**
 * GD 音乐台前端直连客户端。
 *
 * 为什么是这种形状：api.php 会拒绝非浏览器的 TLS 指纹（Node fetch 实测 401），
 * 但浏览器指纹可直连，且 api.php 的 CORS 完全开放（ACAO:*，实测）。
 * 所以拆成两半：签名由 server 端 node:vm 跑官方混淆脚本（/api/gd/sign，纯计算），
 * 真正的请求从浏览器发出。
 *
 * 双域名自动回退：xyz（满血，需代理）优先，org（国内直连）备用；
 * 上次成功的域名缓存在 localStorage，避免每条请求都先等被墙域名超时。
 */

const BASES = ["https://music.gdstudio.xyz", "https://music.gdstudio.org"];
const BASE_CACHE_KEY = "karl_gd_base";
const SIGN_ENDPOINT = "/api/gd/sign";

let baseInFlight: Promise<string> | null = null;

/** 快速连通性探测（no-cors：resolve 即网络层可达，opaque 响应无所谓）。 */
async function alive(base: string, timeout = 3500): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    await fetch(`${base}/time`, { mode: "no-cors", signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

async function pickBase(): Promise<string> {
  if (baseInFlight) return baseInFlight;
  baseInFlight = (async () => {
    const cached = window.localStorage.getItem(BASE_CACHE_KEY);
    const order = [cached, ...BASES].filter(
      (b, i, arr): b is string => !!b && arr.indexOf(b) === i,
    );
    for (const base of order) {
      if (await alive(base)) {
        window.localStorage.setItem(BASE_CACHE_KEY, base);
        return base;
      }
    }
    throw new Error("GD 音乐台无法访问（检查网络或代理）");
  })();
  try {
    return await baseInFlight;
  } finally {
    baseInFlight = null;
  }
}

function forgetBase() {
  window.localStorage.removeItem(BASE_CACHE_KEY);
}

async function sign(urlencodedInput: string): Promise<string> {
  const res = await fetch(`${SIGN_ENDPOINT}?input=${encodeURIComponent(urlencodedInput)}`);
  const data = (await res.json()) as { ok: boolean; sig?: string; error?: string };
  if (!data.ok || !data.sig) throw new Error(data.error ?? "GD 签名失败");
  return data.sig;
}

/** 调 api.php。失败（签名过期/域名失联）自动换域名重签重试一轮。 */
async function gdApi<T>(params: Record<string, string>): Promise<T> {
  const encoded = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  // 官方算法签的是「urlencoded 后的参数值」（页面 hook 实证 payload 第 4 段为
  // %XX 形态）。sign route 的 searchParams.get 会解码一层，所以这里先
  // encodeURIComponent 成目标形态，route 解码后 signer 拿到的正好是 %XX 形态。
  const signInput = encodeURIComponent(params.name ?? params.id ?? "");
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const base = await pickBase();
    const sig = await sign(signInput);
    try {
      const res = await fetch(`${base}/api.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: [...encoded, `s=${sig}`].join("&"),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      forgetBase(); // 当前域名不可信，下一轮 pickBase 重新探测
    }
  }
  throw lastError ?? new Error("GD 请求失败");
}

/* ---------------- 对外 API（对齐原 /api/gd/* 语义） ---------------- */

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
 * 对齐 gd_core.py 的字段映射：官方 api.php 的 search 响应里
 * 时长/无损标记藏在嵌套的 extra_data，id 有 url_id / lyric_id 两个变体，
 * artist 可能是数组——原样透传会导致时长显示 "—"。
 */
function normalizeGdSong(raw: Record<string, unknown>, fallbackSource: string): GdSong {
  const extra = (raw.extra_data ?? null) as Record<string, unknown> | null;
  const artist = raw.artist;
  return {
    id: String(raw.url_id ?? raw.id ?? ""),
    lyricId: String(raw.lyric_id ?? raw.url_id ?? raw.id ?? ""),
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
  const data = await gdApi<GdStreamUrl & { code?: number }>({
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
