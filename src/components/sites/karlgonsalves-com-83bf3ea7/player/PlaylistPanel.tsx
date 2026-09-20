"use client";

import TrackList from "./TrackList";
import type { PlayerEngine } from "./usePlayerEngine";

interface Props {
  engine: PlayerEngine;
  onPick: (id: string) => void;
}

/** 「播放列表」板块 —— 按文件夹分组的完整曲库。 */
export default function PlaylistPanel({ engine, onPick }: Props) {
  const withLyric = engine.tracks.filter((track) => track.hasLyric).length;

  return (
    <div className="player-sheet">
      <div className="player-head">
        <div>
          <h2 className="player-title">播放列表</h2>
          <p className="player-sub">
            共 {engine.tracks.length} 首 · 其中有歌词 {withLyric} 首
            {engine.loadingLibrary ? " · 扫描中…" : ""}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="player-btn" onClick={engine.reloadLibrary}>
          重新扫描
        </button>
      </div>

      <div className="player-rows">
        {engine.libraryError ? (
          <div className="player-empty">
            曲库读取失败：{engine.libraryError}
            <br />
            检查目录是否存在，或用环境变量 <code>MUSIC_ROOTS</code> 指定。
          </div>
        ) : (
          <TrackList
            tracks={engine.tracks}
            currentId={engine.current?.id ?? null}
            onPick={onPick}
            grouped
          />
        )}
      </div>

      <p className="player-foot-note">
        没有歌词的曲子，跑 <code>E:\MUSIC\mmPlayer\补歌词.bat</code> 批量补齐
        （GD音乐台优先、lrclib 兜底，带翻译轨；默认干跑出报告，确认后加 <code>--apply</code> 写盘）。
        补完回到这里点「重新扫描」即可。
      </p>
    </div>
  );
}
