/**
 * electron-builder afterPack 钩子：
 * extraResources 搬运 .next/standalone 时会剥掉 node_modules（实测丢失），
 * pack 完成后在这里把 standalone/node_modules 补拷进 resources/server。
 *
 * 为什么用 robocopy 而不是 fs.cpSync：受管环境里 node 的 cpSync 对这个
 * 目录树会无声卡死（连最小的 @emnapi 包都过不去，疑似 fs 监控层死锁），
 * robocopy 是系统原生命令，完全绕开 node fs 层。退出码 0-7 均为成功。
 */
const { execFileSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const src = path.join(process.cwd(), ".next3", "standalone", "node_modules");
  const dest = path.join(context.appOutDir, "resources", "server", "node_modules");

  if (!existsSync(src)) {
    throw new Error(`[afterPack] 找不到 standalone node_modules：${src}`);
  }

  let rc = 0;
  try {
    execFileSync(
      "robocopy",
      [src, dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"],
      { stdio: "ignore" },
    );
  } catch (err) {
    // robocopy 的 1-7 都是成功（1=有文件拷贝），execFileSync 会当异常抛出
    rc = typeof err.status === "number" ? err.status : 16;
    if (rc >= 8) {
      throw new Error(`[afterPack] robocopy 失败，退出码 ${rc}`);
    }
  }

  const copied = existsSync(dest) && readdirSync(dest).length > 0;
  if (!copied) {
    throw new Error("[afterPack] robocopy 后 node_modules 仍为空");
  }
  console.log("[afterPack] node_modules 已补拷 →", dest);
};
