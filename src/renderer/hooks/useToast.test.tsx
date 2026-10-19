// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "./useToast";

let root: Root;
let element: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountToast() {
  let toast = "";
  let notify: (message: string) => void = () => {};
  function Harness() {
    const value = useToast();
    toast = value.toast;
    notify = value.notify;
    return null;
  }
  await act(async () => root.render(<Harness />));
  return { get toast() { return toast; }, notify: (message: string) => notify(message) };
}

describe("toast queue", () => {
  it("shows queued messages one at a time instead of dropping the earlier one", async () => {
    const h = await mountToast();
    await act(async () => { h.notify("first"); h.notify("second"); });
    expect(h.toast).toBe("first");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(h.toast).toBe("second");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(h.toast).toBe("");
  });

  it("does not restart the timer when a new message is queued", async () => {
    const h = await mountToast();
    await act(async () => { h.notify("first"); });
    await act(async () => { vi.advanceTimersByTime(2000); h.notify("second"); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(h.toast).toBe("second");
  });

  it("ignores a duplicate of the message already showing", async () => {
    const h = await mountToast();
    await act(async () => { h.notify("saved"); h.notify("saved"); });
    expect(h.toast).toBe("saved");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(h.toast).toBe("");
  });
});
