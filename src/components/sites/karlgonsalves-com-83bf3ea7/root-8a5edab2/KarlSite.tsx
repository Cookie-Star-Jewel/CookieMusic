"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Tooltip } from "animal-island-ui";
import "animal-island-ui/style";
import "./karlgonsalves.css";
import BalloonScene from "./BalloonScene";
import SiteFooter, { SectionBehind } from "./SiteFooter";
import TunnelScene from "./TunnelScene";
import { useKarlInteractions } from "./useKarlInteractions";
import AnimalDrawer from "./AnimalDrawer";
import {
  NowPlayingPanel,
  PlaylistPanel,
  PlaylistsPanel,
  SearchPanel,
  SettingsPanel,
} from "./MusicPanels";
import {
  DEFAULT_SONG,
  buildSongData,
  songDataFromLyrics,
  type SongData,
} from "./lyrics";
import { parseLyrics } from "@/lib/lrc";
import { gdGetLyric, gdGetUrl, type GdSong } from "@/lib/gd-client";
import type { Track } from "@/lib/track";
import {
  listPlaylists,
  type LoopMode,
  type PlaylistSong,
} from "@/lib/playlists";
import { loadSettings, saveSettings } from "@/lib/settings";
import {
  applyLeadIn,
  applyTail,
  fadeIn as waFadeIn,
  fadeOut as waFadeOut,
  getEngine,
  isSameOriginSrc,
  resetSlot,
  startSlotAtFull,
  stopSlot,
  type WaSlot,
} from "./audio-engine";
import {
  analyzeLyrics,
  decideTransition,
  type TransitionPlan,
} from "./transition-plan";
import { resolveEnergy } from "./energy-analyzer";

/** 右下角 FAB 展开的五个面板。 */
type DrawerKey = "nowPlaying" | "playlist" | "search" | "playlists" | "settings";

/** 本地曲库的虚拟队列 id（并不是真实歌单）。queueLoopMode() 查不到它 → 回退"列表循环"，
    所以曲库播完一首会自动续下一首、绕回开头，而不是像以前那样单曲无限循环。 */
const LIBRARY_QUEUE_ID = "__library__";

/** preload 暴露的桌面桥（纯浏览器里为 undefined）。 */
interface PixelMusicBridge {
  getConfig?: () => Promise<{ musicRoots?: string[]; saveDir?: string } | null>;
  chooseMusicDir?: () => Promise<{ musicRoots?: string[]; saveDir?: string } | null>;
  setFullScreen?: (flag: boolean) => Promise<boolean>;
}

function bridge(): PixelMusicBridge | undefined {
  return (window as unknown as { pixelmusic?: PixelMusicBridge }).pixelmusic;
}

