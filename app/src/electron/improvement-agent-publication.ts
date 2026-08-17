import type { ImprovementSummary } from "../shared/protocol.ts";
import { AgentProfileStore } from "./agent-profile-store.ts";
import { ImprovementStore } from "./improvement-store.ts";

function target(improvements: ImprovementStore, profiles: AgentProfileStore, candidateId: string) {
  const candidate = improvements.getCandidate(candidateId);
  if (!candidate || candidate.type !== "agent-instruction" || !candidate.agentProfileId || !candidate.agentRevisionId) throw new Error("IMPROVEMENT_AGENT_TARGET_MISSING: Agent candidate target is unavailable");
  const profile = profiles.get(candidate.agentProfileId);
  if (!profile) throw new Error("IMPROVEMENT_AGENT_TARGET_MISSING: Agent Definition was deleted");
  return { candidate, profile };
}

export function publishAgentInstructionCandidate(improvements: ImprovementStore, profiles: AgentProfileStore, candidateId: string, editedContent?: string): ImprovementSummary {
  const { candidate, profile } = target(improvements, profiles, candidateId);
  const validated = improvements.validatePublication(candidate.id, editedContent);
  let publishedRevisionId: string;
  if (profile.latestRevisionId === candidate.agentRevisionId) {
    publishedRevisionId = profiles.update(profile.id, { instructions: validated.content }).latestRevisionId;
  } else if (profile.instructions === validated.content && profile.revisionNumber > (profiles.getRevision(candidate.agentRevisionId!)?.revisionNumber ?? Number.MAX_SAFE_INTEGER)) {
    publishedRevisionId = profile.latestRevisionId;
  } else {
    throw new Error("IMPROVEMENT_AGENT_REVISION_STALE: Agent changed after this candidate was proposed; generate a fresh candidate");
  }
  return improvements.publishAgentInstruction(candidate.id, publishedRevisionId, validated.content);
}

export function rollbackAgentInstructionCandidate(improvements: ImprovementStore, profiles: AgentProfileStore, candidateId: string): ImprovementSummary {
  const { candidate, profile } = target(improvements, profiles, candidateId);
  if (!candidate.publishedAgentRevisionId) throw new Error("IMPROVEMENT_AGENT_REVISION_STALE: Published Agent Revision is missing");
  const baseRevision = profiles.getRevision(candidate.agentRevisionId!);
  if (!baseRevision) throw new Error("IMPROVEMENT_AGENT_TARGET_MISSING: Base Agent Revision is unavailable");
  const publishedRevision = profiles.getRevision(candidate.publishedAgentRevisionId);
  let rollbackRevisionId: string;
  if (profile.latestRevisionId === candidate.publishedAgentRevisionId) {
    rollbackRevisionId = profiles.update(profile.id, { instructions: baseRevision.instructions }).latestRevisionId;
  } else if (profile.instructions === baseRevision.instructions && profile.revisionNumber > (publishedRevision?.revisionNumber ?? Number.MAX_SAFE_INTEGER)) {
    rollbackRevisionId = profile.latestRevisionId;
  } else {
    throw new Error("IMPROVEMENT_AGENT_REVISION_STALE: Agent changed after publication; rollback will not overwrite the newer Revision");
  }
  return improvements.rollbackAgentInstruction(candidate.id, rollbackRevisionId);
}
