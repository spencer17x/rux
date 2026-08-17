import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentProfileStore } from "../src/electron/agent-profile-store.ts";
import { ImprovementStore } from "../src/electron/improvement-store.ts";
import { publishAgentInstructionCandidate, rollbackAgentInstructionCandidate } from "../src/electron/improvement-agent-publication.ts";

const connection = { id: "cli:codex:default", kind: "official-cli", engine: "codex", label: "Codex CLI default" };

test("Agent instruction publication appends immutable Revisions and rollback appends another Revision", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-improvement-agent-"));
  const profiles = new AgentProfileStore(join(directory, "profiles.json"), { idFactory: () => "00000000-0000-4000-8000-000000000099" });
  const improvements = new ImprovementStore(join(directory, "improvements.json"));
  const profile = profiles.create({ name: "Review Agent", backend: "codex", providerConnection: connection, instructions: "Original instructions", permissionMode: "acceptEdits" });
  let summary = improvements.propose({ projectId: "project-1", type: "agent-instruction", scope: "agent", agentProfileId: profile.id, name: "Tighter review", content: "Review changes and run focused tests." }, { agentProfileId: profile.id, agentRevisionId: profile.latestRevisionId });
  const candidate = summary.candidates[0];
  summary = publishAgentInstructionCandidate(improvements, profiles, candidate.id);
  const published = profiles.get(profile.id);
  assert.equal(published.revisionNumber, 2);
  assert.equal(published.instructions, "Review changes and run focused tests.");
  assert.equal(profiles.getRevision(profile.latestRevisionId).instructions, "Original instructions");
  assert.equal(summary.candidates[0].publishedAgentRevisionId, published.latestRevisionId);

  summary = rollbackAgentInstructionCandidate(improvements, profiles, candidate.id);
  const rolledBack = profiles.get(profile.id);
  assert.equal(rolledBack.revisionNumber, 3);
  assert.equal(rolledBack.instructions, "Original instructions");
  assert.equal(summary.candidates[0].rollbackAgentRevisionId, rolledBack.latestRevisionId);
  assert.equal(summary.candidates[0].status, "rolled-back");
});

test("Agent instruction candidate refuses to overwrite a newer unrelated Revision", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-improvement-agent-stale-"));
  const profiles = new AgentProfileStore(join(directory, "profiles.json"), { idFactory: () => "00000000-0000-4000-8000-000000000100" });
  const improvements = new ImprovementStore(join(directory, "improvements.json"));
  const profile = profiles.create({ name: "Stale Agent", backend: "codex", providerConnection: connection, instructions: "Base", permissionMode: "acceptEdits" });
  const summary = improvements.propose({ projectId: "project-1", type: "agent-instruction", scope: "agent", agentProfileId: profile.id, name: "Candidate", content: "Candidate instructions" }, { agentProfileId: profile.id, agentRevisionId: profile.latestRevisionId });
  profiles.update(profile.id, { instructions: "Unrelated newer edit" });
  assert.throws(() => publishAgentInstructionCandidate(improvements, profiles, summary.candidates[0].id), /IMPROVEMENT_AGENT_REVISION_STALE/);
});
