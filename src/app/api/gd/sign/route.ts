import { gdSignUrlencoded } from "@/lib/gd-signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GD 签名服务：server 端 node:vm 执行官方混淆 crc32.min.js，纯计算不发请求。
 * 实际的 api.php 请求由浏览器渲染进程发起（api.php 拒绝非浏览器 TLS 指纹，
 * 而 Electron/Chrome 的浏览器指纹可直连，且 api.php CORS 全开放）。
 */
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("input") ?? "";
  try {
    return Response.json(
      { ok: true, sig: gdSignUrlencoded(input) },
      { headers: { "Access-Control-Allow-Origin": "*" } },
    );
  } catch (err: unknown) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "签名失败" },
      { status: 500 },
    );
  }
}
