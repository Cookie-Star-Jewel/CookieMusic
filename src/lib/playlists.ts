"use client";

/**
 * 我的歌单 —— localStorage 数据层。
 *
 * 歌单存歌曲快照，两种来源：
 * - GD 搜索歌：source="netease" 等，点播时用 id+source 临时取 GD 直链；
 * - 本地曲库歌：source="local"，id 为曲库文件 id，点播走 /api/audio。
 * 清缓存/换浏览器会丢。
 */

export interface PlaylistSong {
  /** GD 歌曲 id（netease 等）；本地曲库歌为曲库文件 id */
  id: string;
  /** "netease" 等 GD 来源；"local" = 本地曲库歌 */
  source: string;
  name: string;
  artist: string;
  /** 秒；未知（本地歌）为 0 */
  duration: number;
  /** 仅本地歌：曲库里有没有配套 .lrc（决定点播时是否拉歌词） */
  hasLyric?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  songs: PlaylistSong[];
  /** 创建时间，用于排序 */
  createdAt: number;
  /** 本歌单的循环模式；缺省按列表循环（每张歌单独立记忆） */
  loopMode?: LoopMode;
}

const STORAGE_KEY = "karl_playlists_v1";

/**
 * 歌单循环模式：list=列表循环 / random=随机循环 / single=单曲循环
 */
export type LoopMode = "list" | "random" | "single";

export const LOOP_MODES: { value: LoopMode; label: string }[] = [
  { value: "list", label: "列表循环" },
  { value: "random", label: "随机循环" },
  { value: "single", label: "单曲循环" },
];

export const LOOP_MODE_STORAGE_KEY = "karl_loop_mode";

/* ---------------- 双存储：localStorage（即时） + 音乐目录文件（持久） ----------------
 * localStorage 随应用卸载被清 → 歌单曾因此丢失。
 * 现在每次写操作同时推送到 /api/playlists（落盘 E:\MUSIC\.pixelmusic\playlists.json）；
 * 启动时以服务端文件为权威源拉取（重装后自动恢复），服务端为空则把本地数据迁移上去。
 * 全程对 UI 透明：函数签名不变，拉取完成后派发 playlists-changed 触发刷新。
 * -------------------------------------------------------------------------------- */

let cache: Playlist[] | null = null;
let bootstrapped = false;

function readLocal(): Playlist[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Playlist[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function pullFromServer(): Promise<Playlist[] | null> {
  try {
    const res = await fetch("/api/playlists", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { playlists?: Playlist[] };
    return Array.isArray(j.playlists) ? j.playlists : null;
  } catch {
    return null;
  }
}

function pushToServer(all: Playlist[]) {
  void fetch("/api/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playlists: all }),
  }).catch(() => {
    /* 推送失败不阻塞：本地仍有一份，下次写操作会再推 */
  });
}

async function bootstrap() {
  const remote = await pullFromServer();
  if (remote === null) return; // 服务端不可用：继续用本地
  const local = readLocal();
  if (remote.length > 0) {
    // 服务端为权威（覆盖重装后的空 localStorage）
    cache = remote;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
    }
  } else if (local.length > 0) {
    // 服务端空、本地有 → 一次性迁移上去
    cache = local;
    pushToServer(local);
  } else {
    cache = [];
  }
  window.dispatchEvent(new Event("playlists-changed"));
}

function ensureCache(): Playlist[] {
  if (cache === null) {
    cache = readLocal();
    if (!bootstrapped) {
      bootstrapped = true;
      void bootstrap();
    }
  }
  return cache;
}

export function listPlaylists(): Playlist[] {
  return ensureCache();
}

function save(all: Playlist[]) {
  cache = all;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
  pushToServer(all);
}

function makeId(): string {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createPlaylist(name: string): Playlist | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "歌单名不能为空" };
  const all = listPlaylists();
  if (all.some((pl) => pl.name === trimmed)) return { error: "已有同名歌单" };
  const playlist: Playlist = { id: makeId(), name: trimmed, songs: [], createdAt: Date.now() };
  save([...all, playlist]);
  return playlist;
}

export function deletePlaylist(id: string) {
  save(listPlaylists().filter((pl) => pl.id !== id));
}

export function renamePlaylist(id: string, name: string): { error?: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "歌单名不能为空" };
  const all = listPlaylists();
  if (all.some((pl) => pl.id !== id && pl.name === trimmed)) return { error: "已有同名歌单" };
  save(all.map((pl) => (pl.id === id ? { ...pl, name: trimmed } : pl)));
  return {};
}

export function addToPlaylist(id: string, song: PlaylistSong): { error?: string } {
  const all = listPlaylists();
  const target = all.find((pl) => pl.id === id);
  if (!target) return { error: "歌单不存在" };
  if (target.songs.some((s) => s.id === song.id && s.source === song.source)) {
    return { error: "已在歌单里" };
  }
  target.songs.push(song);
  save(all);
  return {};
}

export function removeFromPlaylist(id: string, songId: string) {
  save(
    listPlaylists().map((pl) =>
      pl.id === id ? { ...pl, songs: pl.songs.filter((s) => s.id !== songId) } : pl,
    ),
  );
}

/** 设置单张歌单的循环模式（每张歌单独立记忆）；派发变更事件让面板即时刷新 */
export function setPlaylistLoopMode(id: string, mode: LoopMode) {
  save(
    listPlaylists().map((pl) => (pl.id === id ? { ...pl, loopMode: mode } : pl)),
  );
  window.dispatchEvent(new Event("playlists-changed"));
}
