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
  const writeQueue = useRef(new SerialTaskQueue());
  const startTask = useRef<Promise<unknown>>(Promise.resolve());
  const awaitingFirstData = useRef(false);
  const previousProjectId = useRef(projectId);
  const append = useCallback((data: string) => {
    sequence.current += 1;
    const chunk = { sequence: sequence.current, data };
    const firstData = awaitingFirstData.current;
    if (firstData) { awaitingFirstData.current = false; setStarting(false); }
    setOutput((current) => firstData ? [chunk] : [...current, chunk].slice(-2000));
  }, []);
  useEffect(() => api.terminal.onData((data) => append(String(data))), [api, append]);
  const start = useCallback(async () => {
    if (!projectId || open) return;
    awaitingFirstData.current = true;
    setStarting(true);
    setOutput([]);
    setOpen(true);
    startTask.current = api.terminal.start(projectId).then(() => api.terminal.resize(size.current));
    try { await startTask.current; }
    catch (error) { setStarting(false); append(`${error instanceof Error ? error.message : String(error)}\r\n`); }
  }, [api, append, open, projectId]);
  const close = useCallback(async () => { if (open) await api.terminal.stop().catch(() => {}); awaitingFirstData.current = false; setStarting(false); setOpen(false); }, [api, open]);
  useEffect(() => {
    if (previousProjectId.current !== projectId && open) void close();
    previousProjectId.current = projectId;
  }, [close, open, projectId]);
  const write = useCallback((data: string) => {
    const writeTask = writeQueue.current.run(async () => { await startTask.current; return await api.terminal.write(data); }).catch((error) => { const message = error instanceof Error ? error.message : String(error); append(`${message}\r\n`); onError(message); });
    if (data.includes("\r")) void writeTask.then(() => window.setTimeout(onCommandCommitted, 500));
  }, [api, append, onCommandCommitted, onError]);
  const resize = useCallback((nextSize: { cols: number; rows: number }) => { size.current = nextSize; api.terminal.resize(nextSize).catch(() => {}); }, [api]);
  return { terminalOpen: open, terminalStarting: starting, terminalOutput: output, appendTerminalOutput: append, startTerminal: start, closeTerminal: close, writeTerminalInput: write, resizeTerminal: resize };
}
