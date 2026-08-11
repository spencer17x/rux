import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const terminalTheme = {
  background: "#1c1f1d",
  foreground: "#d9ddd8",
  cursor: "#d9ddd8",
  cursorAccent: "#1c1f1d",
  selectionBackground: "#4f5c52",
  black: "#242824",
  red: "#d57a72",
  green: "#88c79c",
  yellow: "#d6bb78",
  blue: "#86a9d8",
  magenta: "#bc94c9",
  cyan: "#7fb8b2",
  white: "#d9ddd8",
  brightBlack: "#697069",
  brightRed: "#ed9188",
  brightGreen: "#a2d6af",
  brightYellow: "#e5cb8f",
  brightBlue: "#a0bae0",
  brightMagenta: "#cba7d5",
  brightCyan: "#9bc8c3",
  brightWhite: "#f2f4f1",
};

function createFallbackShell(terminal) {
  let input = "";
  terminal.writeln("Rux web preview terminal");
  terminal.writeln("The packaged desktop app connects this surface to a real PTY.");
  terminal.write("\r\n$ ");

  return terminal.onData((data) => {
    if (data === "\r") {
      const command = input.trim();
      terminal.write("\r\n");
      if (command === "clear") {
        terminal.clear();
      } else if (command) {
        terminal.writeln(`Preview completed: ${command}`);
      }
      input = "";
      terminal.write("$ ");
      return;
    }

    if (data === "\u007f") {
      if (!input) return;
      input = input.slice(0, -1);
      terminal.write("\b \b");
      return;
    }

    if (data >= " " && data !== "\u007f") {
      input += data;
      terminal.write(data);
    }
  });
}

export function TerminalView({ onSessionChange, onEscape }) {
  const containerRef = useRef(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: '"SFMono-Regular", "Cascadia Code", Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.35,
      scrollback: 10_000,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.key === "Escape") {
        onEscapeRef.current?.();
        return false;
      }
      return true;
    });
    terminal.focus();

    const desktopApi = window.rux;
    let disposed = false;
    let terminalId = null;
    let pendingEvents = [];
    let inputDisposable;
    let unsubscribeRuntime = () => undefined;

    if (desktopApi) {
      unsubscribeRuntime = desktopApi.onRuntimeEvent((event) => {
        if (event.type === "terminal.data") {
          if (!terminalId) {
            pendingEvents.push(event);
          } else if (event.terminalId === terminalId) {
            terminal.write(event.data);
          }
        }

        if (event.type === "terminal.exit" && event.terminalId === terminalId) {
          terminal.writeln(`\r\n\x1b[2m[process exited with code ${event.exitCode}]\x1b[0m`);
          onSessionChange?.("exited");
        }
      });

      inputDisposable = terminal.onData((data) => {
        if (!terminalId) return;
        void desktopApi.request("terminal.write", { terminalId, data }).catch((error) => {
          terminal.writeln(`\r\n\x1b[31m${error.message}\x1b[0m`);
        });
      });

      void desktopApi.request("terminal.create", {
        cols: Math.max(2, terminal.cols),
        rows: Math.max(1, terminal.rows),
      }).then((session) => {
        if (disposed) {
          void desktopApi.request("terminal.dispose", { terminalId: session.terminalId });
          return;
        }

        terminalId = session.terminalId;
        onSessionChange?.(session.shell);
        for (const event of pendingEvents) {
          if (event.terminalId === terminalId) terminal.write(event.data);
        }
        pendingEvents = [];
        terminal.focus();
      }).catch((error) => {
        terminal.writeln(`\x1b[31mUnable to start Rux terminal: ${error.message}\x1b[0m`);
        onSessionChange?.("error");
      });
    } else {
      onSessionChange?.("preview");
      inputDisposable = createFallbackShell(terminal);
    }

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (desktopApi && terminalId) {
        void desktopApi.request("terminal.resize", {
          terminalId,
          cols: Math.max(2, terminal.cols),
          rows: Math.max(1, terminal.rows),
        }).catch(() => undefined);
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputDisposable?.dispose();
      unsubscribeRuntime();
      if (desktopApi && terminalId) {
        void desktopApi.request("terminal.dispose", { terminalId }).catch(() => undefined);
      }
      terminal.dispose();
    };
  }, [onSessionChange]);

  return <div className="terminal-surface" ref={containerRef} data-testid="terminal-surface" />;
}
