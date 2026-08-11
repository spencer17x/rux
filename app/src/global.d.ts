import type { RuxDesktopApi } from "./shared/protocol";

declare global {
  interface Window {
    rux?: RuxDesktopApi;
  }
}

export {};

