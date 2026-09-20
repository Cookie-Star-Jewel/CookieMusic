import { scanLibrary } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const tracks = await scanLibrary(force);
  return Response.json({ count: tracks.length, tracks });
}
