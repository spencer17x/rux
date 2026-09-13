export const CODEX_LOGIN_REQUIRED = "Codex 登录已失效，请在 Rux 中重新登录后重试。";

/** Match terminal credential failures, not rate limits or transient network errors. */
export function isCodexAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /refresh[_ -]?token[_ -]?(?:reused|expired|invalid)|refresh token (?:was |has )?(?:already (?:been )?used|expired)|access token could not be refreshed|token_revoked|invalid_grant|please log out and sign in again|Codex 登录已失效/i.test(message);
}
