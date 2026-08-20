export function nativeSessionKind(adapter) {
  if (adapter === "codex") return "codex-thread";
  if (adapter === "claude-code") return "claude-session";
  if (adapter === "rux-native") return "rux-response";
  return "mock-session";
}

export function createNativeSessionLink({ adapter, providerConnection, agentRevisionId, workspaceId, sessionId }) {
  if (!sessionId || !adapter || !providerConnection?.id || !agentRevisionId || !workspaceId) return undefined;
  return {
    kind: nativeSessionKind(adapter),
    engine: adapter,
    providerConnectionId: providerConnection.id,
    agentRevisionId,
    workspaceId,
    nativeSessionId: sessionId,
  };
}

export function sessionLinkCompatible(link, task) {
  return Boolean(
    link
    && task
    && link.engine === task.adapter
    && link.providerConnectionId === task.providerConnection?.id
    && link.agentRevisionId === task.agentRevisionId
    && link.workspaceId === task.workspaceId,
  );
}

export function latestCompatibleSessionLink(task) {
  const importedNativeSessionId = task?.importedSession?.sessionLink?.nativeSessionId;
  for (const run of [...(task?.runs || [])].reverse()) {
    const link = run.sessionLink || createNativeSessionLink({
      adapter: run.adapter,
      providerConnection: run.providerConnection,
      agentRevisionId: run.agentRevisionId,
      workspaceId: task.workspaceId,
      sessionId: run.sessionId,
    });
    if (sessionLinkCompatible(link, task) && link.nativeSessionId !== importedNativeSessionId) return link;
  }
  return undefined;
}

export function resumeFailureForTask(task) {
  const run = (task?.runs || []).at(-1);
  if (!run || run.status !== "failed" || !run.resumeFrom || !run.resumeFailure) return undefined;
  return { run, link: run.resumeFrom, error: run.resumeFailure };
}
