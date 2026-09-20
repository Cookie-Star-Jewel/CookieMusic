import type { NextConfig } from "next";

/**
 * distDir 用 .next2：默认 .next 目录里有个被系统索引器长期锁死的旧副本
 * （.next/standalone/dist_electron/**，上次构建把产物 trace 进了 standalone），
 * next build 清理时 unlink 撞 EBUSY。换目录名绕开，同时用
 * outputFileTracingExclusions 阻止构建产物再次被 trace 进 standalone。
 */
const nextConfig: NextConfig = {
  output: "standalone",
  distDir: ".next2",
  outputFileTracingExcludes: {
    "*": [
      "dist_electron/**",
      "android-app/**",
      "docs/**",
      ".next-old*/**",
      "*.log",
    ],
  },
};

export default nextConfig;
