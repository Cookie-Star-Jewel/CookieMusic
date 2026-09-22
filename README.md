# CookieMusic 🍪

> 基于 Electron + Next.js 的桌面音乐播放器，主打"隧道歌词"滚动效果、本地曲库管理与播放列表。

CookieMusic 把你的本地音乐库变成一个干净、好看、好用的桌面播放器。歌词以隧道景深方式随播放滚动，支持本地目录扫描、自建歌单、曲库自动续播与无缝切歌，并可接入在线曲源（GD 音乐台）做搜索、试听与下载入库。

## ✨ 功能

- **隧道歌词**：LRC 逐行滚动 + 景深隧道效果，演唱到哪一行就高亮到哪一行。
- **本地曲库**：自动扫描 `~/Music`、`D:\Music`、`E:\Music` 等目录，按文件夹/歌手组织。
- **播放列表与自建歌单**：本地曲库与歌单都按队列播放，支持列表 / 随机 / 单曲三种循环模式。
- **无缝衔接上下歌曲**：切歌时上一首等功率淡出、下一首淡入（功率恒定，无中间音量塌陷），退场曲还会做低通扫频 + 混响的「飘走」塑形；过渡时长由歌词与能量剖面自动决定（6~16 秒）。可在「设置」里关掉。
- **在线曲源（可选）**：内置 GD 音乐台搜索，可先试听确认版本再下载入库（需遵守服务条款）。
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
- 音频：HTMLAudioElement + Web Audio（本地音源走双播放器等功率交叉淡化，跨域直连走原生 volume）；歌词：LRC 解析

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

**Features:** tunnel lyrics (LRC scrolling with depth), local library scan, playlists, seamless smart transitions (equal-power crossfade plus a low-pass/reverb "floating away" tail on local tracks), optional online source (GD Music) with preview-before-download, native Windows installer, built-in demo song (The Show - Lenka).

**Install:** download the `CookieMusic Setup x.x.x.exe` from [Releases](https://github.com/Cookie-Star-Jewel/CookieMusic/releases), or build from source with `npm run electron:build`.

**Privacy:** scans only the local music folders you choose; does not collect or upload your library. See [NOTICE.md](NOTICE.md).

**License:** MIT © 2026 CookieMusic Contributors.

</details>
