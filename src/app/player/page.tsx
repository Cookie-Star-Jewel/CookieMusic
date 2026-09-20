import type { Metadata } from "next";
import PlayerExperience from "@/components/sites/karlgonsalves-com-83bf3ea7/player/PlayerExperience";

export const metadata: Metadata = {
  title: "动物岛音乐 · 滚动歌词播放器",
};

export default function PlayerRoute() {
  return <PlayerExperience />;
}
