"use client";

import { useMemo } from "react";
import type { Track } from "@/lib/track";

export function fmtTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface Props {
  tracks: Track[];
  currentId: string | null;
  onPick: (id: string) => void;
  /** group rows by their folder */
  grouped?: boolean;
}

export default function TrackList({ tracks, currentId, onPick, grouped = false }: Props) {
  const groups = useMemo(() => {
    if (!grouped) return [{ folder: "", items: tracks }];
    const map = new Map<string, Track[]>();
    for (const track of tracks) {
      const list = map.get(track.folder);
      if (list) list.push(track);
      else map.set(track.folder, [track]);
    }
    return Array.from(map.entries()).map(([folder, items]) => ({ folder, items }));
  }, [grouped, tracks]);

  if (tracks.length === 0) {
    return <div className="player-empty">没有匹配的歌曲</div>;
  }

  let index = 0;

  return (
    <>
      {groups.map((group) => (
        <div key={group.folder || "all"}>
          {grouped && group.folder ? (
            <div className="player-group">
              {group.folder} · {group.items.length} 首
            </div>
          ) : null}
          {group.items.map((track) => {
            index += 1;
            return (
              <button
                key={track.id}
                type="button"
                className="player-row"
                data-current={track.id === currentId}
                onClick={() => onPick(track.id)}
                title={track.title}
              >
                <span className="player-row-idx">{index}</span>
                <span className="player-row-name">{track.title}</span>
                <span className="player-row-sub">{track.artist || "未知歌手"}</span>
                <span className="player-tag player-col-hide">{track.ext}</span>
                <span className="player-row-sub player-col-hide">{track.sizeMB} MB</span>
                <span className={`player-tag${track.hasLyric ? " on" : ""}`}>
                  {track.hasLyric ? "有歌词" : "无歌词"}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
