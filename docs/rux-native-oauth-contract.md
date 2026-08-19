# Rux Native OAuth 合规合同

> 兼容代码安全记录，不属于 Rux v1 产品需求，也不允许恢复 Rux Native 或 OAuth 产品入口。v1 唯一产品合同为 `docs/product-requirements.md`。

更新时间：2026-08-17

## 当前产品结论

Rux Native 当前只实现用户显式配置的 API Key，不实现通用或猜测式 OAuth。OpenAI 官方 API 文档当前公开的是 API Key Bearer 鉴权；没有可供任意第三方桌面客户端复用 ChatGPT/Codex 订阅登录的公共授权合同。因此 RUX 不会复制 Codex CLI 登录、复用个人订阅凭据、内置未经授权的 Client ID，或把 Provider Base URL 猜成授权端点。

参考：

- OpenAI API Authentication：<https://platform.openai.com/docs/api-reference/authentication>
- OpenAI Developer Quickstart：<https://platform.openai.com/docs/quickstart>

只有取得 Provider 官方桌面 OAuth 合同与 RUX Client 注册，包括明确发布的 OAuth 元数据、允许的 Redirect URI、Scope、Token 生命周期和撤销语义后，才能启用对应 Provider 的 OAuth Connection。

## 支持门槛

一个 Provider-specific OAuth Adapter 必须同时满足：

1. Provider 官方文档明确允许原生桌面/Public Client。
2. 使用 Provider 签发给 RUX 的 Client ID；桌面包不保存 Client Secret。
3. 授权端点、Token 端点、Issuer、Audience、Scope 和 Redirect URI 来自签名或明确固定的 Provider 元数据，不从用户输入的 API Base URL 推导。
4. Provider 明确说明资源 API 与 OAuth Token 的绑定关系和最小 Scope。
5. 测试账号与撤销入口可用，且真实授权由用户显式发起。

任何一项缺失时，UI 只能显示“此 Provider 尚未支持 OAuth”，不能展示可点击但不可完成的登录按钮。

## 授权流程

- 仅支持 Authorization Code + PKCE S256；拒绝 Implicit、Resource Owner Password 和未绑定 PKCE 的 Code Flow。
- 使用系统浏览器打开授权页。每次请求生成高熵 `state`、PKCE verifier/challenge；Provider 要求 OpenID Connect 时还要生成并验证 `nonce`。
- 优先使用 Provider 注册的 loopback redirect，监听 `127.0.0.1` 随机端口；只有 Provider 明确注册时才使用 claimed HTTPS 或自定义协议回调。
- Main Process 拥有回调监听、state/nonce/PKCE 校验和 Token Exchange。Renderer 只能收到规范化状态，不接触 authorization code、access token 或 refresh token。
- 回调只接受一次，限定短超时，并在成功、取消或超时后立即关闭监听器。
- 验证 Issuer、Audience、签名、有效期和授权响应来源；错误响应不得触发降级或重试到不同端点。

## Token 保管与 Runtime 边界

- Refresh Token 和需要持久化的 Token 元数据只由 Main 使用 OS 安全存储加密。OS 安全存储不可用时拒绝保存，不降级为明文。
- Access Token 只在 Main/Runtime 内存中按需解密和传递；Renderer、普通 IPC、Task Store、日志、导出、崩溃报告和剪贴板都不得出现明文 Token。
- 持久化的 Connection 只包含非敏感 Provider、Connection ID、授权状态、Scope 名称、到期时间、账号显示提示和凭据指纹。
- Scope 必须最小化且可解释。增加 Scope、切换账号或替换授权都需要新的显式同意和指纹化影响预览。
- 日志只记录阶段、Provider、非敏感错误分类和关联 ID；授权 URL 的 query、code、state、Token 和可识别账号数据必须清洗。

## 网络与端点约束

- 授权、Token、JWKS、Discovery 和资源端点必须使用 HTTPS；只有注册且文档允许的 loopback callback 可以使用本地 HTTP。
- 所有端点按 Provider Adapter 固定或由受信任 Discovery 文档解析，并执行严格 Origin/Issuer allowlist。
- 网络请求拒绝跨 Origin 重定向；Token 不随重定向转发，不发送到用户可编辑的任意 URL。
- 不允许 Base URL 中嵌入凭据、query 或 fragment；OAuth 配置与 API Base URL 分开保存和校验。
- Dynamic Client Registration 只有在 Provider 官方明确支持、并定义桌面客户端安全语义时才可使用；默认关闭。

## 更新、撤销与删除

- Refresh 失败必须保留可审查错误，不静默切换 API Key、CLI 登录或其他账号。
- Logout 分为“删除 RUX 本地凭据”和“请求 Provider 撤销”。撤销是外部后果，必须单独确认；本地删除不得谎称已远程撤销。
- 替换或删除凭据前生成 Agent/Task 影响预览，确认时验证预览指纹，拒绝过期预览。
- Provider 改变 Issuer、Client ID、Scope 或 Token 格式时创建迁移版本；不兼容版本 fail closed，保留加密旧记录供显式恢复或删除。

## 测试与上线门槛

实现 Provider OAuth 前必须补齐：

- 假 Provider 的成功、拒绝、取消、超时、state/nonce 不匹配、PKCE 失败、错误 Issuer/Audience、过期 Token 和撤销测试。
- 重定向、DNS/Origin 变化、恶意 Discovery、日志脱敏、Renderer/IPC 泄漏和 OS 安全存储不可用测试。
- 更新/回滚、旧凭据迁移、失效 Preview、并发登录和应用重启恢复测试。
- 当前平台真实打包应用的系统浏览器回跳、取消、刷新、登出和撤销验收。
- Provider 官方注册信息、测试租户/账号和安全评审证据。

在这些条件满足前，Rux Native OAuth 的实现状态保持为“Provider 注册阻塞”；API Key 连接继续作为唯一可用的 Rux Native 凭据方式。
