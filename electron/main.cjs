/**
 * CookieMusic 桌面壳 —— Electron 主进程。
 *
 * 架构：主进程 spawn Next standalone server（用 electron 自带 node：
 * ELECTRON_RUN_AS_NODE=1，用户机器无需装 Node），BrowserWindow 加载
 * http://127.0.0.1:<port>。音乐目录与下载目录存 userData/config.json，
 * 首次启动弹目录选择框；目录通过 MUSIC_ROOTS / GD_SAVE_DIR 环境变量传给
 * server（src/lib/library.ts 原生支持 MUSIC_ROOTS）。
 */
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

/** dev 调试：设 ELECTRON_DEV_URL=http://localhost:3000 时直连 dev server，不 spawn */
const DEV_URL = process.env.ELECTRON_DEV_URL || "";

let serverProc = null;
let mainWindow = null;

/**
 * GPU 降级开关只在受限会话（agent 沙箱/远程桌面，GPU 进程会 FATAL）启用：
 * 环境变量 PIXELMUSIC_SAFE_MODE=1，或在 userData 下放一个 safe-mode.flag
 * 空文件（用户双击就能切换，不需要会设环境变量）。正常桌面保持完整硬件
 * 加速——重动画站点走软件渲染会巨卡，GSAP 动画跑不动还会让径向菜单"消失"。
 */
const SAFE_MODE =
  process.env.PIXELMUSIC_SAFE_MODE === "1" ||
  (() => {
    try {
      return fs.existsSync(path.join(app.getPath("userData"), "safe-mode.flag"));
    } catch {
      return false;
    }
  })();

if (SAFE_MODE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
} else {
  // 正常桌面：解除帧率上限与垂直同步排队，GSAP 重动画明显更顺滑；
  // 用户桌面硬件加速生效时收益最大。
  app.commandLine.appendSwitch("disable-frame-rate-limit");
  app.commandLine.appendSwitch("disable-gpu-vsync");
}

/** 主进程日志：console + userData/main.log 双写，启动失败/退出有据可查。 */
function logMain(line) {
  console.log("[pixelmusic]", line);
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "main.log"), line + "\n");
  } catch {
    /* 日志失败不影响运行 */
  }
}

/* GPU 崩溃自愈：硬件加速模式下 GPU 进程若反复崩溃（显卡驱动与 Chromium
   兼容性差的老机器），自动写入 safe-mode.flag 并以兼容模式重启——
   无论显卡环境如何，应用最终都停留在可用状态，用户无需手动干预。 */
let gpuCrashCount = 0;
app.on("child-process-gone", (_event, details) => {
  if (details.type !== "GPU" || SAFE_MODE) return;
  gpuCrashCount += 1;
  logMain(`GPU 进程异常：reason=${details.reason}（第 ${gpuCrashCount} 次）`);
  if (gpuCrashCount >= 2) {
    try {
      fs.writeFileSync(
        path.join(app.getPath("userData"), "safe-mode.flag"),
        "auto: gpu process kept crashing",
      );
    } catch {
      /* 写 flag 失败则下次仍走硬件路径 */
    }
    logMain("GPU 连续异常 → 已切兼容模式并重启应用");
    app.relaunch();
    app.exit(0);
  }
});

/* ---------------- 配置（userData/config.json） ---------------- */

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
}

/** 首启（或配置缺目录）弹选择框；用户取消则回退系统"音乐"文件夹。 */
async function ensureConfig() {
  let cfg = readConfig();
  if (cfg && Array.isArray(cfg.musicRoots) && cfg.musicRoots.length > 0) {
    return cfg;
  }
  let defaultMusic = "";
  try {
    defaultMusic = app.getPath("music");
  } catch {
    defaultMusic = app.getPath("home");
  }
  const res = await dialog.showOpenDialog({
    title: "选择你的音乐文件夹",
    message: "选择存放音乐的文件夹（可多选），歌曲下载也会保存在第一个文件夹",
    properties: ["openDirectory", "multiSelections", "dontAddToRecent"],
    defaultPath: defaultMusic,
  });
  const roots =
    !res.canceled && res.filePaths.length > 0 ? res.filePaths : [defaultMusic];
  cfg = { musicRoots: roots, saveDir: roots[0] };
  writeConfig(cfg);
  return cfg;
}

/* ---------------- standalone server 管理 ---------------- */

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function pickPort(start) {
  for (let p = start; p < start + 20; p += 1) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`端口 ${start}~${start + 19} 都被占用`);
}

/** 打包后 server 在 resources/server；开发直跑在 <project>/.next2/standalone。 */
function serverDir() {
  if (process.env.ELECTRON_SERVER_DIR) return process.env.ELECTRON_SERVER_DIR;
  if (app.isPackaged) return path.join(process.resourcesPath, "server");
  // __dirname = <project>/electron（distDir 见 next.config.ts）
  return path.join(__dirname, "..", ".next2", "standalone");
}

