# CookieMusic 🍪

> 基于 Electron + Next.js 的桌面音乐播放器，主打"隧道歌词"滚动效果、本地曲库管理与播放列表。

CookieMusic 把你的本地音乐库变成一个干净、好看、好用的桌面播放器。歌词以隧道景深方式随播放滚动，支持本地目录扫描、自定义播放列表、收藏，并可接入在线曲源（GD 音乐台）做搜索与下载入库。

## ✨ 功能

- **隧道歌词**：LRC 逐行滚动 + 景深隧道效果，演唱到哪一行就高亮到哪一行。
- **本地曲库**：自动扫描 `~/Music`、`D:\Music`、`E:\Music` 等目录，按文件夹/歌手组织。
- **播放列表 & 收藏**：自定义列表、收藏夹、多种播放模式。
- **在线曲源（可选）**：内置 GD 音乐台搜索/下载，一键入库（需遵守服务条款）。
- **桌面原生**：Electron 外壳，独立安装包，开机即用。
- **默认演示曲**：内置《The Show - Lenka》及配套隧道歌词，开箱即听。

## 📦 安装

### 方式一：下载安装包（Windows）

到 [Releases](https://github.com/Cookie-Star-Jewel/CookieMusic/releases) 下载 `CookieMusic Setup x.x.x.exe`，按向导安装即可。首次启动会让你选择本地音乐目录。

### 方式二：从源码构建

```bash
git clone https://github.com/Cookie-Star-Jewel/CookieMusic.git
cd CookieMusic
npm ci
npm run electron:build   # 产出 release/ 下的 nsis 安装包
```

开发调试：

```bash
npm run dev            # 仅前端（localhost:3000）
npm run electron:dev   # 前端 + Electron 外壳
```

## 🛠 技术栈

- Electron 44（nsis，内嵌 standalone Next 服务）
- Next.js 16（App Router, React 19, TypeScript strict）
- animal-island-ui + shadcn 风格 / Tailwind CSS v4 / Lucide 图标
- 音频：浏览器 Audio API；歌词：LRC 解析

## 🔒 隐私

- CookieMusic 默认只扫描你指定的**本地**音乐目录，不收集、不上传你的曲库或个人数据。
- 在线曲源为可选功能，调用第三方服务时请遵守其服务条款与当地法律。
- 详见 [NOTICE.md](NOTICE.md) 免责声明。

## 📄 许可

[MIT](LICENSE) © 2026 CookieMusic Contributors.

## 🙏 致谢

- 界面风格参考 animal-island-ui；歌词隧道效果灵感来自社区实现。
- 基于 Next.js 16 与 Electron 构建。

---

<details><summary>English</summary>

# CookieMusic 🍪

A desktop music player built on Electron + Next.js, featuring a "tunnel lyrics" scrolling effect, local library management, and playlists.

**Features:** tunnel lyrics (LRC scrolling with depth), local library scan, playlists & favorites, optional online source (GD Music), native Windows installer, built-in demo song (The Show - Lenka).

**Install:** download the `CookieMusic Setup x.x.x.exe` from [Releases](https://github.com/Cookie-Star-Jewel/CookieMusic/releases), or build from source with `npm run electron:build`.

**Privacy:** scans only the local music folders you choose; does not collect or upload your library. See [NOTICE.md](NOTICE.md).

**License:** MIT © 2026 CookieMusic Contributors.

</details>
