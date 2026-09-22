"use client";

import { Fragment, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Collapse } from "animal-island-ui";
import type { Track } from "@/lib/track";
import { type SongData } from "./lyrics";
import { gdGetLyric, gdGetUrl, gdSearch, type GdSong } from "@/lib/gd-client";
import {
  LOOP_MODES,
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  removeFromPlaylist,
  setPlaylistLoopMode,
  type Playlist,
  type PlaylistSong,
} from "@/lib/playlists";

/* ================================================================== *
 * 搜索歌曲（顶部抽屉）：GD音乐台在线搜索，animal-island-ui Table + Pagination。
 * 浏览器直连 api.php（签名走 /api/gd/sign，TLS 指纹问题决定了请求必须从
 * 浏览器发）；下载时前端拿 CDN 直链 + 歌词，交给 /api/gd/download 流式落盘
 * （CDN 无指纹校验，server 可下）。搜索结果的字段映射（extra_data.duration、
 * url_id/lyric_id、artist 数组）由 gd-client 的 gdSearch 统一处理。
 * ================================================================== */

interface Job {
  state: "running" | "ok" | "error";
  note: string;
}

const QUALITIES = [
  { br: 999, label: "FLAC 无损" },
  { br: 740, label: "16bit" },
  { br: 320, label: "320K" },
];

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const DOWNLOAD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
  </svg>
);

const PLUS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * 「搜索歌曲」面板。
 * `onPreview` 把在线歌送进主播放器试听（隧道歌词接管），不传则只显示下载。
 */
