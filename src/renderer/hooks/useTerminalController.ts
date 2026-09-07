import { useCallback, useEffect, useRef, useState } from "react";
import type { RuxApi } from "../../electron/preload";
import type { TerminalChunk } from "../../terminal/RuxTerminal";
import { SerialTaskQueue } from "../serial-task-queue";

export function useTerminalController(api: RuxApi, projectId: string | undefined, onCommandCommitted: () => void, onError: (message: string) => void) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [output, setOutput] = useState<TerminalChunk[]>([]);
  const sequence = useRef(0);
  const size = useRef({ cols: 120, rows: 30 });
  const queue = useRef(new SerialTaskQueue());
  const session = useRef<{ projectId: string; ready: Promise<unknown>; acceptData: boolean } | null>(null);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const commandRef = useRef(onCommandCommitted);
  commandRef.current = onCommandCommitted;
  const pending = useRef<TerminalChunk[]>([]);
  const outputTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const append = useCallback((data: string) => {
    if (!session.current?.acceptData || session.current.projectId !== currentProject.current) return;
    pending.current.push({ sequence: ++sequence.current, data });
    setStarting(false);
    outputTimer.current ??= setTimeout(() => {
      outputTimer.current = undefined;
      const chunks = pending.current.splice(0);
      if (!chunks.length) return;
      setOutput((current) => {
        const next = [...current, ...chunks].slice(-2000);
        let length = 0;
        // Keep a bounded replay buffer; the live xterm owns its own scrollback.
        for (let index = next.length - 1; index >= 0; index--) {
          length += next[index].data.length;
          if (length > 512_000 && index < next.length - 1) return next.slice(index + 1);
        }
        return next;
      });
    }, 16);
  }, []);
  useEffect(() => api.terminal.onData((data) => append(String(data))), [api, append]);
  const close = useCallback(async () => {
    if (!session.current) return;
    session.current = null;
    pending.current = [];
    clearTimeout(outputTimer.current); outputTimer.current = undefined;
    clearTimeout(commandTimer.current);
    setStarting(false); setOpen(false); setOutput([]);
    await queue.current.run(() => api.terminal.stop()).catch(() => {});
  }, [api]);
  const start = useCallback(async () => {
    const id = currentProject.current;
    if (!id || session.current?.projectId === id) return;
    if (session.current) await close();
    if (currentProject.current !== id || session.current) return;
    const active = { projectId: id, acceptData: false, ready: Promise.resolve() as Promise<unknown> };
    session.current = active;
    setStarting(true); setOutput([]); setOpen(true);
    active.ready = queue.current.run(async () => {
      if (session.current !== active) return;
      active.acceptData = true;
      await api.terminal.start(id);
      if (session.current === active) await api.terminal.resize(size.current);
    });
    try { await active.ready; if (session.current === active) setStarting(false); }
    catch (error) {
      if (session.current !== active) return;
      session.current = null; setStarting(false); setOpen(false);
      pending.current = [];
      clearTimeout(outputTimer.current); outputTimer.current = undefined;
      clearTimeout(commandTimer.current);
      // A resize error can happen after the PTY was created; retire it before retry.
      void queue.current.run(() => api.terminal.stop()).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      setOutput([{ sequence: ++sequence.current, data: `${message}\r\n选择终端工具以重试。\r\n` }]);
      onError(message);
    }
  }, [api, close, onError]);
  useEffect(() => { if (session.current?.projectId !== projectId) void close(); }, [close, projectId]);
  useEffect(() => () => { void close(); }, [close]);

  const write = useCallback((data: string) => {
    const active = session.current;
    if (!active || active.projectId !== currentProject.current) return;
    const writeTask = queue.current.run(async () => {
      if (session.current !== active || active.projectId !== currentProject.current) return;
      await api.terminal.write(data);
      if (data.includes("\r")) {
        clearTimeout(commandTimer.current);
        commandTimer.current = setTimeout(() => { if (session.current === active) commandRef.current(); }, 500);
      }
    });
    void writeTask.catch((error) => { if (session.current !== active) return; const message = error instanceof Error ? error.message : String(error); append(`${message}\r\n`); onError(message); });
  }, [api, append, onError]);
  const resize = useCallback((nextSize: { cols: number; rows: number }) => {
    if (size.current.cols === nextSize.cols && size.current.rows === nextSize.rows) return;
    size.current = nextSize;
    const active = session.current;
    if (active) void active.ready.then(() => { if (session.current === active) return api.terminal.resize(nextSize); }).catch(() => {});
  }, [api]);
  return { terminalOpen: open, terminalStarting: starting, terminalOutput: output, appendTerminalOutput: append, startTerminal: start, closeTerminal: close, writeTerminalInput: write, resizeTerminal: resize };
}
