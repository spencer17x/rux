export const PRODUCTION_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'none'",
].join("; ");

export const DEVELOPMENT_CONTENT_SECURITY_POLICY = PRODUCTION_CONTENT_SECURITY_POLICY.replace(
  "connect-src 'self'",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:* ws://terminal.local:*",
);

/**
 * Keep production secure by default in index.html and relax only the HMR
 * connection sources while a local Vite server is actively serving the page.
 */
export function developmentContentSecurityPolicyPlugin() {
  return {
    name: "rux-development-content-security-policy",
    apply(_config, environment) {
      return environment.command === "serve";
    },
    transformIndexHtml(html) {
      if (!html.includes(PRODUCTION_CONTENT_SECURITY_POLICY)) {
        throw new Error("index.html does not contain the expected production Content Security Policy");
      }
      return html.replace(PRODUCTION_CONTENT_SECURITY_POLICY, DEVELOPMENT_CONTENT_SECURITY_POLICY);
    },
  };
}
