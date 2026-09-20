"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { LyricLine } from "@/lib/lrc";
import type { Track } from "@/lib/track";

export interface LiveAudio {
  time: number;
  duration: number;
  playing: boolean;
}

export interface PlayerEngine {
  /** per-frame audio state, read by the lyric ring without re-rendering React */
  live: RefObject<LiveAudio>;
  tracks: Track[];
  loadingLibrary: boolean;
  libraryError: string | null;
  current: Track | null;
  currentIndex: number;
  playing: boolean;
  duration: number;
  lines: LyricLine[];
  loadingLyric: boolean;
  select: (id: string) => void;
  toggle: () => void;
  step: (delta: number) => void;
  seek: (seconds: number) => void;
  reloadLibrary: () => void;
}

/** Credit lines ("作词 : 林秋离") are metadata, not lyrics — keep them out of the ring. */
function withoutCredits(lines: LyricLine[]) {
  return lines.filter((line) => !line.credit);
}

/**
 * 播放引擎。
 *
 * 时间推进只写在 `live` 这个 ref 里（rAF 每帧刷新），不进 React state ——
 * 歌词环直接读它，所以 60fps 的进度更新不会触发任何重渲染。
 * 轨道相关的状态都带上「属于哪首歌」的 id，切歌时自然失效，不需要在 effect 里
 * 同步清空 state（那会触发 React Compiler 的 set-state-in-effect 报错）。
 */
export function usePlayerEngine(audioRef: RefObject<HTMLAudioElement | null>): PlayerEngine {
  const live = useRef<LiveAudio>({ time: 0, duration: 0, playing: false });
  const wantPlay = useRef(false);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [meta, setMeta] = useState<{ id: string | null; duration: number }>({
    id: null,
    duration: 0,
  });
  const [lyric, setLyric] = useState<{ id: string | null; lines: LyricLine[] }>({
    id: null,
    lines: [],
  });

  /** 还没点过任何一首时，默认落在第一首「有歌词」的曲子上（不自动播放）。 */
  const currentId = useMemo(() => {
    if (pickedId) return pickedId;
    if (tracks.length === 0) return null;
    return (tracks.find((track) => track.hasLyric) ?? tracks[0]).id;
  }, [pickedId, tracks]);

  const current = useMemo(
    () => tracks.find((track) => track.id === currentId) ?? null,
    [tracks, currentId],
  );
  const currentIndex = useMemo(
    () => tracks.findIndex((track) => track.id === currentId),
    [tracks, currentId],
  );

  const duration = meta.id === currentId ? meta.duration : 0;
  const lines = lyric.id === currentId ? lyric.lines : [];
  const loadingLyric = currentId !== null && lyric.id !== currentId;

  /* 首次加载 + 手动重新扫描都走这里；setState 全部发生在 await 之后，
     避免 effect 同步 setState 造成的连锁渲染。 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/library?refresh=1&t=${reloadToken}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { tracks: Track[] } = await response.json();
        if (cancelled) return;
        setTracks(data.tracks);
        setLibraryError(null);
      } catch (error: unknown) {
        if (cancelled) return;
        setLibraryError(error instanceof Error ? error.message : "曲库读取失败");
      } finally {
        if (!cancelled) setLoadingLibrary(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reloadLibrary = useCallback(() => {
    setLoadingLibrary(true);
    setReloadToken((token) => token + 1);
  }, []);

  /* per-frame audio state, consumed by the lyric ring */
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        live.current.time = audio.currentTime || 0;
        live.current.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        live.current.playing = !audio.paused && !audio.ended;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [audioRef]);

  /* audio element wiring */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => {
      const value = Number.isFinite(audio.duration) ? audio.duration : 0;
      setMeta({ id: currentId, duration: value });
    };
    const onEnded = () => {
      setPlaying(false);
      const index = tracks.findIndex((t) => t.id === currentId);
      if (index >= 0 && tracks.length > 1) {
        wantPlay.current = true;
        setPickedId(tracks[(index + 1) % tracks.length].id);
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioRef, tracks, currentId]);

  /* load the selected file */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentId) return;
    audio.src = `/api/audio?id=${encodeURIComponent(currentId)}`;
    audio.load();
    if (wantPlay.current) {
      wantPlay.current = false;
      audio.play().catch(() => setPlaying(false));
    }
  }, [audioRef, currentId]);

  /* load the lyric for the selected file */
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    fetch(`/api/lyric?id=${encodeURIComponent(currentId)}`)
      .then((response) => (response.ok ? response.json() : { lines: [] }))
      .then((data: { lines?: LyricLine[] }) => {
        if (!cancelled) setLyric({ id: currentId, lines: withoutCredits(data.lines ?? []) });
      })
      .catch(() => {
        if (!cancelled) setLyric({ id: currentId, lines: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const select = useCallback((id: string) => {
    wantPlay.current = true;
    setPickedId(id);
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentId) {
      if (tracks.length > 0) select(tracks[0].id);
      return;
    }
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [audioRef, currentId, select, tracks]);

  const step = useCallback(
    (delta: number) => {
      if (tracks.length === 0) return;
      const index = currentIndex < 0 ? 0 : currentIndex;
      const next = (index + delta + tracks.length) % tracks.length;
      select(tracks[next].id);
    },
    [currentIndex, select, tracks],
  );

  const seek = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const limit = Number.isFinite(audio.duration) ? audio.duration : seconds;
      audio.currentTime = Math.min(Math.max(0, seconds), Math.max(0, limit - 0.05));
    },
    [audioRef],
  );

  return {
    live,
    tracks,
    loadingLibrary,
    libraryError,
    current,
    currentIndex,
    playing,
    duration,
    lines,
    loadingLyric,
    select,
    toggle,
    step,
    seek,
    reloadLibrary,
  };
}
