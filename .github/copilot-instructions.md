<!-- AUTO-GENERATED from AGENTS.md — do not edit directly.
     Run `bash scripts/sync-agent-rules.sh` to regenerate. -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CookieMusic

## What This Is

CookieMusic 是一个桌面音乐播放器：基于 Electron 外壳 + Next.js 16 前端，内置"隧道歌词"滚动效果、本地曲库扫描、自建歌单，以及上下曲无缝衔接（等功率交叉淡化 + 退场曲低通/混响塑形）。默认内置一首演示曲（The Show - Lenka）。

## Tech Stack

- **Shell:** Electron 44（nsis 安装包，standalone Next 服务内嵌）
- **Frontend:** Next.js 16（App Router, React 19, TypeScript strict）
- **UI:** animal-island-ui + shadcn 风格、Tailwind CSS v4、Lucide 图标
- **Styling:** Tailwind CSS v4 with oklch design tokens
- **Audio:** HTMLAudioElement + Web Audio（本地同源音源走双播放器等功率交叉淡化；GD 跨域直连走原生 volume）；歌词由 LRC 解析

## Commands

- `npm run dev` — 启动 Next.js 开发服务器（端口 3000）
- `npm run build` — 生产构建
- `npm run lint` / `npm run typecheck` — 检查
- `npm run electron:dev` — 以开发模式启动 Electron 外壳（加载 localhost:3000）
- `npm run electron:build` — 完整打包 Windows 安装包（build → standalone → clean → electron-builder）

## Code Style

- TypeScript strict，禁止 `any`
- 命名导出、PascalCase 组件、camelCase 工具
- Tailwind 工具类，少内联样式
- 2 空格缩进，移动端优先

## Project Structure

```
src/
  app/                 # Next.js 路由与 API（audio / library / playlists / gd）
  components/sites/... # 播放器界面（含 TunnelScene 隧道歌词、MusicPanels）
  lib/                 # library.ts（曲库扫描/编码）、playlists.ts、gd-client.ts
  hooks/               # 自定义 React hooks
electron/
  main.cjs             # Electron 主进程（窗口、协议、音频读取）
scripts/               # prepare-standalone / clean-release / after-pack
build/
  icon.ico             # 应用图标（必须 ≥256px）
```

## Design Principles

- 严格 1:1 还原设计稿，不擅自添加设计内容。
- 中文界面优先；真实内容优先于占位符。
- 本地优先：曲库扫描本地目录，不强制联网。

## MOST IMPORTANT NOTES

- 改 `AGENTS.md` 后运行 `bash scripts/sync-agent-rules.sh` 可重新生成各 AI 客户端配置。
- **改播放逻辑前必读**：音频是**双路径**的。本地同源音源（`/api/audio`、`blob:`）走 `audio-engine.ts` 的 Web Audio 引擎槽；GD 跨域直连**不能**进 Web Audio 图（`createMediaElementSource` 后跨域会输出**静音**，不报错），只能走原生 `<audio>.volume`。当前「在响的元素」由 `KarlSite.tsx` 的 `activeAudio()`（useCallback，引用必须稳定）统一获取——`useKarlInteractions` 拿的是**getter 函数**而不是 ref，别改回 ref。队列：`queueRef`（歌单用真实 id，本地曲库用 `LIBRARY_QUEUE_ID`）。
- 打包前确认 `build/icon.ico` 存在且 ≥256px，否则 electron-builder 报错。
- 在线曲源（GD 音乐台）依赖外部签名，仅供研究/个人使用，遵守相关服务条款。
