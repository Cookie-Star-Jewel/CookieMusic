import type { NextConfig } from "next";

/**
 * distDir 用 .next2：默认 .next 目录里有个被系统索引器长期锁死的旧副本
 * （.next/standalone/dist_electron/**，上次构建把产物 trace 进了 standalone），
 * next build 清理时 unlink 撞 EBUSY。换目录名绕开，同时用
 * outputFileTracingExclusions 阻止构建产物再次被 trace 进 standalone。
 */
const nextConfig: NextConfig = {
  output: "standalone",
  // 又换了一次目录名：.next2 里被 trace 进过一份 release/（旧安装包 + win-unpacked），
  // 那个 app.asar 被工作区 watcher 长期锁死（unlink EBUSY），连 next build 清理
  // .next2/standalone 都做不到。换 .next3 绕开；下面的 outputFileTracingExcludes
  // 已确保不会再把这个目录带进来。
  distDir: ".next3",
  outputFileTracingExcludes: {
    "*": [
      "dist_electron/**",
      "android-app/**",
      "docs/**",
      ".next-old*/**",
      // release/ 里是上一版安装包与 win-unpacked（几百 MB）：next build 在
      // clean:release 之前运行，不排除的话整个旧包会被 trace 进 standalone，
      // 安装包体积直接翻倍（0.4.23 实测 141MB → 394MB）。
      "release/**",
      ".git/**",
      ".next/**",
      // distDir 自身也必须排除：.next3/standalone 里会被 trace 进一份 .next3（自引用）
      // 与遗留的 .next2（含旧 release，223MB）。不排除则安装包体积再翻一倍。
      ".next2/**",
      ".next3/**",
      ".workbuddy/**",
      "*.tsbuildinfo",
      "*.log",
    ],
  },
};

export default nextConfig;
