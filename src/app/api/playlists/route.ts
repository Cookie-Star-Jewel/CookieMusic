import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 歌单持久化：存到音乐目录下 .pixelmusic/playlists.json，
 * 与音乐文件同生共死——应用卸载/重装不再丢歌单。
 * saveDir 由 Electron 主进程经 GD_SAVE_DIR 注入。
 */

function storeFile(): string | null {
  const saveDir = process.env.GD_SAVE_DIR || process.env.MUSIC_ROOTS?.split(path.delimiter)[0];
  if (!saveDir) return null;
  return path.join(saveDir, ".pixelmusic", "playlists.json");
}

function readStore(): unknown[] {
  const file = storeFile();
  if (!file || !existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const file = storeFile();
  if (!file) {
    return Response.json({ error: "未配置音乐目录", playlists: [] }, { status: 500 });
  }
  return Response.json({ playlists: readStore() });
}

export async function POST(request: Request) {
  const file = storeFile();
  if (!file) {
    return Response.json({ error: "未配置音乐目录" }, { status: 500 });
  }
  const body = (await request.json().catch(() => null)) as { playlists?: unknown } | null;
  if (!body || !Array.isArray(body.playlists)) {
    return Response.json({ error: "缺少 playlists 数组" }, { status: 400 });
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body.playlists, null, 2), "utf8");
  } catch {
    return Response.json({ error: "歌单文件写入失败" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
