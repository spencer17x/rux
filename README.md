# RUX

**Rux** 是当前 ChatGPT 桌面客户端中 Codex 工作区的开源、本地优先功能一致实现。

第一版只有一个产品目标：在同平台、同账户能力和同客户端版本下，复刻 Codex 的用户入口、工作流、状态、错误恢复和视觉层级；除 `Rux` 品牌外不增加自有产品功能。

Desktop 采用 Electron + React，并把高权限 Codex、Git、文件和 Terminal 能力隔离在独立 Utility Process。仓库仍含历史兼容模块与 Rust TUI，但它们不是 v1 产品表面，也不定义第一版需求。

## 产品文档

- [产品需求文档](docs/product-requirements.md)
- [桌面端架构](docs/desktop-architecture.md)
- [TUI 架构](docs/tui-architecture.md)

## 桌面应用

桌面应用位于 [`app/`](app/)。当前实现已覆盖 Codex 本地 Workspace、Task、Run、审批、Changes、Context、原生 Session 恢复和集成 Terminal，但尚未通过完整的当前 ChatGPT Codex parity 门禁。OAuth 只委托官方 Codex 边界，Rux 不读取或复制 Token。

```bash
cd app
npm install
npm run dev       # Electron 开发模式
npm test          # Desktop/Runtime/Git/Store/Auth/Sites + Rust TUI 全套测试
npm run build     # 构建 Web、Desktop Runtime 与 release TUI
npm run package   # 生成当前平台应用包，并把 Runtime Host/TUI 一起打包
```

macOS 构建产物位于 `app/release/mac-arm64/Rux.app`；包内 TUI 位于 `Contents/Resources/bin/rux-tui`，可自动连接同包 Runtime Host。当前应用仍是 ad-hoc 签名，正式公开分发前必须完成 Developer ID、Hardened Runtime、公证、Stapling 与 Gatekeeper 验收。

## 兼容 TUI

TUI 是现有工程兼容客户端，不属于 ChatGPT Codex 桌面一致性的 v1 产品范围。

```bash
cd tui
cargo run -- --workspace /path/to/repository --agent codex --permission plan
```

若已构建 `app/out/runtime-host/rux-runtime.mjs`，TUI 会自动连接真实 Runtime；否则只进入明确标注、不会改文件的 Demo。完整参数和键盘操作见 [`tui/README.md`](tui/README.md)。
