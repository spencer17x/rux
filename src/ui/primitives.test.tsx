// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Input, Modal } from "./index";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("Rux UI interaction contracts", () => {
  it("blocks child actions and navigation when an asChild button is disabled", async () => {
    const parent = vi.fn(), child = vi.fn();
    await act(async () => root.render(<Button asChild disabled onClick={parent}><a href="#not-allowed" onClick={child}>Disabled link</a></Button>));
    const link = container.querySelector("a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { link.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(parent).not.toHaveBeenCalled();
    expect(child).not.toHaveBeenCalled();
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(link.tabIndex).toBe(-1);
  });

  it("focuses a dialog's preferred input and returns focus after Escape", async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return <><Button onClick={() => setOpen(true)}>Open</Button><Modal label="Dialog test" open={open} onClose={() => setOpen(false)}><Button onClick={() => setOpen(false)}>Close header</Button><Input data-autofocus aria-label="Name" /><Button onClick={() => setOpen(false)}>Close</Button></Modal></>;
    }
    await act(async () => root.render(<Demo />));
    const trigger = container.querySelector("button")!;
    await act(async () => { trigger.focus(); trigger.click(); });
    const input = document.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
    expect(document.activeElement).toBe(input);
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
