"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Tooltip } from "animal-island-ui";
import "animal-island-ui/style";
import "./karlgonsalves.css";
import BalloonScene from "./BalloonScene";
import SiteFooter, { SectionBehind } from "./SiteFooter";
import TunnelScene from "./TunnelScene";
import { useKarlInteractions } from "./useKarlInteractions";
import AnimalDrawer from "./AnimalDrawer";
import { NowPlayingPanel, PlaylistPanel, PlaylistsPanel, SearchPanel } from "./MusicPanels";
import {
  DEFAULT_SONG,
  buildSongData,
  songDataFromLyrics,
  type SongData,
} from "./lyrics";
import { parseLyrics } from "@/lib/lrc";
import { gdGetLyric, gdGetUrl } from "@/lib/gd-client";
import type { Track } from "@/lib/track";
import {
  listPlaylists,
  type LoopMode,
  type PlaylistSong,
} from "@/lib/playlists";

/** 右下角 FAB 展开的四个面板。 */
type DrawerKey = "nowPlaying" | "playlist" | "search" | "playlists";

/**
 * Pixel clone of https://karlgonsalves.com/ (route "/") — turned into an
 * endless-loop music player: the song drives the tunnel, the five panels
 * sing the current line, and scrolling scrubs the song.
 *
 * 左下角：GSAP 径向菜单（播放控制：从头开始 / 静音 / 快进 / 播放暂停）。
 * 右下角：GSAP 径向菜单（dock FAB，替换原来的 "Art by Ivan Vlasov"），
 * 弹性展开三个入口 —— 正在播放（底部抽屉，可导入本地音频+.lrc）、
 * 播放列表（右侧抽屉，本地曲库点歌）、搜索歌曲（顶部抽屉，表格+分页样板）。
 */
