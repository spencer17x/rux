// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast, type Notify, type Toast } from "./useToast";

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
  let toast: Toast | null = null;
  let notify: Notify = () => {};
  function Harness() {
    const value = useToast();
    toast = value.toast;
    notify = value.notify;
    return null;
  }
  await act(async () => root.render(<Harness />));
  return {
    get text() { return toast?.text ?? ""; },
    get tone() { return toast?.tone ?? ""; },
    notify: (message: string, tone?: Toast["tone"]) => notify(message, tone),
  };
}

describe("toast queue", () => {
  it("shows queued messages one at a time instead of dropping the earlier one", async () => {
    const h = await mountToast();
    await act(async () => { h.notify("first"); h.notify("second"); });
    expect(h.text).toBe("first");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(h.text).toBe("second");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(h.text).toBe("");
  });

  it("does not restart the timer when a new message is queued", async () => {
    const h = await mountToast();
    await act(async () => { h.notify("first"); });
    await act(async () => { vi.advanceTimersByTime(2000); h.notify("second"); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(h.text).toBe("second");
  });

  it("ignores a duplicate of the message already showing", async () => {
    const h = await mountToast();
    await act(async () => { h.notify("saved"); h.notify("saved"); });
    expect(h.text).toBe("saved");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(h.text).toBe("");
  });

  it("defaults to the success tone and carries an explicit one through", async () => {
    const h = await mountToast();
    await act(async () => { h.notify("已复制"); });
    expect(h.tone).toBe("success");
    await act(async () => { vi.advanceTimersByTime(3000); });
    await act(async () => { h.notify("打开项目失败", "error"); });
    expect(h.tone).toBe("error");
  });

  it("keeps the same text under a different tone instead of dropping it", async () => {
    const h = await mountToast();
    await act(async () => { h.notify("请先停止任务", "info"); h.notify("请先停止任务", "error"); });
    expect(h.tone).toBe("info");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(h.tone).toBe("error");
  });
});
