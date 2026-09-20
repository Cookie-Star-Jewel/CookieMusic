import { deleteTrack } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 从硬盘删除一首歌（含同名 .lrc），body: { id: string }。 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) {
    return Response.json({ error: "缺少 id" }, { status: 400 });
  }
  const result = await deleteTrack(body.id);
  if (result.error) {
    return Response.json(result, { status: 400 });
  }
  return Response.json({ ok: true });
}
