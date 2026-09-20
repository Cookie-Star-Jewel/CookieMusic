# Changelog

所有重要变更记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [0.4.21] - 2026-09

### Changed

- 产品更名：PixelMusic → **CookieMusic**（应用名、标题、exe、appId 同步更新，避免 Windows 壳冲突）。
- 默认演示曲更换为本地曲库《The Show - Lenka》（含 LRC 隧道歌词）。
- 应用图标更换为 `build/icon.ico`（≥256px）。
- 曲库默认扫描根目录去除硬编码个人路径，改为 `~/Music`、`D:\Music`、`E:\Music`。
- 清理上游网站克隆模板残留文档，重写为 CookieMusic 说明（README / AGENTS / CONTRIBUTING / SECURITY / CHANGELOG）。

### Added

- 公开仓库与 MIT 许可证、README、免责声明（NOTICE.md）。

## [0.4.0] 之前

基于 Next.js 16 + Electron 的隧道歌词播放器原型（PixelMusic），含本地曲库扫描、播放列表、收藏、GD 音乐台在线搜索/下载。
