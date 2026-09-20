import { decodeId, readLyricFiles } from "@/lib/library";
import { parseLyrics } from "@/lib/lrc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const file = decodeId(id);
  if (!file) return Response.json({ error: "bad id" }, { status: 400 });

  const { lrc, tlyric } = await readLyricFiles(file);
  if (!lrc) return Response.json({ lines: [], meta: {}, synced: false });

  return Response.json(parseLyrics(lrc, tlyric));
}
