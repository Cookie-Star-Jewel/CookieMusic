import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 320;

/**
 * GD 下载落盘（新版）：
 * 前端先 gdGetUrl 拿 CDN 直链、gdGetLyric 拿歌词，然后带到这里。
 * 为什么 server 下载可行：api.php 拒绝非浏览器 TLS 指纹，但 CDN 直链没有
 * 指纹校验（实测 Node fetch 可下），所以流式落盘放 server 端。
 *
 * 保存目录：Electron 打包后由主进程传 GD_SAVE_DIR；dev 环境回退 E:\MUSIC\mmPlayer。
 */

const SAVE_DIR = process.env.GD_SAVE_DIR ?? "E:\\MUSIC\\mmPlayer";

/** Windows 文件名非法字符清理（对齐原 gd_core.py 的 sanitize）。 */
function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

interface Body {
  url?: string;
  title?: string;
  artist?: string;
  br?: number;
  lrc?: string | null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "请求体不是 JSON" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  const title = (body.title ?? "").trim();
  const artist = (body.artist ?? "").trim();
  const br = Number(body.br ?? 999);
  const lrc = typeof body.lrc === "string" && body.lrc.trim() ? body.lrc : null;

  if (!url || !title) {
    return Response.json({ ok: false, error: "缺少 url / title" }, { status: 400 });
  }

  // 扩展名：优先从 CDN 直链路径取，取不到按 br 推断（999/740 无损 → flac，320 → mp3）
  let ext = "";
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const match = pathname.match(/\.(flac|mp3|m4a|wav|ape|ogg)$/i);
    if (match) ext = match[1].toLowerCase();
  } catch {
    /* url 解析失败就按 br 推断 */
  }
  if (!ext) ext = br >= 740 ? "flac" : "mp3";

  const base = sanitize(artist ? `${title} - ${artist}` : title);
  const audioPath = path.join(SAVE_DIR, `${base}.${ext}`);
  const lrcPath = path.join(SAVE_DIR, `${base}.lrc`);

  try {
    await mkdir(SAVE_DIR, { recursive: true });

    const res = await fetch(url, { redirect: "follow", cache: "no-store" });
    if (!res.ok || !res.body) {
      return Response.json({ ok: false, error: `音源下载失败 HTTP ${res.status}` }, { status: 502 });
    }

    await pipeline(
      Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>),
      createWriteStream(audioPath),
    );

    let lyricNote = "未获取到歌词";
    if (lrc) {
      try {
        await writeFile(lrcPath, lrc, "utf8");
        lyricNote = "歌词已保存";
      } catch {
        lyricNote = "音频已保存，但歌词写入失败";
      }
    }

    return Response.json({
      ok: true,
      info: `${ext.toUpperCase()} · ${br}K`,
      lyric: lyricNote,
      file: audioPath,
    });
  } catch (error: unknown) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "下载失败" },
      { status: 502 },
    );
  }
}
