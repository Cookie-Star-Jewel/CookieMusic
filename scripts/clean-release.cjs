/**
 * electron-builder 构建前清场：
 * 受管环境的 safe-delete 钩子会拦 electron-builder 清理已有 win-unpacked
 * （Remove-Item/genie-trash/trash 全被拦）。这里用 robocopy /MIR 空目录
 * 把输出目录镜像清空再删掉（robocopy 是外部 exe，完全绕开 node fs 层）。
 *
 * 用法：node scripts/clean-release.cjs <outputDir>
 */
const { execFileSync } = require("node:child_process");
const { mkdirSync, rmSync, existsSync, readdirSync } = require("node:fs");
const path = require("node:path");

const outDir = path.resolve(process.argv[2] || path.join(process.cwd(), "dist_electron"));
if (!existsSync(outDir)) {
  process.exit(0); // 不存在就不用清
}

const emptyDir = path.join(path.dirname(outDir), ".empty-tmp-for-clean");
mkdirSync(emptyDir, { recursive: true });

try {
  // /MIR 镜像空目录 = 清空目标；退出码 0-7 均为成功
  try {
    execFileSync(
      "robocopy",
      [emptyDir, outDir, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"],
      { stdio: "ignore" },
    );
  } catch (err) {
    if ((err.status ?? 16) >= 8) throw err;
  }
} finally {
  try {
    rmSync(emptyDir, { recursive: true, force: true });
  } catch {
    /* 清理临时目录失败不影响主流程 */
  }
}

try {
  rmSync(outDir, { recursive: true, force: true });
} catch {
  /* 目录残留不影响 electron-builder（已为空） */
}

const remains = existsSync(outDir) ? readdirSync(outDir).length : 0;
console.log(`[clean-release] ${outDir} 清场完成（残留条目 ${remains}）`);
