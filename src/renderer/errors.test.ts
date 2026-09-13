import { describe, expect, it } from "vitest";
import { userFacingError } from "./errors";

describe("userFacingError", () => {
  it("maps IPC validation errors to a recovery message", () => {
    expect(userFacingError(new Error("Error invoking remote method 'agent:start': Error: 请求参数无效：Too small"))).toBe("会话参数无效，请新建会话后重试。");
  });

  it("removes Electron transport prefixes from ordinary errors", () => {
    expect(userFacingError(new Error("Error invoking remote method 'agent:start': Error: Provider 不可用"))).toBe("Provider 不可用");
  });

  it("maps authentication and provider network failures", () => {
    expect(userFacingError(new Error("Failed to authenticate. API Error: 403 API Key 所属分组已删除"))).toContain("凭据已失效");
    expect(userFacingError(new Error("Error invoking remote method 'providers:test': TypeError: fetch failed"))).toBe("连接失败，请检查服务地址、网络以及本地服务是否已启动。");
  });
});

it("translates revoked and reused Codex refresh credentials without treating limits as auth failures", () => {
  for (const error of [
    "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.",
    "refresh_token_reused", "token_revoked", "invalid_grant",
  ]) expect(userFacingError(error)).toBe("Codex 登录已失效，请在 Rux 中重新登录后重试。");
  expect(userFacingError("429 rate limit reached")).toBe("429 rate limit reached");
});
