import { describe, expect, it } from "vitest";
import { userFacingError } from "./errors";

describe("userFacingError", () => {
  it("maps IPC validation errors to a recovery message", () => {
    expect(userFacingError(new Error("Error invoking remote method 'agent:start': Error: 请求参数无效：Too small"))).toBe("会话参数无效，请新建会话后重试。");
  });

  it("removes Electron transport prefixes from ordinary errors", () => {
    expect(userFacingError(new Error("Error invoking remote method 'agent:start': Error: Provider 不可用"))).toBe("Provider 不可用");
  });
});