export default function KarlSite() {
  const rootRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const songRef = useRef<SongData | null>(DEFAULT_SONG);
  const ctrlWrapRef = useRef<HTMLDivElement>(null);
  const dockWrapRef = useRef<HTMLDivElement>(null);
  /** dock 菜单的收起函数（由下面的 GSAP effect 写入） */
  const dockCloseRef = useRef<() => void>(() => {});
  /** 径向菜单实例（悬停显隐逻辑读展开状态用） */
  const ctrlMenuRef = useRef<{ isOpen: () => boolean; close: () => void } | null>(null);
  const dockMenuRef = useRef<{ isOpen: () => boolean; close: () => void } | null>(null);
  /** 只有用户主动切歌时才自动播放（绕过浏览器对非手势播放的限制） */
  const autoplayRef = useRef(false);
  /** 本地导入音频的 objectURL，切歌 / 卸载时回收 */
  const objectUrlRef = useRef<string | null>(null);

  const [song, setSong] = useState<SongData>(DEFAULT_SONG);
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioOk, setAudioOk] = useState(true);
  /** 沉浸式全屏播放 */
  const [fullOpen, setFullOpen] = useState(false);
  /** 是否来自歌单队列（ref 的响应式镜像） */
  const [, setHasQueue] = useState(false);
  /** 正在播放的歌 id（我的歌单里高亮当前行用） */
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** 交叉淡化续接的 seek 目标 / 跳过淡入标记（loadSong → song effect 传递） */
  const pendingSeekRef = useRef<number | null>(null);
  const fadeSkipRef = useRef(false);
  /** 歌单播放队列；null = 非歌单来源（本地曲库 / 导入），音频原生 loop 循环。
      loopMode 不再快照进队列——ended 时实时读歌单数据，改模式立即生效 */
  const queueRef = useRef<{
    playlistId: string;
    songs: PlaylistSong[];
    index: number;
  } | null>(null);

  /** 读队列所属歌单当前的循环模式（实时，改模式立即生效） */
  const queueLoopMode = (): LoopMode => {
    const q = queueRef.current;
    if (!q) return "list";
    return listPlaylists().find((pl) => pl.id === q.playlistId)?.loopMode ?? "list";
  };

  useKarlInteractions(rootRef, audioRef, songRef);

  /* 沉浸式全屏：窗口无边框全屏（盖住任务栏）+ 滚回隧道场景顶部 + 锁页面滚动。
     控制全走左右下角的径向菜单（左：播放/暂停/快进；右：再点「沉浸播放」退出）；Esc 退出。 */
  useEffect(() => {
    if (!fullOpen) return;
    window.scrollTo(0, 0);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void (
      window as unknown as {
        pixelmusic?: { setFullScreen?: (flag: boolean) => Promise<boolean> };
      }
    ).pixelmusic?.setFullScreen?.(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      void (
        window as unknown as {
          pixelmusic?: { setFullScreen?: (flag: boolean) => Promise<boolean> };
        }
      ).pixelmusic?.setFullScreen?.(false);
    };
  }, [fullOpen]);

  /* 切歌：更新 ref + 复位音频，用户手势触发的才自动播放。
     seekTo：交叉淡化完成后主播放器从副音频进度续接；
     noFadeIn：续接时音量立即满格（副音频已在响，淡入会断音）。 */
  const loadSong = (
    next: SongData,
    opts?: { seekTo?: number; noFadeIn?: boolean },
  ) => {
    autoplayRef.current = true;
    setAudioOk(true);
    pendingSeekRef.current = opts?.seekTo ?? null;
    fadeSkipRef.current = opts?.noFadeIn ?? false;
    cfTriggeredRef.current = false; // 新歌重新允许触发交叉淡化
    setSong(next);
    setDrawer(null);
  };

  /* 音量渐变：手动点歌时新歌淡入，柔和过渡 */
  const fadeRafRef = useRef(0);
  const fadeAudio = (
    audio: HTMLAudioElement,
    from: number,
    to: number,
    ms: number,
  ) => {
    cancelAnimationFrame(fadeRafRef.current);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) fadeRafRef.current = requestAnimationFrame(tick);
    };
    fadeRafRef.current = requestAnimationFrame(tick);
  };

  /* 无缝交叉淡化（双音频等功率）：剩余 5s 预取下一首并用副音频开播，
     4s 内主音量按 cos、副按 sin 曲线交叉（功率恒定无音量坑），
     主自然 ended 后主播放器 seek 到副的进度接管——音频与隧道歌词均连续。
     参考：双播放器架构 + 等功率交叉淡化（Apple Music 同款曲线）。 */
  const CROSSFADE_MS = 4000;
  const cfAudioRef = useRef<HTMLAudioElement | null>(null);
  const cfRafRef = useRef(0);
  const cfActiveRef = useRef(false);
  const cfTriggeredRef = useRef(false);
  const cfPendingRef = useRef<{
    prepared: SongData;
    nextIdx: number;
    q: { playlistId: string; songs: PlaylistSong[]; index: number };
    startedAt: number;
  } | null>(null);

  const cancelCrossfade = () => {
    cfTriggeredRef.current = false;
    if (!cfActiveRef.current) return;
    cfActiveRef.current = false;
    cancelAnimationFrame(cfRafRef.current);
    const b = cfAudioRef.current;
    if (b) {
      b.pause();
      b.src = "";
    }
    cfAudioRef.current = null;
    cfPendingRef.current = null;
    const audio = audioRef.current;
    if (audio && audio.volume < 1) fadeAudio(audio, audio.volume, 1, 300);
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || audio.loop || audio.paused) return;
    const q = queueRef.current;
    const remaining = (audio.duration || Infinity) - audio.currentTime;
    // 交叉淡化触发：队列来源、非单曲循环、剩 5s、本首未触发过
    if (
      q &&
      queueLoopMode() !== "single" &&
      remaining > 0 &&
      remaining < 5 &&
      !cfTriggeredRef.current &&
      !cfActiveRef.current
    ) {
      cfTriggeredRef.current = true;
      void startCrossfade(q);
      return;
    }
    // 无交叉淡化时的兜底柔和淡出
    if (!cfActiveRef.current && remaining > 0 && remaining < 2 && audio.volume > 0.01) {
      fadeAudio(audio, audio.volume, 0, Math.max(remaining * 1000, 150));
    }
  };

  const startCrossfade = async (q: {
    playlistId: string;
    songs: PlaylistSong[];
    index: number;
  }) => {
    const audio = audioRef.current;
    if (!audio) return;
    const mode = queueLoopMode();
    let next: number;
    if (mode === "random") {
      if (q.songs.length === 1) return;
      do {
        // eslint-disable-next-line react-hooks/purity -- 事件回调内按需随机，非渲染期
        next = Math.floor(Math.random() * q.songs.length);
      } while (next === q.index);
    } else {
      next = (q.index + 1) % q.songs.length;
    }
    const nextSong = q.songs[next];
    try {
      const prepared = await preparePlaylistSong(nextSong);
      const b = new Audio(prepared.audioUrl);
      b.volume = 0;
      await b.play();
      cfAudioRef.current = b;
      cfPendingRef.current = {
        prepared,
        nextIdx: next,
        q,
        // eslint-disable-next-line react-hooks/purity -- 异步回调内取时间戳，非渲染期
        startedAt: performance.now(),
      };
      cfActiveRef.current = true;
      // eslint-disable-next-line react-hooks/purity -- 异步回调内取时间戳，非渲染期
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / CROSSFADE_MS, 1);
        const main = audioRef.current;
        if (main) main.volume = Math.cos((t * Math.PI) / 2); // 等功率：cos²+sin²=1
        b.volume = Math.sin((t * Math.PI) / 2);
        if (t < 1 && cfActiveRef.current) cfRafRef.current = requestAnimationFrame(tick);
      };
      cfRafRef.current = requestAnimationFrame(tick);
    } catch {
      // 预取/自动播放失败：本首不做交叉淡化，ended 时走兜底逻辑
      cfActiveRef.current = false;
    }
  };

  const finishCrossfade = () => {
    const pending = cfPendingRef.current;
    const b = cfAudioRef.current;
    cfActiveRef.current = false;
    cancelAnimationFrame(cfRafRef.current);
    cfPendingRef.current = null;
    cfAudioRef.current = null;
    if (!pending || !b) return;
    const seekTo = Number.isFinite(b.currentTime) ? b.currentTime : 0;
    b.pause();
    b.src = "";
    const q = pending.q;
    q.index = pending.nextIdx;
    queueRef.current = q;
    setPlayingId(q.songs[pending.nextIdx].id);
    // 歌词转场柔化：切换瞬间隧道歌词面板快速淡隐再浮现
    rootRef.current?.classList.add("switching");
    window.setTimeout(() => rootRef.current?.classList.remove("switching"), 380);
    const audio = audioRef.current;
    if (audio) audio.volume = 1;
    loadSong(pending.prepared, { seekTo, noFadeIn: true });
  };

  useEffect(() => {
    songRef.current = song;
    const audio = audioRef.current;
    if (!audio) return;
    // 单曲循环靠原生 loop；歌单列表/随机循环关 loop 让 ended 驱动切歌；
    // 非歌单来源（本地曲库 / 导入）保持原生循环。模式实时读歌单数据。
    audio.loop = queueRef.current ? queueLoopMode() === "single" : true;
    const seekTo = pendingSeekRef.current;
    pendingSeekRef.current = null;
    try {
      audio.currentTime = seekTo ?? 0;
    } catch {
      /* metadata 未就绪时浏览器会自己排队 seek */
    }
    if (autoplayRef.current) {
      autoplayRef.current = false;
      if (fadeSkipRef.current) {
        // 交叉淡化续接：音量立即满格（副音频正在响，淡入会断音）
        fadeSkipRef.current = false;
        cancelAnimationFrame(fadeRafRef.current);
        audio.volume = 1;
        audio.play().catch(() => {});
      } else {
        // 手动点歌：从静音淡入，柔和过渡
        cancelAnimationFrame(fadeRafRef.current);
        audio.volume = 0;
        audio.play()
          .then(() => fadeAudio(audio, 0, 1, 1500))
          .catch(() => {
            audio.volume = 1;
          });
      }
    }
  }, [song]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  /* 本地曲库歌加载核心：带 .lrc 的歌拉歌词，没词的显示 "♪ 歌名" ---------- */
  const loadLocalTrack = async (track: {
    id: string;
    title: string;
    artist: string;
    hasLyric?: boolean;
  }) => {
    const audioUrl = `/api/audio?id=${encodeURIComponent(track.id)}`;
    try {
      if (track.hasLyric) {
        const res = await fetch(`/api/lyric?id=${encodeURIComponent(track.id)}`);
        if (res.ok) {
          const lyrics = await res.json();
          loadSong(songDataFromLyrics(lyrics, 240, audioUrl, track.title, track.artist));
          return;
        }
      }
    } catch {
      /* 歌词拿不到就退回无词模式 */
    }
    loadSong(buildSongData([], [], 240, audioUrl, track.title, track.artist));
  };

  /* 播放列表点歌：本地来源退出歌单队列，恢复原生循环 ------------------ */
  const playTrack = async (track: Track) => {
    cancelCrossfade();
    queueRef.current = null;
    setHasQueue(false);
    setPlayingId(null);
    await loadLocalTrack(track);
  };

  /* 正在播放：导入本地音频 + .lrc ------------------------------------ */
  const playLocalFiles = async (audioFile: File, lrcFile: File | null) => {
    cancelCrossfade();
    queueRef.current = null; // 导入来源退出歌单队列，恢复原生循环
    setHasQueue(false);
    setPlayingId(null);
    const url = URL.createObjectURL(audioFile);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = url;
    const title = audioFile.name.replace(/\.[^.]+$/, "");
    let next = buildSongData([], [], 240, url, title, "");
    if (lrcFile) {
      try {
        const lyrics = parseLyrics(await lrcFile.text());
        next = songDataFromLyrics(lyrics, 240, url, title, "");
      } catch {
        /* 歌词解析失败就当纯音乐播 */
      }
    }
    loadSong(next);
  };

  /* 构建一首歌单歌的播放数据（取直链 + 拉歌词）——点播与交叉淡化预取共用 */
  const preparePlaylistSong = async (s: PlaylistSong): Promise<SongData> => {
    if (s.source === "local") {
      const audioUrl = `/api/audio?id=${encodeURIComponent(s.id)}`;
      if (s.hasLyric) {
        try {
          const res = await fetch(`/api/lyric?id=${encodeURIComponent(s.id)}`);
          if (res.ok) {
            const lyrics = await res.json();
            return songDataFromLyrics(lyrics, 240, audioUrl, s.name, s.artist);
          }
        } catch {
          /* 歌词拿不到就退回无词模式 */
        }
      }
      return buildSongData([], [], 240, audioUrl, s.name, s.artist);
    }

    const [{ url: audioUrl }, lyric] = await Promise.all([
      gdGetUrl(s.id, s.source, 999),
      gdGetLyric(s.id, s.source, s.name, s.artist).catch(() => ({
        lrc: null as string | null,
        tlyric: null as string | null,
      })),
    ]);

    const fallback = Math.max(Math.round(s.duration) || 240, 60);
    if (lyric.lrc) {
      return songDataFromLyrics(
        parseLyrics(lyric.lrc, lyric.tlyric || null),
        fallback,
        audioUrl,
        s.name,
        s.artist,
      );
    }
    return buildSongData([], [], fallback, audioUrl, s.name, s.artist);
  };

  /* 我的歌单点播：交给主播放器（左下角控制 / 隧道歌词全部接管）。
     queue 记录整张歌单、所属歌单 id 与当前下标，ended 时由循环模式决定下一首。
     本地曲库歌（source="local"）走 /api/audio，其余浏览器直连 GD
     （签名走 /api/gd/sign）拿 CDN 直链与歌词。 */
  const playPlaylistSong = async (
    s: PlaylistSong,
    queue?: { playlistId: string; songs: PlaylistSong[]; index: number },
  ) => {
    cancelCrossfade();
    queueRef.current = queue ?? null;
    setHasQueue(queue !== null);
    setPlayingId(s.id);
    const prepared = await preparePlaylistSong(s);
    loadSong(prepared);
  };

  /* 歌单播完一首：交叉淡化进行中 → 完成续接（主接管副的进度）；
     否则按歌单循环模式切下一首（单曲循环靠原生 loop 不触发 ended），
     循环模式实时读歌单数据——在卡头上改模式立即生效。 */
  const handleEnded = () => {
    if (cfActiveRef.current && cfPendingRef.current) {
      finishCrossfade();
      return;
    }
    const q = queueRef.current;
    if (!q || q.songs.length === 0) return;
    const mode = queueLoopMode();
    if (mode === "single") return;
    let next: number;
    if (mode === "random") {
      if (q.songs.length === 1) {
        next = q.index;
      } else {
        do {
          next = Math.floor(Math.random() * q.songs.length);
        } while (next === q.index);
      }
    } else {
      next = (q.index + 1) % q.songs.length;
    }
    q.index = next;
    playPlaylistSong(q.songs[next], q).catch(() => {
      /* 自动切歌失败（无音源等）就停在当前状态 */
    });
  };

  /* GSAP 径向菜单：两个 FAB 共用一套展开逻辑（fuke.txt 的技术） ------- */
  useEffect(() => {
    interface RadialMenu {
      close: () => void;
      destroy: () => void;
      isOpen: () => boolean;
    }
    const setupRadial = (
      wrap: HTMLElement | null,
      opts: { radius: number; start: number; end: number },
    ): RadialMenu => {
      const noop: RadialMenu = { close: () => {}, destroy: () => {}, isOpen: () => false };
      if (!wrap) return noop;
      const triggers = gsap.utils.toArray<HTMLElement>(".fab-item", wrap);
      const fabBtn = wrap.querySelector<HTMLElement>(".fab");
      const fabIcon = wrap.querySelector<HTMLElement>(".fab > svg");
      if (!fabBtn || triggers.length === 0) return noop;
      // Tooltip 会在 fab-item 外包一层 animal-tooltipWrapper（气泡 absolute 锚定它）。
      // GSAP 必须 transform 这层 wrapper 而不是 fab-item 本身，
      // 否则菜单展开后按钮被移走、气泡还锚在原地，hover 时气泡出现在错误位置。
      const items = triggers.map((el) =>
        el.parentElement && el.parentElement.className.includes("animal-tooltipWrapper")
          ? el.parentElement
          : el,
      );

      const angleStep = (opts.end - opts.start) / (items.length - 1);
      gsap.set(items, { x: 0, y: 0, scale: 0, opacity: 0 });
      const tl = gsap.timeline({ paused: true });
      items.forEach((item, i) => {
        const angle = ((opts.start + angleStep * i) * Math.PI) / 180;
        tl.to(
          item,
          {
            x: Math.cos(angle) * opts.radius,
            y: Math.sin(angle) * opts.radius,
            scale: 1,
            opacity: 1,
            duration: 0.6,
            ease: "elastic.out(1, 0.5)",
            easeReverse: true,
          },
          i * 0.05,
        );
      });
      if (fabIcon) {
        tl.to(
          fabIcon,
          { rotation: 135, duration: 0.35, ease: "back.out(1.7)", easeReverse: true },
          0,
        );
      }

      let isOpen = false;
      const toggle = () => {
        isOpen = !isOpen;
        if (isOpen) tl.play();
        else tl.reverse();
        fabBtn.setAttribute("aria-expanded", String(isOpen));
      };
      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isOpen) toggle();
      };
      fabBtn.addEventListener("click", toggle);
      document.addEventListener("keydown", onKeydown);
      return {
        close: () => {
          if (isOpen) toggle();
        },
        isOpen: () => isOpen,
        destroy: () => {
          fabBtn.removeEventListener("click", toggle);
          document.removeEventListener("keydown", onKeydown);
          tl.kill();
        },
      };
    };

    // 左下角：扇形 -90°→0°，朝右上展开（播放控制）
    const ctrlMenu = setupRadial(ctrlWrapRef.current, { radius: 120, start: -90, end: 0 });
    // 右下角：扇形 180°→270°，朝左上展开（三个抽屉入口）
    const dockMenu = setupRadial(dockWrapRef.current, { radius: 130, start: 180, end: 270 });
    dockCloseRef.current = dockMenu.close;
    ctrlMenuRef.current = ctrlMenu;
    dockMenuRef.current = dockMenu;

    return () => {
      dockCloseRef.current = () => {};
      ctrlMenu.destroy();
      dockMenu.destroy();
    };
  }, [audioOk]);

  /* 悬停显隐：两个角落菜单默认残影，鼠标靠近浮现；展开时区域内锁定，
     远离约 320px 自动收起并渐隐（用户点击展开后去点小按钮的路上不消失）。 */
  useEffect(() => {
    if (!audioOk) return;
    const wraps = [ctrlWrapRef, dockWrapRef];
    const menus = [ctrlMenuRef, dockMenuRef];
    // 初始完全隐藏（首次 mousemove 会按真实距离修正）
    wraps.forEach((w) => {
      if (w.current) gsap.set(w.current, { opacity: 0 });
    });
    let raf = 0;
    const SHOW_DIST = 220; // 靠近浮现的距离
    const HIDE_OPEN_DIST = 320; // 展开时远离自动收起的距离
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        wraps.forEach((wrapRef, i) => {
          const wrap = wrapRef.current;
          const menu = menus[i].current;
          if (!wrap) return;
          const r = wrap.getBoundingClientRect();
          const dist = Math.hypot(
            e.clientX - (r.left + r.width / 2),
            e.clientY - (r.top + r.height / 2),
          );
          if (menu?.isOpen()) {
            if (dist > HIDE_OPEN_DIST) {
              menu.close();
              gsap.to(wrap, { opacity: 0, duration: 0.4, overwrite: "auto" });
            } else {
              gsap.to(wrap, { opacity: 1, duration: 0.25, overwrite: "auto" });
            }
          } else {
            gsap.to(wrap, {
              opacity: dist < SHOW_DIST ? 1 : 0,
              duration: 0.35,
              overwrite: "auto",
            });
          }
        });
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [audioOk]);

  /* dock 子按钮：收起菜单再开抽屉 ------------------------------------ */
  const openDrawer = (key: DrawerKey) => {
    dockCloseRef.current();
    setDrawer(key);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const restart = () => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;
  };

  const forward = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(audio.currentTime + 10, (audio.duration || Infinity) - 0.05);
  };

  return (
    <div className={`karl-site${fullOpen ? " immersive-on" : ""}`} ref={rootRef}>
      <TunnelScene />
      <BalloonScene />
      <SiteFooter />
      <SectionBehind />
      <audio
        ref={audioRef}
        src={song.audioUrl}
        preload="auto"
        muted={muted}
        onPlay={() => {
          setPlaying(true);
          // 交叉淡化期间暂停/恢复主音频时，副音频同步跟随
          if (cfActiveRef.current) void cfAudioRef.current?.play().catch(() => {});
        }}
        onPause={() => {
          setPlaying(false);
          if (cfActiveRef.current) cfAudioRef.current?.pause();
        }}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onError={() => setAudioOk(false)}
      />

      {/* 左下角：播放控制径向菜单 */}
      {audioOk && (
        <div className="fab-wrap" ref={ctrlWrapRef}>
          <Tooltip title="从头开始">
            <button type="button" className="fab-item" aria-label="从头开始" onClick={restart}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip title={muted ? "取消静音" : "静音"}>
            <button type="button" className="fab-item" aria-label={muted ? "取消静音" : "静音"} onClick={() => setMuted((m) => !m)}>
              {muted ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </button>
          </Tooltip>
          <Tooltip title="快进 10 秒">
            <button type="button" className="fab-item" aria-label="快进 10 秒" onClick={forward}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="13 19 22 12 13 5 13 19" />
                <polygon points="2 19 11 12 2 5 2 19" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip title={playing ? "暂停" : "播放"}>
            <button type="button" className="fab-item" aria-label={playing ? "暂停" : "播放"} onClick={togglePlay}>
              {playing ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="9" y1="5" x2="9" y2="19" />
                  <line x1="15" y1="5" x2="15" y2="19" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              )}
            </button>
          </Tooltip>
          <button type="button" className="fab" aria-label="播放控制" aria-expanded="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      )}

      {/* 右下角：dock 径向菜单（沉浸播放 / 播放列表 / 搜索歌曲 / 我的歌单） */}
      <div className="dock-fab-wrap" ref={dockWrapRef}>
        <Tooltip title={fullOpen ? "退出沉浸" : "沉浸播放"}>
          <button
            type="button"
            className="fab-item"
            aria-label={fullOpen ? "退出沉浸" : "沉浸播放"}
            onClick={() => setFullOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <polygon points="10 8.5 15.5 12 10 15.5" fill="currentColor" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip title="播放列表">
          <button type="button" className="fab-item" aria-label="播放列表" onClick={() => openDrawer("playlist")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="9" y1="6" x2="21" y2="6" />
              <line x1="9" y1="12" x2="21" y2="12" />
              <line x1="9" y1="18" x2="21" y2="18" />
              <circle cx="4.5" cy="6" r="1" fill="currentColor" />
              <circle cx="4.5" cy="12" r="1" fill="currentColor" />
              <circle cx="4.5" cy="18" r="1" fill="currentColor" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip title="搜索歌曲">
          <button type="button" className="fab-item" aria-label="搜索歌曲" onClick={() => openDrawer("search")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.2" y2="16.2" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip title="我的歌单">
          <button type="button" className="fab-item" aria-label="我的歌单" onClick={() => openDrawer("playlists")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
              <line x1="20.2" y1="3.6" x2="20.2" y2="8.6" />
            </svg>
          </button>
        </Tooltip>
        <button type="button" className="fab" aria-label="音乐面板" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </button>
      </div>

      {/* 四个抽屉（animal-island-ui 风格） */}
      <AnimalDrawer
        open={drawer === "search"}
        title="搜索歌曲"
        placement="top"
        height={520}
        onClose={() => setDrawer(null)}
      >
        <SearchPanel />
      </AnimalDrawer>

      <AnimalDrawer
        open={drawer === "playlists"}
        title="我的歌单"
        placement="right"
        width={420}
        onClose={() => setDrawer(null)}
      >
        <PlaylistsPanel
          active={drawer === "playlists"}
          playingId={playingId}
          onPlay={playPlaylistSong}
        />
      </AnimalDrawer>

      <AnimalDrawer
        open={drawer === "playlist"}
        title="播放列表"
        placement="right"
        width={420}
        onClose={() => setDrawer(null)}
      >
        <PlaylistPanel active={drawer === "playlist"} currentUrl={song.audioUrl} onPlayTrack={playTrack} />
      </AnimalDrawer>

      <AnimalDrawer
        open={drawer === "nowPlaying"}
        title="正在播放"
        placement="bottom"
        height={330}
        onClose={() => setDrawer(null)}
      >
        <NowPlayingPanel song={song} playing={playing} onPlayLocal={playLocalFiles} />
      </AnimalDrawer>
    </div>
  );
}