function startServer(cfg, port) {
  const dir = serverDir();
  const entry = path.join(dir, "server.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到 server 入口：${entry}`);
  }
  const proc = spawn(process.execPath, [entry], {
    cwd: dir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      MUSIC_ROOTS: cfg.musicRoots.join(path.delimiter),
      GD_SAVE_DIR: cfg.saveDir || cfg.musicRoots[0],
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = (chunk) => {
    try {
      fs.appendFileSync(
        path.join(app.getPath("userData"), "server.log"),
        String(chunk),
      );
    } catch {
      /* 日志失败不影响运行 */
    }
  };
  proc.stdout.on("data", log);
  proc.stderr.on("data", log);
  return proc;
}

function waitForServer(port, timeoutMs = 30000) {
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
        if (res.status < 500) {
          resolve();
          return;
        }
      } catch {
        /* 未就绪继续等 */
      }
      if (Date.now() > deadline) {
        reject(new Error("本地服务启动超时"));
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

/* ---------------- 窗口 ---------------- */

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#0b0e1a",
    title: "CookieMusic",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 失焦不节流：边干别的边听歌，动画不掉帧
    },
  });
  const windowShownAt = Date.now();
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  /* 诊断（一次性）：did-finish-load 后把 GPU 特性状态、进程指标、屏幕参数、
     reduced-motion 与 10 秒 FPS 采样全部写进 userData/diag.log——"卡"从此
     有硬数据：FPS 低 + gpu=software → 渲染问题；FPS 正常 → 网络/主观因素。 */
  mainWindow.webContents.once("did-finish-load", () => {
    const diag = [];
    diag.push(`version=${app.getVersion()} safeMode=${SAFE_MODE} loadMs=${Date.now() - windowShownAt}`);
    try {
      Promise.resolve(app.getGPUFeatureStatus()).then((status) => {
        diag.push(`gpu=${JSON.stringify(status)}`);
        try {
          const d = require("node:screen").getPrimaryDisplay();
          diag.push(`display=${d.size.width}x${d.size.height} scale=${d.scaleFactor}`);
        } catch {}
        return mainWindow.webContents.executeJavaScript(
          `new Promise((resolve) => {
            const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            let frames = 0; const start = performance.now();
            function loop() { frames++; if (performance.now() - start < 10000) requestAnimationFrame(loop); else resolve({ fps: Math.round(frames / 10), reducedMotion: rm, dpr: window.devicePixelRatio, w: innerWidth, h: innerHeight }); }
            requestAnimationFrame(loop);
          })`,
          true,
        )
          .then((r) => diag.push(`page=${JSON.stringify(r)}`))
          .catch(() => {})
          .finally(() => {
            try {
              const metrics = app
                .getAppMetrics()
                .map((m) => `${m.type}:cpu=${m.cpu.percentCPUUsage.toFixed(1)}%`);
              diag.push(`metrics=${metrics.join(" | ")}`);
            } catch {}
            try {
              fs.appendFileSync(
                path.join(app.getPath("userData"), "diag.log"),
                diag.join("\n") + "\n",
              );
            } catch {}
            logMain("diag 已写入 diag.log");
          });
      });
    } catch {
      /* 诊断失败不影响运行 */
    }
  });

  // 前端诊断：渲染层 console / 崩溃 / 加载失败 全部落 userData/renderer.log，
  // 用户报 UI 问题时不用猜（如 GSAP 菜单消失、播放异常）。
  const rendererLog = (line) => {
    try {
      fs.appendFileSync(path.join(app.getPath("userData"), "renderer.log"), line + "\n");
    } catch {
      /* 日志失败不影响运行 */
    }
  };
  mainWindow.webContents.on("console-message", (event, ...rest) => {
    // Electron 新旧签名兼容：新式为 event.details，旧式为 (e, level, message, line, sourceId)
    const d = event && typeof event === "object" && "message" in event ? event : null;
    const level = d ? d.level : rest[0];
    const message = d ? d.message : rest[1];
    const sourceId = d ? d.sourceId : rest[3];
    const line = d ? d.lineNumber : rest[2];
    if (level === "verbose") return;
    rendererLog(`[console:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    rendererLog(`[render-gone] ${JSON.stringify(details)}`);
    dialog.showErrorBox(
      "界面进程异常退出",
      `界面进程异常退出（${details.reason}），请重启应用。详情见 renderer.log。`,
    );
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (code === -3) return; // ABORTED（用户主动刷新/跳转）不算错误
    rendererLog(`[load-fail] ${code} ${desc} ${url}`);
  });
}

/* ---------------- 生命周期 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      console.log("[pixelmusic] app ready, dev url =", DEV_URL || "(none)");
      if (DEV_URL) {
        createWindow(DEV_URL.replace(/\/$/, ""));
        return;
      }
      const cfg = await ensureConfig();
      console.log("[pixelmusic] config ok:", JSON.stringify(cfg));
      const port = await pickPort(3456);
      console.log("[pixelmusic] starting server on port", port);
      serverProc = startServer(cfg, port);
      serverProc.on("exit", (code) => {
        serverProc = null;
        console.log("[pixelmusic] server exited, code =", code);
        if (mainWindow && code !== 0) {
          dialog.showErrorBox(
            "本地服务已退出",
            `本地服务异常退出（code ${code}），请重启应用。详情见 server.log。`,
          );
        }
      });
      await waitForServer(port);
      console.log("[pixelmusic] server ready, opening window");
      createWindow(port);
    } catch (err) {
      console.error("[pixelmusic] startup failed:", err);
      dialog.showErrorBox("启动失败", String((err && err.message) || err));
      app.quit();
    }
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {
      /* 忽略 */
    }
    serverProc = null;
  }
});

/* ---------------- IPC（preload 暴露给渲染层，当前供后续"设置"页使用） ---------------- */

ipcMain.handle("pixelmusic:config:get", () => readConfig());

/* 沉浸式全屏：无边框全屏（盖住任务栏），Esc 或退出按钮恢复 */
ipcMain.handle("pixelmusic:fullscreen:set", (_event, flag) => {
  if (mainWindow) mainWindow.setFullScreen(Boolean(flag));
  return Boolean(flag);
});

ipcMain.handle("pixelmusic:dir:choose", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "选择音乐文件夹",
    properties: ["openDirectory", "multiSelections", "dontAddToRecent"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const cfg = readConfig() || { musicRoots: [], saveDir: "" };
  cfg.musicRoots = res.filePaths;
  if (!cfg.saveDir) cfg.saveDir = res.filePaths[0];
  writeConfig(cfg);
  return cfg;
});
