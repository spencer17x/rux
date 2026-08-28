import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { CircleNotch } from "@phosphor-icons/react";
import "@xterm/xterm/css/xterm.css";

export type TerminalChunk = { sequence: number; data: string };

type RuxTerminalProps = {
  starting?: boolean;
  output: TerminalChunk[];
  onInput: (data: string) => void;
  onResize: (size: { cols: number; rows: number }) => void;
};

export function terminalAccessibleText(output: TerminalChunk[]): string {
  return output.slice(-100).map((chunk) => chunk.data).join("")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .slice(-4000);
}

export default function RuxTerminal({ starting = false, output, onInput, onResize }: RuxTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const lastSequenceRef = useRef(0);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  onInputRef.current = onInput;
  onResizeRef.current = onResize;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      screenReaderMode: false,
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      fontSize: 12,
      theme: { background: "#1e1e1e", foreground: "#eeeeec", cursor: "#ffffff" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    const fit = () => {
      fitAddon.fit();
      onResizeRef.current({ cols: terminal.cols, rows: terminal.rows });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(containerRef.current);
    const inputSubscription = terminal.onData((data) => onInputRef.current(data));
    requestAnimationFrame(fit);
    return () => {
      inputSubscription.dispose();
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    for (const chunk of output) {
      if (chunk.sequence <= lastSequenceRef.current) continue;
      terminalRef.current?.write(chunk.data);
      lastSequenceRef.current = chunk.sequence;
    }
  }, [output]);

  const accessibleOutput = terminalAccessibleText(output);
  return <section className="terminal-panel"><div className="xterm-container" ref={containerRef} aria-label="项目终端" />{starting && <div className="terminal-starting-state" role="status" aria-live="polite"><CircleNotch size={15} className="spin" />正在启动终端…</div>}<pre className="sr-only" aria-live="polite" aria-label="终端输出">{accessibleOutput}</pre></section>;
}
