import type { RuxApi } from "../electron/preload";

declare global {
  interface Window {
    rux: RuxApi;
    __ruxToastTimer?: number;
  }
}

export {};
