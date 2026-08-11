# RUX

**RUX** 是一个统一使用、观察和控制 Coding Agent 的开发者工作台。

名称可以解释为 **Runtime User Experience**：RUX 将原本黑盒式的 Agent Run，转化为可见、可控、可审查、可恢复的开发体验。

暂定口号：

> One workspace. Every coding agent.

RUX 当前处于可运行的 Desktop + TUI 内测阶段。Desktop 采用 Electron + React，并把高权限能力隔离在独立 Utility Process；Grok Build 交互取向的 Rust TUI 通过同一个独立 JSONL Runtime Host 使用 Claude Code、Codex、Git、Context、自定义 Agent 与共享 Task Store。

## 产品文档

- [产品需求文档](docs/product-requirements.md)
- [交付路线与验收矩阵](docs/delivery-roadmap-and-acceptance.md)
- [桌面端架构](docs/desktop-architecture.md)
- [TUI 架构](docs/tui-architecture.md)
- [2026-08-10 发布候选证据](docs/release-evidence-2026-08-10.md)

## 桌面应用

Codex App 交互取向的桌面工作台位于 [`app/`](app/)。它覆盖 Workspace、Task、Run、Activity、Changes、Context、自定义 Agent 与集成终端；Claude Code 和 Codex 都走真实本机 CLI。生产包不暴露 Demo Agent，OAuth 只委托官方 CLI，不读取或复制 Token。

```bash
cd app
npm install
npm run dev       # Electron 开发模式
npm test          # Desktop/Runtime/Git/Store/Auth/Sites + Rust TUI 全套测试
npm run build     # 构建 Web、Desktop Runtime 与 release TUI
npm run package   # 生成当前平台应用包，并把 Runtime Host/TUI 一起打包
```

macOS 构建产物位于 `app/release/mac-arm64/Rux.app`；包内 TUI 位于 `Contents/Resources/bin/rux-tui`，可自动连接同包 Runtime Host。当前应用仍是 ad-hoc 签名，正式公开分发前必须完成 Developer ID、Hardened Runtime、公证、Stapling 与 Gatekeeper 验收。

## TUI

```bash
cd tui
cargo run -- --workspace /path/to/repository --agent codex --permission plan
```

若已构建 `app/out/runtime-host/rux-runtime.mjs`，TUI 会自动连接真实 Runtime；否则只进入明确标注、不会改文件的 Demo。完整参数和键盘操作见 [`tui/README.md`](tui/README.md)。
