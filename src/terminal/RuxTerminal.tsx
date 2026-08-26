import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export type TerminalChunk = { sequence: number; data: string };

type RuxTerminalProps = {
  output: TerminalChunk[];
  onInput: (data: string) => void;
  onResize: (size: { cols: number; rows: number }) => void;
};

export default function RuxTerminal({ output, onInput, onResize }: RuxTerminalProps) {
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
      screenReaderMode: true,
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

  const accessibleOutput = output.slice(-100).map((chunk) => chunk.data).join("").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").slice(-4000);
  return <section className="terminal-panel"><div className="xterm-container" ref={containerRef} aria-label="项目终端" /><pre className="sr-only" aria-live="polite" aria-label="终端输出">{accessibleOutput}</pre></section>;
}
