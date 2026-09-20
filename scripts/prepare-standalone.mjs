/**
 * next build 之后的整理步骤。
 *
 * 1. Turbopack 的 standalone 组装在本项目配置下只产出 .next/static——
 *    SSR 产物（.next/server/）、required-server-files.json 等全部缺失，
 *    运行时 /_next/static 一律 404（界面裸 HTML）。这里从 .next2 手工
 *    合成完整 .next：static + server + 顶层清单文件。
 * 2. 把 public 拷进 standalone。
 *
 * 用 robocopy 而不是 fs.cpSync：受管环境里 cpSync 对目录树会无声卡死
 * （after-pack.cjs 同款教训）。robocopy 退出码 0-7 均为成功。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, ".next2");
const standalone = path.join(dist, "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("未找到 .next2/standalone/server.js —— 先跑 `npm run build`。");
  process.exit(1);
}

function robocopy(src, dest) {
  try {
    execFileSync(
      "robocopy",
      [src, dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"],
      { stdio: "ignore" },
    );
  } catch (err) {
    // robocopy 退出码 0-7 都是成功（1=有文件拷贝），execFileSync 会当异常抛出
    const rc = typeof err.status === "number" ? err.status : 16;
    if (rc >= 8) {
      throw new Error(`robocopy 失败（退出码 ${rc}）：${src} → ${dest}`);
    }
  }
}

// 注意：standalone 内部的 .next/ 目录名是 Next 运行时固定约定，不随项目 distDir 改名
const dotNext = path.join(standalone, ".next");

robocopy(path.join(dist, "static"), path.join(dotNext, "static"));
robocopy(path.join(dist, "server"), path.join(dotNext, "server"));

// 顶层清单：server 运行必需，缺一即 404/启动异常
const topFiles = [
  "required-server-files.json",
  "BUILD_ID",
  "routes-manifest.json",
  "prerender-manifest.json",
  "app-path-routes-manifest.json",
  "build-manifest.json",
  "fallback-build-manifest.json",
  "images-manifest.json",
  "export-marker.json",
];
let copied = 0;
for (const f of topFiles) {
  const src = path.join(dist, f);
  if (existsSync(src)) {
    copyFileSync(src, path.join(dotNext, f));
    copied += 1;
  }
}

// standalone 根的 package.json（server 端依赖声明）
const pkgSrc = path.join(dist, "package.json");
const pkgDest = path.join(standalone, "package.json");
if (existsSync(pkgSrc) && !existsSync(pkgDest)) {
  copyFileSync(pkgSrc, pkgDest);
}

const publicDir = path.join(root, "public");
if (existsSync(publicDir)) {
  robocopy(publicDir, path.join(standalone, "public"));
}

// distDir 迁移的收尾：server.js 内联 config 与 required-server-files.json 里的
// 路径引用（distDir / distDirRoot / configFilePaths…）都写着 ".next2"，
// 而 standalone 内部目录名固定是 ".next"——不替换的话 /_next/static 全 404。
// （这就是 0.4.7~0.4.9 首版界面裸 HTML 的根因。）
const replacements = [
  path.join(standalone, "server.js"),
  path.join(dotNext, "required-server-files.json"),
];
for (const file of replacements) {
  if (!existsSync(file)) continue;
  const raw = readFileSync(file, "utf8");
  const count = (raw.match(/\.next2/g) || []).length;
  if (count > 0) {
    writeFileSync(file, raw.split(".next2").join(".next"));
    console.log(`${path.basename(file)}：已替换 ${count} 处 .next2 → .next`);
  }
}

console.log(
  `standalone 已整理：.next 合成完毕（static + server + ${copied} 个顶层清单）、public 已拷入。`,
);