export function SearchPanel({ onPreview }: { onPreview?: (song: GdSong) => void }) {
  const [keyword, setKeyword] = useState("");
  const [br, setBr] = useState(999);
  const [songs, setSongs] = useState<GdSong[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function search() {
    const q = keyword.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    try {
      const songs = await gdSearch(q, 30);
      setSongs(songs);
      setSearched(true);
      setPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "搜索失败");
      setSongs([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  async function download(song: GdSong) {
    if (jobs[song.id]?.state === "running") return;
    setJobs((prev) => ({ ...prev, [song.id]: { state: "running", note: "下载中…" } }));
    try {
      // 浏览器直连：拿直链 + 歌词（歌词已繁转简），落盘交给 server
      const [{ url, br: gotBr }, lyric] = await Promise.all([
        gdGetUrl(song.id, song.source, br),
        gdGetLyric(song.id, song.source, song.name, song.artist).catch(() => ({
          lrc: null,
          tlyric: null,
        })),
      ]);
      const res = await fetch("/api/gd/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          br: gotBr,
          title: song.name,
          artist: song.artist,
          lrc: lyric.lrc,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        info?: string;
        lyric?: string;
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "下载失败");
      setJobs((prev) => ({
        ...prev,
        [song.id]: {
          state: "ok",
          note: `完成 ${data.info ?? ""} · ${data.lyric ?? ""}`,
        },
      }));
    } catch (err: unknown) {
      setJobs((prev) => ({
        ...prev,
        [song.id]: {
          state: "error",
          note: err instanceof Error ? err.message : "下载失败",
        },
      }));
    }
  }

  const busy = Object.values(jobs).some((job) => job.state === "running");
  const total = songs.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const rows = songs.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div className="animal-table">
      <div className="animal-searchbar">
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
          placeholder="歌名 / 歌手…"
          aria-label="搜索关键词"
        />
        <button
          type="button"
          className="animal-btn"
          onClick={() => void search()}
          disabled={searching}
        >
          {searching ? "搜索中…" : "搜索"}
        </button>
        <div className="animal-seg" role="group" aria-label="下载音质">
          {QUALITIES.map((item) => (
            <button
              key={item.br}
              type="button"
              data-on={br === item.br}
              onClick={() => setBr(item.br)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <table>
        <colgroup>
          <col />
          <col style={{ width: "24%" }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th>歌名</th>
            <th>作曲者</th>
            <th>歌曲时长</th>
            <th className="animal-table-op">播放</th>
            <th className="animal-table-op">下载</th>
          </tr>
        </thead>
        <tbody>
          {searching ? (
            <tr>
              <td colSpan={5} className="animal-table-empty">
                正在搜索…（首次会先探测线路，稍等几秒）
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={5} className="animal-table-empty">
                搜索失败：{error}
              </td>
            </tr>
          ) : !searched ? (
            <tr>
              <td colSpan={5} className="animal-table-empty">
                输入歌名或歌手后回车，搜到直接下载，自动带歌词入库。
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="animal-table-empty">
                没有搜到，换个关键词或歌手名试试。
              </td>
            </tr>
          ) : (
            rows.map((song, index) => {
              const job = jobs[song.id];
              return (
                <tr key={`${song.id}-${index}`}>
                  <td className="animal-table-name">{song.name}</td>
                  <td>{song.artist || "未知"}</td>
                  <td>{fmtDuration(song.duration)}</td>
                  <td className="animal-table-op">
                    <button
                      type="button"
                      className="animal-icon-btn"
                      data-tip-pos="top"
                      data-tip={`试听 ${song.name}`}
                      aria-label={`试听 ${song.name}`}
                      onClick={() => onPreview?.(song)}
                    >
                      {PLAY_ICON}
                    </button>
                  </td>
                  <td className="animal-table-op">
                    <span className="animal-op-group">
                      {job?.state === "running" ? (
                        <span className="animal-status-tag">下载中…</span>
                      ) : job?.state === "ok" ? (
                        <span
                          className="animal-status-tag on"
                          data-tip-pos="top"
                          data-tip={job.note}
                        >
                          已下载
                        </span>
                      ) : job?.state === "error" ? (
                        <button
                          type="button"
                          className="animal-status-tag err btn"
                          data-tip-pos="top"
                          data-tip={job.note}
                          aria-label={`下载失败：${job.note}，点击重新下载`}
                          disabled={busy}
                          onClick={() => void download(song)}
                        >
                          重新下载
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="animal-icon-btn"
                          data-tip-pos="top"
                          data-tip={
                            busy
                              ? "有任务在下载，请稍候"
                              : `下载 ${song.name}（无损缺货自动降 320K）`
                          }
                          aria-label={`下载 ${song.name}`}
                          disabled={busy}
                          onClick={() => void download(song)}
                        >
                          {DOWNLOAD_ICON}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {searched && !error && !searching && total > 0 ? (
        <div className="animal-pagination-wrap">
          <AnimalPagination
            total={total}
            page={current}
            pageSize={pageSize}
            onChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ---------- animal-island-ui Pagination 复刻 ---------- */

function pageItems(page: number, pages: number): (number | "left" | "right")[] {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }
  const items: (number | "left" | "right")[] = [1];
  if (page > 3) items.push("left");
  for (let p = Math.max(2, page - 1); p <= Math.min(pages - 1, page + 1); p += 1) {
    items.push(p);
  }
  if (page < pages - 2) items.push("right");
  items.push(pages);
  return items;
}

const CHEVRON_LEFT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const CHEVRON_RIGHT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

function AnimalPagination({
  total,
  page,
  pageSize,
  onChange,
  onPageSizeChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  onChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const [sizeOpen, setSizeOpen] = useState(false);
  const sizeOptions = [5, 10, 20];

  return (
    <nav className="animal-pagination" aria-label="分页">
      <span className="animal-pagination-total">共 {total} 条</span>
      <button
        type="button"
        className="animal-page-item"
        disabled={page <= 1}
        aria-label="上一页"
        onClick={() => onChange(page - 1)}
      >
        {CHEVRON_LEFT}
      </button>
      {pageItems(page, pages).map((item, i) =>
        typeof item === "number" ? (
          <button
            key={item}
            type="button"
            className={`animal-page-item${item === page ? " active" : ""}`}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ) : (
          <span key={`${item}-${i}`} className="animal-page-ellipsis" aria-hidden="true">
            •••
          </span>
        ),
      )}
      <button
        type="button"
        className="animal-page-item"
        disabled={page >= pages}
        aria-label="下一页"
        onClick={() => onChange(page + 1)}
      >
        {CHEVRON_RIGHT}
      </button>
      <div className="animal-size-changer">
        <button
          type="button"
          className="animal-size-trigger"
          data-open={sizeOpen}
          aria-expanded={sizeOpen}
          aria-haspopup="listbox"
          onClick={() => setSizeOpen((open) => !open)}
        >
          {pageSize} 条/页
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        {sizeOpen && (
          <div className="animal-size-popover" role="listbox">
            {sizeOptions.map((size) => (
              <button
                key={size}
                type="button"
                role="option"
                aria-selected={size === pageSize}
                className={`animal-size-option${size === pageSize ? " current" : ""}`}
                onClick={() => {
                  onPageSizeChange(size);
                  setSizeOpen(false);
                }}
              >
                {size} 条/页
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

/* ================================================================== *
 * 播放列表（右侧抽屉）：本地音乐库真实歌曲（/api/library）。
 * ================================================================== */

export function PlaylistPanel({
  active,
  currentUrl,
  onPlayTrack,
}: {
  /** 抽屉是否打开（首次打开才去拉曲库） */
  active: boolean;
  /** 当前歌曲的音频地址，用来高亮正在播放的行 */
  currentUrl: string;
  /** list 是当前展示顺序（供上一首 / 下一首用） */
  onPlayTrack: (track: Track, list: Track[]) => void;
}) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 曲库内搜索：过滤当前曲库列表（歌名+艺术家） */
  const [filter, setFilter] = useState("");
  /** 删除中的歌（行内转圈） */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function del(track: Track) {
    const hint = track.hasLyric ? "（含同名 .lrc 歌词）" : "";
    if (
      !window.confirm(
        `从硬盘删除「${track.title}」${hint}？\n此操作不可恢复，确定删除吗？`,
      )
    ) {
      return;
    }
    setDeletingId(track.id);
    try {
      const res = await fetch("/api/library/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: track.id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        window.alert(j?.error ?? "删除失败");
        return;
      }
      // 本地立即移除；清空缓存让下次打开重新扫描
      setTracks((cur) => (cur ? cur.filter((t) => t.id !== track.id) : cur));
      setFilter("");
    } finally {
      setDeletingId(null);
    }
  }

  /* ---------- 加入我的歌单（行内浮层） ---------- */
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const [plSnapshot, setPlSnapshot] = useState<Playlist[]>([]);
  const [plName, setPlName] = useState("");
  const [addFeedback, setAddFeedback] = useState<string | null>(null);

  function openAdd(track: Track) {
    if (addTarget === track.id) {
      setAddTarget(null);
      return;
    }
    setPlSnapshot(listPlaylists());
    setPlName("");
    setAddFeedback(null);
    setAddTarget(track.id);
  }

  function add(track: Track, playlistId: string, playlistName: string) {
    const result = addToPlaylist(playlistId, {
      id: track.id,
      source: "local",
      name: track.title,
      artist: track.artist,
      duration: 0,
      hasLyric: track.hasLyric,
    });
    if (result.error) {
      setAddFeedback(result.error);
      return;
    }
    setPlSnapshot(listPlaylists());
    setAddFeedback(`已加入「${playlistName}」`);
    window.dispatchEvent(new Event("playlists-changed"));
    setTimeout(() => {
      setAddTarget(null);
      setAddFeedback(null);
    }, 1200);
  }

  function createAndAdd(track: Track) {
    const result = createPlaylist(plName);
    if ("error" in result) {
      setAddFeedback(result.error);
      return;
    }
    setPlName("");
    add(track, result.id, result.name);
  }

  useEffect(() => {
    if (!active || tracks !== null || error !== null) return;
    let cancelled = false;
    fetch("/api/library")
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<{ tracks: Track[] }>;
      })
      .then((data) => {
        if (!cancelled) setTracks(data.tracks);
      })
      .catch(() => {
        if (!cancelled) setError("曲库加载失败，请确认音乐目录（E:\\MUSIC 等）可读。");
      });
    return () => {
      cancelled = true;
    };
  }, [active, tracks, error]);

  if (error !== null) {
    return (
      <div className="pl-empty">
        {error}
        <br />
        <button
          type="button"
          className="animal-btn"
          onClick={() => {
            setError(null);
            setTracks(null);
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (tracks === null) {
    return <div className="pl-empty">曲库加载中…</div>;
  }

  if (tracks.length === 0) {
    return <div className="pl-empty">曲库是空的，放几首歌进音乐目录吧。</div>;
  }

  const q = filter.trim().toLowerCase();
  const shown = q
    ? tracks.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q))
    : tracks;

  return (
    <div className="pl-list">
      <div className="pl-toolbar">
        <span>
          共 {tracks.length} 首
          {filter.trim() ? ` · 匹配 ${shown.length} 首` : ""}
        </span>
        <button
          type="button"
          className="animal-btn-sm"
          onClick={() => {
            setTracks(null);
            setError(null);
          }}
        >
          重新扫描
        </button>
      </div>
      <div className="pl-search">
        <input
          type="text"
          value={filter}
          placeholder="搜索播放列表里的歌（歌名 / 艺术家）…"
          onChange={(event) => setFilter(event.target.value)}
        />
        {filter ? (
          <button
            type="button"
            className="pl-search-clear"
            data-tip="清除搜索"
            data-tip-pos="top"
            aria-label="清除搜索"
            onClick={() => setFilter("")}
          >
            ✕
          </button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <div className="pl-empty">没有匹配「{filter.trim()}」的歌。</div>
      ) : (
        shown.map((track) => {
        const url = `/api/audio?id=${encodeURIComponent(track.id)}`;
        return (
          <Fragment key={track.id}>
            <div
              className={`pl-row${url === currentUrl ? " current" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onPlayTrack(track, shown)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPlayTrack(track, shown);
                }
              }}
            >
              <span className="pl-status" aria-hidden="true" />
              <span
                className="pl-title"
                data-tip-pos="left"
                data-tip={`${track.title} - ${track.artist}`}
              >
                {track.title}
              </span>
              <span className="pl-artist">{track.artist || "未知艺术家"}</span>
              <span className="pl-meta">
                {track.ext}
                {track.hasLyric ? " · 词" : ""}
              </span>
              <button
                type="button"
                className="pl-del"
                data-tip={`从硬盘删除「${track.title}」`}
                aria-label={`删除 ${track.title}`}
                disabled={deletingId === track.id}
                onClick={(event) => {
                  event.stopPropagation();
                  void del(track);
                }}
              >
                {deletingId === track.id ? "…" : "✕"}
              </button>
              <button
                type="button"
                className="pl-add"
                data-tip={`把「${track.title}」加进歌单`}
                aria-label={`把 ${track.title} 加进歌单`}
                onClick={(event) => {
                  event.stopPropagation();
                  openAdd(track);
                }}
              >
                {PLUS_ICON}
              </button>
            </div>
            {addTarget === track.id ? (
              <div className="plst-add-inline">
                <div className="plst-add-pop">
                  {plSnapshot.length > 0 ? (
                    <div className="plst-add-list">
                      {plSnapshot.map((pl) => (
                        <button
                          key={pl.id}
                          type="button"
                          className="plst-pill"
                          onClick={() => add(track, pl.id, pl.name)}
                        >
                          {pl.name}（{pl.songs.length}）
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="plst-tip">还没有歌单，起个名字建一个：</div>
                  )}
                  <div className="plst-add-new">
                    <input
                      type="text"
                      value={plName}
                      placeholder="新歌单名…"
                      onChange={(event) => setPlName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") createAndAdd(track);
                      }}
                    />
                    <button
                      type="button"
                      className="animal-btn-sm"
                      onClick={() => createAndAdd(track)}
                    >
                      新建并加入
                    </button>
                  </div>
                  {addFeedback ? <div className="plst-tip on">{addFeedback}</div> : null}
                </div>
              </div>
            ) : null}
          </Fragment>
        );
        })
      )}
    </div>
  );
}

/* ================================================================== *
 * 正在播放（底部抽屉）：当前歌曲信息 + 导入本地音频 / .lrc 播放。
 * ================================================================== */

export function NowPlayingPanel({
  song,
  playing,
  onPlayLocal,
}: {
  song: SongData;
  playing: boolean;
  onPlayLocal: (audioFile: File, lrcFile: File | null) => void;
}) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [lrcFile, setLrcFile] = useState<File | null>(null);

  const pick = (setter: (file: File | null) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    setter(event.target.files?.[0] ?? null);
    event.target.value = ""; // 允许重复选同一个文件
  };

  return (
    <div className="np-panel">
      <div className="np-current">
        <span className="np-dot" data-playing={playing} aria-hidden="true" />
        <div>
          <div className="np-title">{song.title}</div>
          <div className="np-artist">{song.artist || "未知艺术家"}</div>
        </div>
        <span className="np-state">{playing ? "播放中" : "已暂停"}</span>
      </div>

      <div className="np-import">
        <label className="animal-btn">
          选择音频文件
          <input
            type="file"
            accept="audio/*,.flac,.mp3,.wav,.m4a,.ogg,.ape,.aac,.wma"
            hidden
            onChange={pick(setAudioFile)}
          />
        </label>
        <label className="animal-btn">
          选择歌词 (.lrc)
          <input type="file" accept=".lrc,text/plain" hidden onChange={pick(setLrcFile)} />
        </label>
        <button
          type="button"
          className="animal-btn animal-btn-teal"
          disabled={!audioFile}
          onClick={() => audioFile && onPlayLocal(audioFile, lrcFile)}
        >
          开始播放
        </button>
      </div>

      <p className="np-hint">
        {audioFile
          ? `已选音频：${audioFile.name}${lrcFile ? ` ｜ 歌词：${lrcFile.name}` : ""}，点"开始播放"即可在隧道里滚动歌词。`
          : "导入本地音频（可配合同名 .lrc 歌词同步滚动），或在播放列表里直接点歌。"}
      </p>
    </div>
  );
}

/* ================================================================== *
 * 我的歌单（右侧抽屉）：新建歌单 + 自建歌单管理。
 * 数据存 localStorage（@/lib/playlists）；歌曲是搜索结果的快照。
 * 点播交给主播放器（onPlay 回调 → KarlSite 取直链+歌词 → loadSong），
 * 左下角控制 / 隧道歌词全部接管，不会出现两套音频各响各的。
 * ================================================================== */

export function PlaylistsPanel({
  active,
  playingId,
  onPlay,
}: {
  active: boolean;
  /** 正在播放的歌 id（当前行高亮用） */
  playingId: string | null;
  /** queue 带整张歌单 + 当前下标，ended 时由 KarlSite 的循环逻辑接管 */
  onPlay: (
    song: PlaylistSong,
    queue?: { playlistId: string; songs: PlaylistSong[]; index: number },
  ) => Promise<void>;
}) {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  /** 取直链/歌词中的歌（点播完成后 loadSong 会关抽屉） */
  const [loadingId, setLoadingId] = useState<string | null>(null);
  /** 展开了循环模式选择的那张歌单 id（null=全收起；受控、默认收起） */
  const [loopOpenId, setLoopOpenId] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => setPlaylists(listPlaylists());

  // 抽屉打开 / 搜索面板加了歌（自定义事件）时刷新
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener("playlists-changed", onChange);
    return () => window.removeEventListener("playlists-changed", onChange);
  }, []);

  // 卸载时清掉提示计时器
  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  function flash(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  }

  function create() {
    const result = createPlaylist(newName);
    if ("error" in result) {
      flash(result.error ?? "创建失败");
      return;
    }
    setNewName("");
    flash(`已创建「${result.name}」，去搜索歌曲里加歌吧`);
    refresh();
  }

  async function playSong(
    song: PlaylistSong,
    queue?: { playlistId: string; songs: PlaylistSong[]; index: number },
  ) {
    setLoadingId(song.id);
    try {
      await onPlay(song, queue);
    } catch (err: unknown) {
      flash(err instanceof Error ? `播放失败：${err.message}` : "播放失败");
    } finally {
      setLoadingId(null);
    }
  }

  function removeSong(playlistId: string, songId: string) {
    removeFromPlaylist(playlistId, songId);
    refresh();
  }

  function remove(pl: Playlist) {
    if (!window.confirm(`删除歌单「${pl.name}」（${pl.songs.length} 首）？`)) return;
    deletePlaylist(pl.id);
    refresh();
  }

  return (
    <div className="plst-panel">
      <div className="plst-new">
        <input
          type="text"
          value={newName}
          placeholder="新歌单名…"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") create();
          }}
        />
        <button type="button" className="animal-btn-sm" onClick={create}>
          新建歌单
        </button>
      </div>

      {notice ? <div className="plst-tip on">{notice}</div> : null}

      {playlists === null ? (
        <div className="plst-tip">加载中…</div>
      ) : playlists.length === 0 ? (
        <div className="plst-tip">
          还没有歌单。上面起个名字新建，或去「搜索歌曲」点歌曲旁的 ＋ 直接建。
        </div>
      ) : (
        <div className="plst-list">
          {playlists.map((pl) => (
            <Collapse
              key={pl.id}
              className="plst-collapse"
              question={
                <span className="plst-head-q">
                  <span className="plst-name">{pl.name}</span>
                  <span className="plst-count">{pl.songs.length} 首</span>
                  {/* 删除按钮：span 模拟（question 头是 button，禁止 button 嵌套）；
                      stopPropagation 防止删除时触发折叠展开 */}
                  <span
                    role="button"
                    tabIndex={0}
                    className="plst-del"
                    data-tip-pos="top"
                    data-tip={`删除歌单「${pl.name}」`}
                    aria-label={`删除歌单 ${pl.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(pl);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                        remove(pl);
                      }
                    }}
                  >
                    ✕
                  </span>
                </span>
              }
              answer={
                <>
                  {/* 循环模式：受控轻量折叠——默认收起，点头部切换，绝不记忆展开态 */}
                  <div
                    className="plst-loop-collapse"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="plst-loop-toggle"
                      aria-expanded={loopOpenId === pl.id}
                      onClick={() => setLoopOpenId((cur) => (cur === pl.id ? null : pl.id))}
                    >
                      <span className="plst-loop-icon">
                        {loopOpenId === pl.id ? "−" : "+"}
                      </span>
                      <span className="plst-loop-current">
                        {LOOP_MODES.find((m) => m.value === (pl.loopMode ?? "list"))?.label ??
                          "列表循环"}
                      </span>
                    </button>
                    <div className={`plst-loop-panel${loopOpenId === pl.id ? " open" : ""}`}>
                      <div className="plst-loop-opts">
                        {LOOP_MODES.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            data-on={(pl.loopMode ?? "list") === m.value}
                            onClick={(event) => {
                              event.stopPropagation();
                              setPlaylistLoopMode(pl.id, m.value);
                            }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {pl.songs.length === 0 ? (
                    <div className="plst-tip">歌单是空的，去「搜索歌曲」点 ＋ 加歌。</div>
                  ) : (
                    pl.songs.map((song, index) => (
                      <div
                        key={song.id}
                        className={`plst-song${playingId === song.id ? " current" : ""}`}
                      >
                        {loadingId === song.id ? (
                          <span className="plst-state">…</span>
                        ) : (
                          <button
                            type="button"
                            className="plst-play"
                            data-tip="播放"
                            aria-label={`播放 ${song.name}`}
                            onClick={() =>
                              void playSong(song, {
                                playlistId: pl.id,
                                songs: pl.songs,
                                index,
                              })
                            }
                          >
                            ▶
                          </button>
                        )}
                        <span
                          className="plst-song-name"
                          data-tip-pos="left"
                          data-tip={`${song.name} - ${song.artist}`}
                        >
                          {song.name}
                          <span className="plst-song-artist">{song.artist || "未知"}</span>
                        </span>
                        <span className="plst-song-dur">{fmtDuration(song.duration)}</span>
                        <button
                          type="button"
                          className="plst-del"
                          data-tip="从歌单移除"
                          aria-label={`从歌单移除 ${song.name}`}
                          onClick={() => removeSong(pl.id, song.id)}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== *
 * 设置（右侧抽屉）：目前只有「无缝衔接上下歌曲」开关。
 * 开关由 KarlSite 持有并写 localStorage（@/lib/settings），这里只做受控显示。
 * ================================================================== */

export function SettingsPanel({
  seamless,
  onChangeSeamless,
  musicDirs,
  dirChanging,
  onChangeMusicDir,
}: {
  seamless: boolean;
  onChangeSeamless: (next: boolean) => void;
  musicDirs: string[];
  dirChanging: boolean;
  onChangeMusicDir: () => void;
}) {
  return (
    <div className="st-panel">
      <div className="st-row">
        <div className="st-text">
          <div className="st-label">无缝衔接上下歌曲</div>
          <div className="st-desc">
            切歌时让上一首与下一首等功率交叉淡化，本地曲库的歌还会给退场曲加低通 +
            混响，让它慢慢「飘走」。关掉则切歌直接硬切。
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={seamless}
          aria-label="无缝衔接上下歌曲"
          className={`st-switch${seamless ? " on" : ""}`}
          onClick={() => onChangeSeamless(!seamless)}
        >
          <span className="st-knob" aria-hidden="true" />
        </button>
      </div>

      <p className="st-hint">
        左下角新增的圆形按钮：左半圆 = 上一首，右半圆 = 下一首（歌单或曲库里都生效）。
      </p>
      <p className="st-hint">
        说明：在线搜到的歌是跨域直链，无法进入 Web Audio 图（会静音），所以它们用原生
        等功率淡入淡出，不做低通 / 混响塑形。
      </p>

      <div className="st-row">
        <div className="st-text">
          <div className="st-label">音乐目录</div>
          <div className="st-desc">应用从这里扫描本地曲库（可选择多个文件夹）。</div>
          <div className="st-dirs">
            {musicDirs.length > 0 ? (
              musicDirs.map((dir) => (
                <div className="st-dir" key={dir}>
                  {dir}
                </div>
              ))
            ) : (
              <div className="st-dir st-dir-empty">未设置</div>
            )}
          </div>
        </div>
        <button
          type="button"
          className="st-btn"
          onClick={onChangeMusicDir}
          disabled={dirChanging}
        >
          {dirChanging ? "更改中…" : "更改…"}
        </button>
      </div>

      <p className="st-hint">
        点「更改…」选择文件夹后，应用会自动重启内层服务并刷新界面来加载新曲库。
      </p>
    </div>
  );
}
