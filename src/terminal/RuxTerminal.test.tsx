import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RuxTerminal, { terminalAccessibleText } from "./RuxTerminal";

describe("terminalAccessibleText", () => {
  it("removes ANSI and terminal title control sequences", () => {
    const text = terminalAccessibleText([{ sequence: 1, data: "\u001b]2;title\u0007\u001b[32mRUX\u001b[0m\r\n" }]);
    expect(text).toContain("RUX");
    expect(text).not.toContain("title");
    expect(text).not.toContain("\u001b");
  });

  it("renders startup feedback outside the terminal output stream", () => {
    const html = renderToStaticMarkup(<RuxTerminal starting output={[]} onInput={() => {}} onResize={() => {}} />);
    expect(html).toContain("正在启动终端…");
    expect(html).toContain('role="status"');
    expect(terminalAccessibleText([])).toBe("");
  });
});
