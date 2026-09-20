"use client";

import LyricStage from "./LyricStage";
import PlayerBar from "./PlayerBar";
import type { PlayerEngine } from "./usePlayerEngine";

/** 「正在播放」板块：3D 隧道 + 歌词环，底下压一条播放控制条。 */
export default function NowPlayingPanel({ engine }: { engine: PlayerEngine }) {
  return (
    <>
      <LyricStage
        lines={engine.lines}
        live={engine.live}
        playing={engine.playing}
        duration={engine.duration}
        title={engine.current?.title ?? ""}
        seek={engine.seek}
      />
      <PlayerBar engine={engine} />
    </>
  );
}
