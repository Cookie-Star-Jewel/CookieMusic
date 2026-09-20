"use client";

import { useEffect, useState } from "react";
import { fmtTime } from "./TrackList";
import type { PlayerEngine } from "./usePlayerEngine";

/** 播放控制条。时钟单独放在这里，避免每 200ms 重渲染整条 3D 隧道。 */
export default function PlayerBar({ engine }: { engine: PlayerEngine }) {
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(engine.live.current?.time ?? 0), 200);
    return () => window.clearInterval(timer);
  }, [engine.live]);

  const hasTrack = engine.current !== null;
  const duration = engine.duration;
  const progress = duration > 0 ? Math.min(1, clock / duration) : 0;

  return (
    <div className="player-bar">
      <div className="player-now">
        <div className="player-now-title">{engine.current?.title ?? "还没有选歌"}</div>
        <div className="player-now-meta">
          {hasTrack
            ? [
                engine.current?.artist || "未知歌手",
                engine.current?.ext,
                engine.lines.length > 0
                  ? `${engine.lines.length} 句歌词`
                  : "无歌词（滚动仍可控制进度）",
              ].join(" · ")
            : "去「播放列表」或「歌曲搜索」挑一首"}
        </div>
      </div>

      <div className="player-controls">
        <button type="button" className="player-btn" onClick={() => engine.step(-1)} disabled={!hasTrack}>
          上一首
        </button>
        <button type="button" className="player-btn primary" onClick={engine.toggle}>
          {engine.playing ? "暂停" : "播放"}
        </button>
        <button type="button" className="player-btn" onClick={() => engine.step(1)} disabled={!hasTrack}>
          下一首
        </button>
      </div>

      <div className="player-bar-right">
        <span className="player-clock">
          {fmtTime(clock)} / {fmtTime(duration)}
        </span>
        <div className="player-progress">
          <div className="player-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="player-hint">滚轮就是进度条 · 滚到哪句就唱到哪句</span>
      </div>
    </div>
  );
}
