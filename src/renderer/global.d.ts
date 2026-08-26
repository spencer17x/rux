import type { RuxApi } from "../electron/preload";

declare global {
  interface Window {
    rux: RuxApi;
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
    __ruxSpeechRecognition?: { start(): void; stop(): void } | null;
    __ruxToastTimer?: number;
  }
}

export {};
