export type ConversationMessage = { role: "user" | "assistant"; text: string; attachments?: string[] };

export function apiConversation(messages: readonly { role: string; text?: string; parts?: Array<{ type: string; text?: string }>; attachments?: string[]; status?: string }[]): ConversationMessage[] {
  return messages.flatMap((message, index): ConversationMessage[] => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    if (message.role === "assistant" && ["running", "error", "incomplete"].includes(message.status || "")) return [];
    const response = messages[index + 1];
    if (message.role === "user" && response?.role === "assistant" && ["running", "error", "incomplete"].includes(response.status || "")) return [];
    const text = message.text || message.parts?.filter((part) => part.type === "text").map((part) => part.text || "").join("\n") || "";
    if (!text && !message.attachments?.length) return [];
    return [{ role: message.role, text, ...(message.role === "user" && message.attachments?.length ? { attachments: message.attachments } : {}) }];
  });
}
