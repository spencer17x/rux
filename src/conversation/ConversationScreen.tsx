import { Eye, FileText } from "@phosphor-icons/react";
import type { ComponentType } from "react";
import RuxAssistantThread from "../assistant/RuxAssistantThread";
import type { ActiveThread, GitState } from "../renderer/types";

const AssistantThread = RuxAssistantThread as ComponentType<Record<string, any>>;

export default function ConversationScreen({ standalone, activeThread, assistantProps, gitState, onReview }: { standalone: boolean; activeThread: ActiveThread; assistantProps: Record<string, any>; gitState: GitState; onReview: () => void }) {
  const plus = gitState.files.reduce((total, file) => total + file.plus, 0);
  const minus = gitState.files.reduce((total, file) => total + file.minus, 0);
  const workspaceSummary = !standalone && gitState.files.length > 0 ? <section className="live-change-summary" aria-label={`已编辑 ${gitState.files.length} 个文件`}><header><span className="change-summary-icon"><FileText size={20} /></span><span><strong>已编辑 {gitState.files.length} 个文件</strong><small><b>+{plus}</b> <em>−{minus}</em></small></span><button type="button" className="secondary-button" onClick={onReview}><Eye size={17} />审查</button></header><div className="change-summary-files">{gitState.files.slice(0, 8).map((file) => <button type="button" key={file.path} onClick={onReview}><span>{file.path}</span><small><b>+{file.plus}</b> <em>−{file.minus}</em></small></button>)}</div></section> : null;
  return <div className={`conversation-screen ${standalone ? "standalone-screen" : ""}`}><AssistantThread emptyTitle={standalone ? "开始独立会话" : `在 ${activeThread.projectName} 中开始任务`} workspaceSummary={workspaceSummary} {...assistantProps} /></div>;
}
