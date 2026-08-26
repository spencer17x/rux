import { Eye, FileText } from "@phosphor-icons/react";
import type { ComponentType } from "react";
import RuxAssistantThread from "../assistant/RuxAssistantThread";
import type { ActiveThread, GitState } from "../renderer/types";

const AssistantThread = RuxAssistantThread as ComponentType<Record<string, any>>;

export default function ConversationScreen({ standalone, activeThread, assistantProps, gitState, onReview }: { standalone: boolean; activeThread: ActiveThread; assistantProps: Record<string, any>; gitState: GitState; onReview: () => void }) {
  return <div className={`conversation-screen ${standalone ? "standalone-screen" : ""}`}><AssistantThread emptyTitle={standalone ? "开始独立会话" : `在 ${activeThread.projectName} 中开始任务`} {...assistantProps} />{!standalone && gitState.files.length > 0 && <div className="live-change-summary"><FileText size={18} /><strong>{gitState.files.length} 个真实文件变更</strong><button type="button" className="secondary-button" onClick={onReview}><Eye size={17} />审查变更</button></div>}</div>;
}
