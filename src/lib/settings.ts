/**
 * 播放器设置（localStorage）。
 *
 * 目前只有一项：「无缝衔接上下歌曲」（智能交叉淡化）开关。
 * 主进程的 config.json 只有 get / dir:choose，没有 set，所以开关走
 * localStorage 最省事，也和 playlists.ts 的做法一致。
 */

export interface PlayerSettings {
  /** 无缝衔接（交叉淡化）开关；关闭时切歌直接硬切。 */
  seamless: boolean;
}

const KEY = "cookiemusic.settings";

const DEFAULTS: PlayerSettings = { seamless: true };

/** 读取设置；解析失败或未写过时回退默认值（seamless 默认开）。 */
export function loadSettings(): PlayerSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    return { seamless: parsed.seamless !== false };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 合并写入并返回最新设置。 */
export function saveSettings(patch: Partial<PlayerSettings>): PlayerSettings {
  const next = { ...loadSettings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式等写入失败时忽略，仅本次会话生效 */
  }
  window.dispatchEvent(new Event("settings-changed"));
  return next;
}
