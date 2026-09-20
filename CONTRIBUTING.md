# Contributing to CookieMusic

感谢你对 CookieMusic 的兴趣！

## 开发环境

**要求：** Node.js 24+。

```bash
git clone https://github.com/Cookie-Star-Jewel/CookieMusic.git
cd CookieMusic
npm ci
npm run dev          # 前端开发
npm run electron:dev # 带 Electron 外壳调试
```

## 提交前检查

```bash
npm run check        # lint + typecheck + build
```

## 分支与 PR

1. 从 `main` 切分支（如 `fix/lyrics-scroll`、`feat/playlist-export`）。
2. 改动后运行 `npm run check`。
3. 写清晰的提交信息（推荐 `fix:` / `feat:` / `docs:` 前缀）。
4. 向 `main` 提 PR，关联相关 issue（如 `Closes #123`）。
5. 保持 PR 聚焦：一个逻辑改动一个 PR。

## 代码约定

见 `AGENTS.md`。修改 `AGENTS.md` 后请运行 `bash scripts/sync-agent-rules.sh` 并一并提交生成文件。

## 行为准则

友好、就事论事。请尊重他人的时间与劳动。
