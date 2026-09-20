import * as OpenCC from "opencc-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 繁转简（对齐原 gd_core.py 的 to_simplified 语义）：
 * GD 返回的歌词多为繁体（尤其 kugou/kuwo 源），过一遍 opencc 再给前端。
 * 放在 server 端做：opencc-js 体积不小，没必要打进浏览器 bundle。
 */

// 模块级缓存转换器（OpenCC 字典构建有一定开销，进程内复用）
const convert = OpenCC.Converter({ from: "t", to: "cn" });

interface Body {
  text?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "请求体不是 JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  if (!text) return Response.json({ ok: true, text: "" });

  try {
    return Response.json({ ok: true, text: convert(text) });
  } catch (error: unknown) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "转换失败" },
      { status: 500 },
    );
  }
}
