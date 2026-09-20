"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// 隧道几何复用克隆站的样式表，player.css 必须排在后面才能覆盖它。
import "../root-8a5edab2/karlgonsalves.css";
import "./player.css";
import NowPlayingPanel from "./NowPlayingPanel";
import PlaylistPanel from "./PlaylistPanel";
import SearchPanel from "./SearchPanel";
import { usePlayerEngine } from "./usePlayerEngine";

const PANELS = [
  { key: "now", label: "正在播放" },
  { key: "search", label: "歌曲搜索" },
  { key: "list", label: "播放列表" },
] as const;

/**
 * 音乐播放器外壳（路由 /player）。
 *
 * 顶部导航只做一件事：切换三块全屏层。它不参与滚动 —— 滚动完全属于「正在播放」
 * 里的歌词隧道。原站把这两件事缠在一条 scroll 参数上，这里刻意拆开。
 */
export default function PlayerExperience() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const engine = usePlayerEngine(audioRef);
  const [active, setActive] = useState(0);

  const { toggle, step } = engine;

  /** 空格暂停/播放，左右方向键切歌；在输入框里打字时不拦。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowRight" && event.altKey) {
        step(1);
      } else if (event.key === "ArrowLeft" && event.altKey) {
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step]);

  const pick = useCallback(
    (id: string) => {
      engine.select(id);
      setActive(0);
    },
    [engine],
  );

  return (
    <div className="karl-site player-site">
      <nav className="player-nav">
        {PANELS.map((panel, index) => (
          <button
            key={panel.key}
            type="button"
            className={`menu_button button_0${index + 1} w-button`}
            data-active={index === active}
            onClick={() => setActive(index)}
          >
            {panel.label}
          </button>
        ))}
      </nav>

      <div className="player-stage">
        <section
          className="player-panel"
          data-state={active === 0 ? "active" : active > 0 ? "off-left" : "off-right"}
          aria-hidden={active !== 0}
        >
          <NowPlayingPanel engine={engine} />
        </section>

        <section
          className="player-panel"
          data-state={active === 1 ? "active" : active > 1 ? "off-left" : "off-right"}
          aria-hidden={active !== 1}
        >
          <SearchPanel engine={engine} onPick={pick} />
        </section>

        <section
          className="player-panel"
          data-state={active === 2 ? "active" : "off-right"}
          aria-hidden={active !== 2}
        >
          <PlaylistPanel engine={engine} onPick={pick} />
        </section>
      </div>

      <audio ref={audioRef} preload="metadata" />
    </div>
  );
}
