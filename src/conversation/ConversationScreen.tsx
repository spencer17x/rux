import { Button } from "../ui";
import { CaretRight } from "../ui/icons";
import type { ComponentType } from "react";
import RuxAssistantThread from "../assistant/RuxAssistantThread";
import type { ActiveThread, GitState } from "../renderer/types";

const AssistantThread = RuxAssistantThread as ComponentType<Record<string, any>>;

export default function ConversationScreen({ standalone, activeThread, assistantProps, gitState, onReview }: { standalone: boolean; activeThread: ActiveThread; assistantProps: Record<string, any>; gitState: GitState; onReview: (path?: string) => void }) {
  const plus = gitState.files.reduce((total, file) => total + file.plus, 0);
  const minus = gitState.files.reduce((total, file) => total + file.minus, 0);
  const workspaceSummary = !standalone && gitState.files.length > 0 ? <details className="live-change-summary" aria-label={`已编辑 ${gitState.files.length} 个文件`}><summary>{gitState.files.length} 个文件已更新<CaretRight size="sm" /></summary><div className="change-summary-files">{gitState.files.slice(0, 8).map((file) => <Button variant="plain" type="button" key={file.path} onClick={() => onReview(file.path)}><span>{file.path}</span><small><b>+{file.plus}</b> <em>−{file.minus}</em></small></Button>)}<Button variant="plain" type="button" className="change-summary-review" onClick={() => onReview()}><span>审查全部更改</span><small>+{plus} −{minus}</small></Button></div></details> : null;
  return <div className={`conversation-screen ${standalone ? "standalone-screen" : ""}`}><AssistantThread emptyTitle={standalone ? "开始独立会话" : `在 ${activeThread.projectName} 中开始任务`} workspaceSummary={workspaceSummary} {...assistantProps} /></div>;
}