/** 播放失败时的统一提示文案（最常见原因是音乐目录没设对）。 */
const PLAY_FAIL_HINT = "无法播放：找不到音频文件，请检查「设置 → 音乐目录」";

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
  /** Web Audio 引擎（只服务本地同源音源；GD 跨域直链不能进图，走原生 volume） */
  const engineRef = useRef<{ ctx: AudioContext; slots: WaSlot[] } | null>(null);
  /** 当前在本地引擎上响的槽下标（0/1）；交叉淡化时与另一个槽交换角色 */
  const localSlotRef = useRef(0);
  /** 已预载好、无需再次 set src 的槽下标（引擎内交叉淡化续接用） */
  const preloadedSlotRef = useRef<number | null>(null);
  /** 当前正在响的是哪条路径 */
  const curKindRef = useRef<"local" | "online">("local");
  /** 无缝衔接开关（localStorage 持久化） */
  const [seamless, setSeamless] = useState(true);
  const seamlessRef = useRef(true);

  /* 任意用户手势（点击/按键/触摸）一次性唤醒 AudioContext：
     本地同源歌走 Web Audio 引擎，引擎的 AudioContext 创建于 suspended 态，
     必须在用户手势内 resume 才能真正出声。play 按钮走 resumeIfLocal，
     但曲库点歌、导入文件等其它路径只在 effect 里 resume（非手势、会被浏览器忽略），
     所以这里兜底：首次手势统一唤醒，之后移除监听。 */
  useEffect(() => {
    const wake = () => {
      const eng = engineRef.current;
      if (eng && eng.ctx.state === "suspended") void eng.ctx.resume().catch(() => {});
      if (eng) {
        window.removeEventListener("pointerdown", wake);
        window.removeEventListener("keydown", wake);
        window.removeEventListener("touchstart", wake);
      }
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("touchstart", wake);
    };
  }, []);

  const [song, setSong] = useState<SongData>(DEFAULT_SONG);
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  /** 沉浸式全屏播放 */
  const [fullOpen, setFullOpen] = useState(false);
  /** 是否来自歌单队列（ref 的响应式镜像） */
  const [, setHasQueue] = useState(false);
  /** 正在播放的歌 id（我的歌单里高亮当前行用） */
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** 已广播过真实时长的歌 id（GD 免签名 API 搜索不带时长，播放后回填） */
  const durationSentRef = useRef<Set<string>>(new Set());
  /** 设置抽屉展示的当前音乐目录（来自主进程 config.json）。 */
  const [musicDirs, setMusicDirs] = useState<string[]>([]);
  /** 「更改音乐目录」进行中（目录框已弹出 / 内层服务重启中）。 */
  const [dirChanging, setDirChanging] = useState(false);
  /** 短暂的可见提示（播放失败原因等），约 4.5s 后自动消失。 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 交叉淡化续接的 seek 目标 / 跳过淡入标记（loadSong → song effect 传递） */
  const pendingSeekRef = useRef<number | null>(null);
  const fadeSkipRef = useRef(false);
  /** 播放队列；null = 无队列来源（搜索试听 / 导入文件），音频原生 loop 循环。
      本地曲库点歌也会建队列（playlistId = LIBRARY_QUEUE_ID 这个虚拟 id），
      于是曲库同样能自动续播、走无缝衔接。
      loopMode 不快照进队列——ended 时实时读歌单数据，改模式立即生效 */
  const queueRef = useRef<{
    playlistId: string;
    songs: PlaylistSong[];
    index: number;
  } | null>(null);

  /** 读队列所属歌单当前的循环模式（实时，改模式立即生效）。
      虚拟曲库队列查不到歌单 → 回退 "list"（列表循环，播完绕回第一首）。 */
  const queueLoopMode = (): LoopMode => {
    const q = queueRef.current;
    if (!q) return "list";
    return listPlaylists().find((pl) => pl.id === q.playlistId)?.loopMode ?? "list";
  };

  /** 当前在响的音频元素：本地走 Web Audio 引擎槽，在线走原生 <audio>。
      必须是稳定引用（useCallback）——useKarlInteractions 把它写进 effect 依赖。 */
  const activeAudio = useCallback((): HTMLAudioElement | null => {
    if (curKindRef.current === "local") {
      const eng = engineRef.current;
      if (eng) return eng.slots[localSlotRef.current]?.el ?? null;
    }
    return audioRef.current;
  }, []);

  /** 懒建引擎（首次用户手势调用，满足自动播放策略）并唤醒挂起的 AudioContext。 */
  const ensureEngine = (): { ctx: AudioContext; slots: WaSlot[] } => {
    if (!engineRef.current) engineRef.current = getEngine(2);
    const eng = engineRef.current;
    if (eng.ctx.state === "suspended") void eng.ctx.resume().catch(() => {});
    return eng;
  };

  /* 无缝衔接开关：首次挂载读 localStorage（避免 SSR 水合不一致），改时写回 */
  useEffect(() => {
    const s = loadSettings().seamless;
    setSeamless(s);
    seamlessRef.current = s;
  }, []);

  const changeSeamless = (next: boolean) => {
    setSeamless(next);
    seamlessRef.current = next;
    saveSettings({ seamless: next });
  };

  /* ---------------- 音乐目录（设置抽屉里的「更改…」） ---------------- *
   * 目录存在主进程的 config.json（app.getPath("userData")）。渲染层不能直接读，
   * 走 preload 暴露的桥：getConfig 展示当前目录，chooseMusicDir 弹系统目录框。
   * 新目录要生效必须重启内层 server（MUSIC_ROOTS 是 spawn 时注入的），这一步由
   * 主进程做，完成后窗口自动刷新到新曲库——所以这里只负责触发与展示。 */

  /** 顶部气泡提示：出现后约 4.5s 自动消失。 */
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const showNotice = (msg: string) => setNotice(msg);

  /* 打开设置抽屉时读一次配置，展示当前音乐目录（纯浏览器无桌面桥 → 保持空）。 */
  useEffect(() => {
    if (drawer !== "settings") return;
    const pm = bridge();
    if (!pm?.getConfig) return;
    void pm
      .getConfig()
      .then((cfg) => {
        if (cfg && Array.isArray(cfg.musicRoots)) setMusicDirs(cfg.musicRoots);
      })
      .catch(() => {});
  }, [drawer]);

  /* 更改音乐目录：弹目录框 → 主进程写 config 并重启内层服务 → 窗口自动刷新。 */
  const changeMusicDir = async () => {
    const pm = bridge();
    if (!pm?.chooseMusicDir) return;
    setDirChanging(true);
    try {
      const cfg = await pm.chooseMusicDir();
      if (cfg && Array.isArray(cfg.musicRoots)) setMusicDirs(cfg.musicRoots);
    } catch {
      showNotice("更改音乐目录失败，请重试");
    } finally {
      setDirChanging(false);
    }
  };

  useKarlInteractions(rootRef, activeAudio, songRef);

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
    pendingSeekRef.current = opts?.seekTo ?? null;
    fadeSkipRef.current = opts?.noFadeIn ?? false;
    cfTriggeredRef.current = false; // 新歌重新允许触发交叉淡化
    tailFadedRef.current = null; // 新歌重新允许兜底淡出
    setSong(next);
    setDrawer(null);
  };

  /* 音量渐变：手动点歌时新歌淡入，柔和过渡 */
  const fadeRafRef = useRef(0);
  /** 已经给哪个元素做过"尾部兜底淡出"（同一首只做一次；换歌时清空）。 */
  const tailFadedRef = useRef<HTMLAudioElement | null>(null);
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

  /* ---------------- 无缝衔接：双播放器等功率交叉淡化 ----------------
     本地同源歌（/api/audio、blob:）走 Web Audio 引擎 —— GainNode + AudioParam
     一次性排程（setValueCurveAtTime），并可给退场曲做低通 + 混响的「飘走」塑形；
     GD 跨域直链进不了 Web Audio 图（会静音），继续走原生 volume 的等功率曲线。
     两条路径都是 cos/sin 等功率，听感一致。 */
  /** 算不出过渡计划时的兜底时长（秒） */
  const CROSSFADE_FALLBACK_S = 6;
  /** 在线路径的副播放器（引擎路径用引擎槽） */
  const cfAudioRef = useRef<HTMLAudioElement | null>(null);
  const cfRafRef = useRef(0);
  const cfActiveRef = useRef(false);
  const cfTriggeredRef = useRef(false);
  /** 本次过渡走引擎路径（true）还是原生 volume 路径（false） */
  const cfEngineRef = useRef(false);
  const cfPendingRef = useRef<{
    prepared: SongData;
    nextIdx: number;
    q: { playlistId: string; songs: PlaylistSong[]; index: number };
    engine: boolean;
    slotIdx: number;
  } | null>(null);
  /** 预热好的过渡计划（歌一开播就算好；触发窗口按它的时长自适应） */
  const planRef = useRef<TransitionPlan | null>(null);
  /** 预热好的下一首（含直链/歌词），触发时零等待，避免淡入卡顿 */
  const nextPrepRef = useRef<{
    prepared: SongData;
    nextIdx: number;
    q: { playlistId: string; songs: PlaylistSong[]; index: number };
  } | null>(null);

  const cancelCrossfade = () => {
    cfTriggeredRef.current = false;
    if (!cfActiveRef.current) return;
    cfActiveRef.current = false;
    cancelAnimationFrame(cfRafRef.current);
    const eng = engineRef.current;
    if (cfEngineRef.current && eng) {
      // 引擎路径：副槽停下并复位，主槽撤掉塑形、拉回满格
      const cur = eng.slots[localSlotRef.current];
      const other = eng.slots[1 - localSlotRef.current];
      resetSlot(cur, eng.ctx);
      if (!cur.el.paused) startSlotAtFull(cur, eng.ctx);
      stopSlot(other, eng.ctx);
      resetSlot(other, eng.ctx);
    } else {
      const b = cfAudioRef.current;
      if (b) {
        b.pause();
        b.removeAttribute("src");
        b.load();
      }
      cfAudioRef.current = null;
      const a = activeAudio();
      if (a && a.volume < 1) fadeAudio(a, a.volume, 1, 300);
    }
    cfEngineRef.current = false;
    cfPendingRef.current = null;
  };

  const handleTimeUpdate = () => {
    const audio = activeAudio();
    if (!audio || audio.loop || audio.paused) return;
    // 真实时长回填：GD 免签名公共 API 的搜索结果不带时长，播放后把
    // audio.duration 通过事件广播给搜索面板回填该行（每首歌只发一次）
    if (playingId && Number.isFinite(audio.duration) && audio.duration > 0 && !durationSentRef.current.has(playingId)) {
      // eslint-disable-next-line react-hooks/immutability -- 事件回调内标记已发送，非渲染期
      durationSentRef.current.add(playingId);
      window.dispatchEvent(new CustomEvent("gd-duration", { detail: { id: playingId, duration: Math.round(audio.duration) } }));
    }
    const q = queueRef.current;
    const remaining = (audio.duration || Infinity) - audio.currentTime;
    // 触发窗口按「计划时长」自适应（长交叉要更早开始），没有计划就退回兜底值
    const lead = (planRef.current?.duration ?? CROSSFADE_FALLBACK_S) + 0.8;
    // 过渡触发：歌单队列来源、开着无缝衔接、非单曲循环、进入触发窗口、本首未触发过
    if (
      q &&
      seamlessRef.current &&
      queueLoopMode() !== "single" &&
      remaining > 0 &&
      remaining < lead &&
      !cfTriggeredRef.current &&
      !cfActiveRef.current
    ) {
      cfTriggeredRef.current = true;
      void startCrossfade(q);
      return;
    }
    /* 没有过渡时的兜底柔和淡出。只在"下一首会硬切进来"时才有意义 ——
       单曲循环 / 无队列时淡到 0 之后再播就是一直无声，所以不做。
       本地槽改走引擎 master.gain（本地音量只由 master 一套决定，不再碰 el.volume）；
       在线跨域没有 Web Audio 图，只能用原生 volume，且它载入时会写回 1。 */
    const willHardSwitch = !!q && queueLoopMode() !== "single";
    if (
      !cfActiveRef.current &&
      willHardSwitch &&
      remaining > 0 &&
      remaining < 2 &&
      tailFadedRef.current !== audio
    ) {
      tailFadedRef.current = audio;
      const ms = Math.max(remaining * 1000, 150);
      if (curKindRef.current === "local") {
        const eng = engineRef.current;
        const slot = eng?.slots[localSlotRef.current];
        if (eng && slot) waFadeOut(slot, ms / 1000, eng.ctx);
      } else if (audio.volume > 0.01) {
        fadeAudio(audio, audio.volume, 0, ms);
      }
    }
  };

  /** 自动播完路径：按循环模式算下一首，再交给 beginTransition。 */
  const startCrossfade = async (q: {
    playlistId: string;
    songs: PlaylistSong[];
    index: number;
  }) => {
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
    await beginTransition(q.songs[next], next, q);
  };

  /**
   * 开始一次过渡（手动切歌与自动播完共用）。
   * 两端都是本地同源 → 引擎路径（等功率 AudioParam + 退场曲低通/混响 + 进场曲压暗）；
   * 任一端是在线跨域 → 原生 volume 等功率（跨域音频不能进 Web Audio 图）。
   * 时长/塑形来自 planRef（歌一开播就算好的过渡计划），没有计划就用兜底值。
   */
  const beginTransition = async (
    nextSong: PlaylistSong,
    nextIdx: number,
    q: { playlistId: string; songs: PlaylistSong[]; index: number },
  ) => {
    if (cfActiveRef.current) return;
    const outgoing = activeAudio();
    if (!outgoing) return;
    try {
      // 优先用预热的下一首（避免在触发窗口里现取直链导致淡入卡顿）
      const prep = nextPrepRef.current;
      const prepared =
        prep && prep.nextIdx === nextIdx && prep.q.playlistId === q.playlistId
          ? prep.prepared
          : await preparePlaylistSong(nextSong);
      const plan = prep && prep.nextIdx === nextIdx ? planRef.current : null;

      const inLocal = isSameOriginSrc(prepared.audioUrl);
      const outLocal = curKindRef.current === "local";
      // 计划时长按"这首歌还剩多少"夹一下，避免过渡跨过曲末
      const remain = (outgoing.duration || Infinity) - outgoing.currentTime;
      const dur = Math.max(
        3,
        Math.min(plan?.duration ?? CROSSFADE_FALLBACK_S, Number.isFinite(remain) ? remain : 99),
      );

      if (outLocal && inLocal) {
        /* ---- 引擎路径：等功率曲线走 AudioParam，退场曲加低通+混响 ---- */
        const eng = ensureEngine();
        const nxtIdx = 1 - localSlotRef.current;
        const cur = eng.slots[localSlotRef.current];
        const nxt = eng.slots[nxtIdx];
        resetSlot(nxt, eng.ctx);
        nxt.el.removeAttribute("src");
        nxt.el.src = prepared.audioUrl;
        nxt.el.loop = false;
        try {
          nxt.el.currentTime = 0;
        } catch {
          /* metadata 未就绪，浏览器自己排队 */
        }
        await nxt.el.play();
        // 顺序要紧：fadeIn/fadeOut 内部会 clearAutomation，把同槽的 lp/wet 自动化一起取消，
        // 所以 applyTail / applyLeadIn 必须排在各自的 fade 之后。
        waFadeIn(nxt, dur, eng.ctx);
        waFadeOut(cur, dur, eng.ctx);
        if (plan?.tail ?? true) {
          applyTail(cur, dur, eng.ctx, plan?.lpTo, plan?.wetTo);
        }
        if (plan?.leadLowpass) {
          applyLeadIn(nxt, dur, eng.ctx);
        }
        cfEngineRef.current = true;
        cfPendingRef.current = { prepared, nextIdx, q, engine: true, slotIdx: nxtIdx };
        cfActiveRef.current = true;
        window.setTimeout(() => {
          if (cfActiveRef.current && cfEngineRef.current) finishCrossfade();
        }, dur * 1000 + 80);
      } else {
        /* ---- 原生 volume 路径（在线在场，低通/混响用不了） ---- */
        const ms = dur * 1000;
        const b = new Audio(prepared.audioUrl);
        b.volume = 0;
        b.loop = false;
        await b.play();
        cfAudioRef.current = b;
        cfEngineRef.current = false;
        cfPendingRef.current = { prepared, nextIdx, q, engine: false, slotIdx: -1 };
        cfActiveRef.current = true;
        // eslint-disable-next-line react-hooks/purity -- 异步回调内取时间戳，非渲染期
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min((now - start) / ms, 1);
          const main = activeAudio();
          if (main) main.volume = Math.cos((t * Math.PI) / 2); // 等功率：cos²+sin²=1
          b.volume = Math.sin((t * Math.PI) / 2);
          if (t < 1 && cfActiveRef.current && !cfEngineRef.current) {
            cfRafRef.current = requestAnimationFrame(tick);
          }
        };
        cfRafRef.current = requestAnimationFrame(tick);
        window.setTimeout(() => {
          if (cfActiveRef.current && !cfEngineRef.current) finishCrossfade();
        }, ms + 80);
      }
    } catch {
      // 预取 / 自动播放失败：放弃过渡，硬切到下一首
      cfActiveRef.current = false;
      cfEngineRef.current = false;
      cfPendingRef.current = null;
      playPlaylistSong(nextSong, { ...q, index: nextIdx }).catch(() => {});
    }
  };

  const finishCrossfade = () => {
    const pending = cfPendingRef.current;
    cfActiveRef.current = false;
    cancelAnimationFrame(cfRafRef.current);
    cfPendingRef.current = null;
    if (!pending) return;
    const q = pending.q;
    q.index = pending.nextIdx;
    queueRef.current = q;
    setPlayingId(q.songs[pending.nextIdx].id);
    // 歌词转场柔化：切换瞬间隧道歌词面板快速淡隐再浮现
    rootRef.current?.classList.add("switching");
    window.setTimeout(() => rootRef.current?.classList.remove("switching"), 380);

    if (pending.engine && engineRef.current) {
      // 引擎路径：副槽已满格接管，退掉旧槽并还原被塑形的参数
      const eng = engineRef.current;
      const nxt = eng.slots[pending.slotIdx];
      const cur = eng.slots[1 - pending.slotIdx];
      resetSlot(cur, eng.ctx);
      stopSlot(cur, eng.ctx);
      localSlotRef.current = pending.slotIdx;
      preloadedSlotRef.current = pending.slotIdx; // 让 song effect 跳过重复 set src
      cfEngineRef.current = false;
      const seekTo = Number.isFinite(nxt.el.currentTime) ? nxt.el.currentTime : 0;
      loadSong(pending.prepared, { seekTo, noFadeIn: true });
      return;
    }

    const b = cfAudioRef.current;
    cfAudioRef.current = null;
    cfEngineRef.current = false;
    const seekTo = b && Number.isFinite(b.currentTime) ? b.currentTime : 0;
    if (b) {
      b.pause();
      b.removeAttribute("src");
      b.load();
    }
    loadSong(pending.prepared, { seekTo, noFadeIn: true });
  };

  /* 切歌落地：按音源同源性选择播放路径。
     本地同源 → Web Audio 引擎槽（能用 AudioParam 排程与音色塑形）；
     在线跨域 → 原生 <audio>（跨域音频进 Web Audio 图会静音）。
     单曲循环靠原生 loop；歌单列表/随机循环关 loop 让 ended 驱动切歌；
     非歌单来源（本地曲库 / 导入）保持原生循环。模式实时读歌单数据。 */
  useEffect(() => {
    songRef.current = song;
    const seekTo = pendingSeekRef.current;
    pendingSeekRef.current = null;
    const skipIn = fadeSkipRef.current;
    fadeSkipRef.current = false;
    const preSlot = preloadedSlotRef.current;
    preloadedSlotRef.current = null;
    /* 路径互斥：本地引擎槽与在线原生 <audio> 互斥——此前两条分支互不停对方，
       播本地歌时点搜索试听会两首同响（0.4.32 反馈）。交叉淡化收尾（skipIn）
       的退场由 finishCrossfade 负责，这里只管「点播/试听」的路径切换；
       stopSlot 自带 src 守卫，不会误杀同 tick 内被复用的槽。 */
    if (!(skipIn && preSlot !== null) && !cfActiveRef.current) {
      const eng = engineRef.current;
      if (eng) {
        stopSlot(eng.slots[0], eng.ctx);
        stopSlot(eng.slots[1], eng.ctx);
      }
      const online = audioRef.current;
      if (online && !online.paused) {
        online.pause();
        online.removeAttribute("src");
        online.load();
      }
    }
    const useLoop = queueRef.current ? queueLoopMode() === "single" : true;

    if (isSameOriginSrc(song.audioUrl)) {
      /* ---- 本地路径：引擎槽 ---- */
      curKindRef.current = "local";
      const eng = ensureEngine();
      if (skipIn && preSlot !== null) {
        // 引擎内交叉淡化已完成、副槽正在响：只接管状态，不重排音频
        localSlotRef.current = preSlot;
        return;
      }
      const slot = eng.slots[localSlotRef.current];
      resetSlot(slot, eng.ctx);
      slot.el.loop = useLoop;
      slot.el.removeAttribute("src");
      slot.el.src = song.audioUrl;
      try {
        slot.el.currentTime = seekTo ?? 0;
      } catch {
        /* metadata 未就绪时浏览器会自己排队 seek */
      }
      if (autoplayRef.current) {
        autoplayRef.current = false;
        if (skipIn) {
          startSlotAtFull(slot, eng.ctx);
          slot.el.play().catch(() => {});
        } else {
          slot.el
            .play()
            .then(() => waFadeIn(slot, 1.5, eng.ctx))
            .catch(() => startSlotAtFull(slot, eng.ctx));
        }
      }
      return;
    }

    /* ---- 在线路径：原生 <audio> ---- */
    curKindRef.current = "online";
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = useLoop;
    audio.removeAttribute("src");
    audio.src = song.audioUrl;
    try {
      audio.currentTime = seekTo ?? 0;
    } catch {
      /* metadata 未就绪时浏览器会自己排队 seek */
    }
    if (autoplayRef.current) {
      autoplayRef.current = false;
      cancelAnimationFrame(fadeRafRef.current);
      if (skipIn) {
        // 过渡续接：音量立即满格（副音频正在响，淡入会断音）
        audio.volume = 1;
        audio.play().catch(() => {});
      } else {
        // 手动点歌：从静音淡入，柔和过渡
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

  /* 引擎槽是命令式创建的元素，事件只能用 addEventListener 挂；
     通过 ref 转发到「最新一次渲染」的处理函数，避免闭包读到旧 state。 */
  const handlersRef = useRef<{
    time: () => void;
    ended: () => void;
    play: () => void;
    pause: () => void;
    err: () => void;
  }>({ time: () => {}, ended: () => {}, play: () => {}, pause: () => {}, err: () => {} });

  useEffect(() => {
    const eng = ensureEngine();
    const offs = eng.slots.map((slot) => {
      const onTime = () => handlersRef.current.time();
      const onEnded = () => handlersRef.current.ended();
      const onPlayEv = () => handlersRef.current.play();
      const onPauseEv = () => handlersRef.current.pause();
      const onErr = () => handlersRef.current.err();
      slot.el.addEventListener("timeupdate", onTime);
      slot.el.addEventListener("ended", onEnded);
      slot.el.addEventListener("play", onPlayEv);
      slot.el.addEventListener("pause", onPauseEv);
      slot.el.addEventListener("error", onErr);
      return () => {
        slot.el.removeEventListener("timeupdate", onTime);
        slot.el.removeEventListener("ended", onEnded);
        slot.el.removeEventListener("play", onPlayEv);
        slot.el.removeEventListener("pause", onPauseEv);
        slot.el.removeEventListener("error", onErr);
      };
    });
    return () => offs.forEach((off) => off());
  }, []);

  /* 静音开关要同时作用到在线 <audio> 与本地引擎槽。 */
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
    engineRef.current?.slots.forEach((slot) => {
      slot.el.muted = muted;
    });
  }, [muted]);

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

  /** 本地曲库歌 → 队列条目（source="local"，播放走 /api/audio）。 */
  const trackToQueueSong = (t: Track): PlaylistSong => ({
    id: t.id,
    source: "local",
    name: t.title,
    artist: t.artist,
    duration: 0,
    hasLyric: t.hasLyric,
  });

  /* 播放列表点歌：把曲库**当前展示顺序**做成队列（虚拟 id），
     于是播完会自动续下一首、上一首/下一首也走无缝衔接。
     若没传 list（个别调用点），退回无队列 → 原生单曲循环。 */
  const playTrack = async (track: Track, list?: Track[]) => {
    cancelCrossfade();
    const songs = list && list.length > 0 ? list.map(trackToQueueSong) : [];
    const index = Math.max(0, songs.findIndex((s) => s.id === track.id));
    queueRef.current =
      songs.length > 0 ? { playlistId: LIBRARY_QUEUE_ID, songs, index } : null;
    setHasQueue(queueRef.current !== null);
    setPlayingId(track.id);
    await loadLocalTrack(track);
  };

  /* 搜索歌曲试听：在线歌取直链+歌词后直接交给主播放器（隧道歌词接管），
     不进歌单队列 —— 与 playTrack 一样恢复原生循环。 */
  const previewOnlineSong = async (song: GdSong) => {
    cancelCrossfade();
    queueRef.current = null;
    setHasQueue(false);
    setPlayingId(song.id);
    try {
      const [{ url: audioUrl }, lyric] = await Promise.all([
        gdGetUrl(song.id, song.source, 999),
        gdGetLyric(song.id, song.source, song.name, song.artist).catch(() => ({
          lrc: null as string | null,
          tlyric: null as string | null,
        })),
      ]);
      const fallback = Math.max(Math.round(song.duration) || 240, 60);
      if (lyric.lrc) {
        loadSong(
          songDataFromLyrics(
            parseLyrics(lyric.lrc, lyric.tlyric || null),
            fallback,
            audioUrl,
            song.name,
            song.artist,
          ),
        );
      } else {
        loadSong(buildSongData([], [], fallback, audioUrl, song.name, song.artist));
      }
    } catch {
      /* 试听失败（无音源 / 网络）就停在当前状态，不打断正在播的歌 */
    }
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
     本地曲库歌（source="local"）走 /api/audio，其余浏览器直连 GD 免签名
     公共 API（music-api.gdstudio.xyz，见 gd-client.ts）拿 CDN 直链与歌词。 */
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

  /* 处理函数每次渲染刷新到 ref —— 引擎槽的 addEventListener 读它，
     这样监听只挂一次而闭包永远是最新的。 */
  useEffect(() => {
    handlersRef.current = {
      time: handleTimeUpdate,
      ended: handleEnded,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      // 音源加载失败（文件不存在 / 目录未设置）给可见提示，不再静默吞掉。
      err: () => showNotice(PLAY_FAIL_HINT),
    };
  });

  /* 上一首 / 下一首：队列来源（真实歌单 或 本地曲库虚拟队列）内移动。
     开着无缝衔接 → 立即起过渡；关掉 → 硬切。 */
  const skipBy = (delta: number) => {
    const q = queueRef.current;
    if (q && q.songs.length > 1) {
      const mode = queueLoopMode();
      let next: number;
      if (mode === "random") {
        do {
          next = Math.floor(Math.random() * q.songs.length);
        } while (next === q.index);
      } else {
        next = (q.index + delta + q.songs.length) % q.songs.length;
      }
      if (seamlessRef.current && !cfActiveRef.current) {
        // eslint-disable-next-line react-hooks/immutability -- 事件回调内标记本首已触发，非渲染期
        cfTriggeredRef.current = true;
        void beginTransition(q.songs[next], next, q);
      } else {
        playPlaylistSong(q.songs[next], { ...q, index: next }).catch(() => {});
      }
      return;
    }
    // 无队列（搜索试听 / 导入）：重头播当前这首
    const a = activeAudio();
    if (a) a.currentTime = 0;
  };

  /* 过渡预热：歌一开播就把「下一首的数据 + 过渡计划」备好。
     两个作用——① 触发窗口能按计划时长自适应（8~16s 的长交叉必须更早开始）；
     ② 淡入时不用现取直链，不会卡。 */
  useEffect(() => {
    planRef.current = null;
    nextPrepRef.current = null;
    const q = queueRef.current;
    if (!q || q.songs.length < 2 || !seamlessRef.current) return;
    if (queueLoopMode() === "single") return;

    let cancelled = false;
    const mode = queueLoopMode();
    let next = (q.index + 1) % q.songs.length;
    if (mode === "random" && q.songs.length > 1) {
      do {
        next = Math.floor(Math.random() * q.songs.length);
      } while (next === q.index);
    }

    void (async () => {
      const curDur = activeAudio()?.duration || song.fallbackDuration;
      const prepared = await preparePlaylistSong(q.songs[next]);
      if (cancelled) return;
      // 能量分析（本地解波形、在线走启发式）——算好再决策，拿不到就用启发式
      const [aEnergy, bEnergy] = await Promise.all([
        resolveEnergy(song.audioUrl, song, curDur),
        resolveEnergy(prepared.audioUrl, prepared, prepared.fallbackDuration),
      ]);
      if (cancelled) return;
      planRef.current = decideTransition(
        { lyrics: analyzeLyrics(song, curDur), energy: aEnergy },
        {
          lyrics: analyzeLyrics(prepared, prepared.fallbackDuration),
          energy: bEnergy,
        },
      );
      nextPrepRef.current = { prepared, nextIdx: next, q };
    })().catch(() => {
      /* 预热失败就退回"触发时现取 + 兜底 6s" */
    });

    return () => {
      cancelled = true;
    };
  }, [song, activeAudio]);

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
  }, []);

  /* 悬停显隐：两个角落菜单默认残影，鼠标靠近浮现；展开时区域内锁定，
     远离约 320px 自动收起并渐隐（用户点击展开后去点小按钮的路上不消失）。 */
  useEffect(() => {
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
  }, []);

  /* dock 子按钮：收起菜单再开抽屉 ------------------------------------ */
  const openDrawer = (key: DrawerKey) => {
    dockCloseRef.current();
    setDrawer(key);
  };

  /** 本地路径的 AudioContext 会因自动播放策略处于挂起态，播放前唤醒。 */
  const resumeIfLocal = () => {
    if (curKindRef.current !== "local") return;
    const ctx = engineRef.current?.ctx;
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
  };

  const togglePlay = () => {
    const audio = activeAudio();
    if (!audio) return;
    if (audio.paused) {
      resumeIfLocal();
      /* 本地槽音量只由 master.gain 决定。初次挂载加载的歌 master 还停在 0，
         只 play() 会「元素在播、完全没声」——起播前确保槽处于满增益。 */
      if (curKindRef.current === "local" && !cfActiveRef.current) {
        const eng = engineRef.current;
        const slot = eng?.slots[localSlotRef.current];
        if (eng && slot) startSlotAtFull(slot, eng.ctx);
      }
      audio.play().catch(() => showNotice(PLAY_FAIL_HINT));
    } else {
      audio.pause();
    }
  };

  const restart = () => {
    const audio = activeAudio();
    if (audio) audio.currentTime = 0;
  };

  const forward = () => {
    const audio = activeAudio();
    if (!audio) return;
    audio.currentTime = Math.min(audio.currentTime + 10, (audio.duration || Infinity) - 0.05);
  };

  return (
    <div className={`karl-site animal-cursor--force${fullOpen ? " immersive-on" : ""}`} ref={rootRef}>
      <TunnelScene />
      <BalloonScene />
      <SiteFooter />
      <SectionBehind />
      {/* 在线（跨域）音源的播放器。本地同源歌走 Web Audio 引擎槽；
          src 一律命令式下发（见切歌 effect），所以这里不绑 src。 */}
      <audio
        ref={audioRef}
        preload="auto"
        muted={muted}
        onError={() => showNotice(PLAY_FAIL_HINT)}
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
      />

      {/* 短提示（播放失败等），约 4.5s 自动消失 */}
      {notice && (
        <div className="karl-notice" role="status">
          {notice}
        </div>
      )}

      {/* 左下角：播放控制径向菜单 */}
      {
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
          {/* 上一首 / 下一首：**一个圆由左右两个半圆拼成** ——
              左半圆是「上一首」，右半圆是「下一首」，两块拼起来正好是一个圆形。
              必须包 Tooltip：其他子按钮的绝对定位与 GSAP 扇形锚点都挂在
              Tooltip 生成的 animal-tooltipWrapper 上（见 setupRadial 注释）。 */}
          <Tooltip title="上一首 / 下一首">
            <div className="fab-item fab-skip">
              <button
                type="button"
                className="fab-half fab-half-prev"
                aria-label="上一首"
                onClick={() => skipBy(-1)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="7" y1="6" x2="7" y2="18" />
                  <polygon points="18 6 9.5 12 18 18" />
                </svg>
              </button>
              <button
                type="button"
                className="fab-half fab-half-next"
                aria-label="下一首"
                onClick={() => skipBy(1)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="17" y1="6" x2="17" y2="18" />
                  <polygon points="6 6 14.5 12 6 18" />
                </svg>
              </button>
            </div>
          </Tooltip>
          <button type="button" className="fab" aria-label="播放控制" aria-expanded="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      }

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
        <Tooltip title="设置">
          <button type="button" className="fab-item" aria-label="设置" onClick={() => openDrawer("settings")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
        <SearchPanel onPreview={(song) => void previewOnlineSong(song)} />
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
        className="drawer-playlist"
        onClose={() => setDrawer(null)}
      >
        <PlaylistPanel
          active={drawer === "playlist"}
          currentUrl={song.audioUrl}
          onPlayTrack={(track, list) => void playTrack(track, list)}
        />
      </AnimalDrawer>

      <AnimalDrawer
        open={drawer === "settings"}
        title="设置"
        placement="right"
        width={420}
        onClose={() => setDrawer(null)}
      >
        <SettingsPanel
          seamless={seamless}
          onChangeSeamless={changeSeamless}
          musicDirs={musicDirs}
          dirChanging={dirChanging}
          onChangeMusicDir={() => void changeMusicDir()}
        />
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
