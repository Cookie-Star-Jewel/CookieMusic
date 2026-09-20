"use client";

import { useMemo, useState } from "react";
import TrackList, { fmtTime } from "./TrackList";
import type { PlayerEngine } from "./usePlayerEngine";

interface GdSong {
  id: string;
  source: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  has_hires?: boolean;
}

interface Job {
  state: "running" | "ok" | "error";
  note: string;
}

const QUALITIES = [
  { br: 999, label: "FLAC 无损" },
  { br: 740, label: "16bit 无损" },
  { br: 320, label: "320K" },
];

interface Props {
  engine: PlayerEngine;
  onPick: (id: string) => void;
}

/** 「歌曲搜索」板块 —— 本地曲库即时过滤 + GD音乐台在线搜索下载。 */
export default function SearchPanel({ engine, onPick }: Props) {
  const [mode, setMode] = useState<"local" | "online">("local");
  const [localKeyword, setLocalKeyword] = useState("");

  const [keyword, setKeyword] = useState("");
  const [songs, setSongs] = useState<GdSong[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [br, setBr] = useState(999);
  const [jobs, setJobs] = useState<Record<string, Job>>({});

  const found = useMemo(() => {
    const q = localKeyword.trim().toLowerCase();
    if (!q) return engine.tracks;
    return engine.tracks.filter((track) =>
      [track.title, track.artist, track.album, track.folder].some((field) =>
        field.toLowerCase().includes(q),
      ),
    );
  }, [engine.tracks, localKeyword]);

  async function searchOnline() {
    if (!keyword.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const response = await fetch(
        `/api/gd/search?keyword=${encodeURIComponent(keyword.trim())}&count=20`,
      );
      const data = (await response.json()) as { ok: boolean; songs?: GdSong[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "搜索失败");
      setSongs(data.songs ?? []);
      setSearched(true);
    } catch (error: unknown) {
      setSearchError(error instanceof Error ? error.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  }

  async function download(song: GdSong) {
    setJobs((prev) => ({ ...prev, [song.id]: { state: "running", note: "下载中…" } }));
    try {
      const response = await fetch("/api/gd/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: song.id,
          source: song.source,
          br,
          title: song.name,
          artist: song.artist,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        file?: string;
        info?: string;
        lyric?: string;
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "下载失败");
      setJobs((prev) => ({
        ...prev,
        [song.id]: {
          state: "ok",
          note: `已下载 ${data.info ?? ""} · ${data.lyric ?? ""}`,
        },
      }));
      engine.reloadLibrary();
    } catch (error: unknown) {
      setJobs((prev) => ({
        ...prev,
        [song.id]: {
          state: "error",
          note: error instanceof Error ? error.message : "下载失败",
        },
      }));
    }
  }

  const busy = Object.values(jobs).some((job) => job.state === "running");

  return (
    <div className="player-sheet">
      <div className="player-head">
        <div>
          <h2 className="player-title">歌曲搜索</h2>
          <p className="player-sub">
            {mode === "local"
              ? `本地曲库 ${engine.tracks.length} 首，即时过滤。`
              : "走 GD音乐台（netease 等源），搜到直接下成 FLAC 并带歌词入库。"}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <div className="player-tabs">
          <button
            type="button"
            data-on={mode === "local"}
            onClick={() => setMode("local")}
          >
            本地曲库
          </button>
          <button
            type="button"
            data-on={mode === "online"}
            onClick={() => setMode("online")}
          >
            在线搜索
          </button>
        </div>
      </div>

      {mode === "local" ? (
        <>
          <input
            className="player-search"
            type="search"
            value={localKeyword}
            onChange={(event) => setLocalKeyword(event.target.value)}
            placeholder="搜索本地曲库…"
          />
          <div className="player-rows">
            <TrackList
              tracks={found}
              currentId={engine.current?.id ?? null}
              onPick={onPick}
            />
          </div>
        </>
      ) : (
        <>
          <div className="player-head" style={{ gap: 12 }}>
            <input
              className="player-search"
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void searchOnline();
              }}
              placeholder="歌名 / 歌手…"
            />
            <div className="player-quality" id="quality-select">
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
            <button
              type="button"
              className="player-btn primary"
              onClick={() => void searchOnline()}
              disabled={searching}
            >
              {searching ? "搜索中…" : "搜索"}
            </button>
          </div>

          <div className="player-rows">
            {searchError ? <div className="player-empty">搜索失败：{searchError}</div> : null}
            {!searched && !searchError ? (
              <div className="player-empty">输入关键词后回车。下载会写进 GD下载.bat 同一个目录，并自动带歌词。</div>
            ) : null}
            {searched && songs.length === 0 && !searchError ? (
              <div className="player-empty">没有搜到。</div>
            ) : null}

            {songs.map((song, index) => {
              const job = jobs[song.id];
              return (
                <div key={`${song.id}-${index}`} className="player-row player-row-static">
                  <span className="player-row-idx">{index + 1}</span>
                  <span className="player-row-name">
                    {song.name}
                    {song.has_hires ? <span className="player-hires"> Hi-Res</span> : null}
                  </span>
                  <span className="player-row-sub">{song.artist || "未知歌手"}</span>
                  <span className="player-row-sub player-col-hide">
                    {song.album || "—"}
                  </span>
                  <span className="player-row-idx">{fmtTime(song.duration)}</span>
                  <span className="player-row-action">
                    {job?.state === "running" ? (
                      <span className="player-tag">下载中…</span>
                    ) : job?.state === "ok" ? (
                      <span className="player-tag on">{job.note}</span>
                    ) : job?.state === "error" ? (
                      <span className="player-tag" style={{ color: "#A32D2D" }}>
                        {job.note}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="player-btn"
                        onClick={() => void download(song)}
                        disabled={busy}
                      >
                        下载
                      </button>
                    )}
                  </span>
                  {job?.note ? (
                    <span className="player-row-note">{job.note}</span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="player-foot-note">
            音质默认 FLAC 无损（源上没有就自动降到 320K）。下载和歌词走的是
            <code> GD下载.bat </code>同一套链路，写进同一个目录，
            下完到「播放列表」点「重新扫描」就能播。
          </p>
        </>
      )}
    </div>
  );
}
