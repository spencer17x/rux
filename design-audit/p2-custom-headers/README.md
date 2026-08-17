# Rux Native Custom Headers QA

日期：2026-08-17

## 范围

- 实际 `release/mac-arm64/Rux.app` 的隔离副本。
- 独立 Bundle ID 与 `--user-data-dir`，未读取或修改用户的 Rux Provider 状态。
- 验证名称、Base URL、默认模型、API Key 与 Custom Headers 输入控件的可访问性和交互。

## 结果

- 默认模型、API Key 和 Custom Headers 均能获得焦点并接受输入。
- 填完必填项后，`添加 Connection` 从 disabled 变为可用。
- API Key 在 Accessibility Tree 中只显示掩码。
- Custom Headers 使用逐行 `Name: Value` 格式；协议测试覆盖保留 Header、重复 Header 与 CR/LF 注入拒绝。
- 隔离复制的未签名 App 无法使用 macOS `safeStorage`，提交时明确拒绝保存，没有降级为明文。加密存储、脱敏元数据、替换与清除由 `native-provider-store.test.mjs` 覆盖。

## 证据

- `01-packaged-form-interactive.png`：实际打包 Renderer 中所有字段已成功输入，提交按钮已启用。
