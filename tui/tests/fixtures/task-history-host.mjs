import readline from 'node:readline';

const taskState = {
  version: 1,
  workspaceId: 'workspace-pty',
  tasks: [
    {
      id: 'task-older',
      workspaceId: 'workspace-pty',
      title: 'Older evidence task',
      status: 'completed',
      adapter: 'codex',
      permissionMode: 'plan',
      updatedAtIso: '2026-08-09T00:00:00Z',
      createdAt: '2026-08-09T00:00:00Z',
      messages: [{ role: 'user', text: 'Review the recorded test evidence' }],
      runs: [
        {
          id: 'run-evidence',
          adapter: 'codex',
          permissionMode: 'plan',
          updatedAt: '2026-08-09T00:00:01Z',
          verifications: [
            {
              id: 'verification-unknown',
              runId: 'run-evidence',
              kind: 'test',
              command: 'npm test',
              cwd: process.env.RUX_WORKSPACE_ROOT,
              finishedAt: '2026-08-09T00:00:01Z',
              status: 'unknown',
              log: 'The adapter did not expose an authoritative result.',
              redacted: false,
              truncated: false,
            },
          ],
        },
      ],
    },
    {
      id: 'task-current',
      workspaceId: 'workspace-pty',
      title: 'Current task',
      status: 'completed',
      adapter: 'codex',
      permissionMode: 'plan',
      updatedAtIso: '2026-08-10T00:00:00Z',
      createdAt: '2026-08-10T00:00:00Z',
      messages: [{ role: 'user', text: 'Current task prompt' }],
      runs: [],
    },
  ],
  updatedAt: '2026-08-10T00:00:00Z',
};

console.log(
  JSON.stringify({
    kind: 'event',
    event: {
      type: 'runtime.ready',
      status: {
        protocolVersion: __PROTOCOL_VERSION__,
        pid: process.pid,
        platform: process.platform,
        workspaceRoot: process.env.RUX_WORKSPACE_ROOT,
        startedAt: '2026-08-10T00:00:00Z',
      },
    },
  }),
);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const result = request.method === 'task.state.load' ? taskState : {};
  console.log(JSON.stringify({ kind: 'response', id: request.id, ok: true, result }));
});
