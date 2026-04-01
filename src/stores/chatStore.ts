import { create } from "zustand";
import { AGENT_AVATAR_MAP, AGENT_DISPLAY_NAME_MAP, type AgentRole } from "@/lib/agent-meta";

export type MessageAgent = AgentRole | "user";

export type ChatMessage = {
  agent: MessageAgent;
  name: string;
  avatar: string;
  content: string;
  status?: "thinking" | "done" | "error" | "streaming";
  timestamp: number;
};

const initialMessages: ChatMessage[] = [
  {
    agent: "engineer",
    name: "Alex",
    avatar: "/teams-avatar/50-engineer.png",
    content: "我是 Alex。告诉我你想做什么；如果要开发，我会先整理任务，再改代码、修复问题并给你一份完成报告。",
    timestamp: new Date("2026-03-31T12:30:00").getTime(),
  },
];

type HistoryMessage = {
  role: "user" | "agent";
  agent_name: string | null;
  agent_role: string | null;
  content: string;
  status: "thinking" | "streaming" | "done" | "stopped" | "error";
  created_at: string;
};

type ChatStore = {
  inputValue: string;
  messages: ChatMessage[];
  isGenerating: boolean;
  setInputValue: (value: string) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  appendMessage: (message: ChatMessage) => void;
  updateLastAgentMessage: (name: string, update: Partial<ChatMessage>) => void;
  upsertAgentMessage: (message: ChatMessage) => void;
  loadHistory: (historyMessages: HistoryMessage[]) => void;
  resetMessages: () => void;
};

const resolveAgentRole = (agentRole: string | null): AgentRole => {
  switch (agentRole) {
    case "leader":
    case "seo":
    case "pm":
    case "architect":
    case "engineer":
    case "analyst":
    case "researcher":
      return agentRole;
    default:
      return "engineer";
  }
};

export const useChatStore = create<ChatStore>((set) => ({
  inputValue: "",
  messages: initialMessages,
  isGenerating: false,
  setInputValue: (inputValue) => set({ inputValue }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  appendMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  updateLastAgentMessage: (name, update) =>
    set((state) => {
      const next = [...state.messages];
      const lastIdx = next.map((m) => m.name).lastIndexOf(name);
      if (lastIdx === -1) {
        return state;
      }
      next[lastIdx] = {
        ...next[lastIdx],
        ...update,
      };
      return { messages: next };
    }),
  upsertAgentMessage: (message) =>
    set((state) => {
      const next = [...state.messages];
      const lastIdx = next.map((m) => m.name).lastIndexOf(message.name);
      if (lastIdx !== -1) {
        const last = next[lastIdx];
        if (last.status === "thinking" || last.status === "streaming") {
          next[lastIdx] = {
            ...last,
            ...message,
          };
          return { messages: next };
        }
      }
      return { messages: [...state.messages, message] };
    }),
  loadHistory: (historyMessages) =>
    set(() => {
      if (!historyMessages.length) {
        return { messages: initialMessages };
      }

      const mapped: ChatMessage[] = historyMessages
        .filter((m) => m.status !== "thinking" && m.status !== "streaming")
        .map((m) => {
          if (m.role === "user") {
            return {
              agent: "user" as MessageAgent,
              name: "You",
              avatar: "",
              content: m.content,
              status: "done" as const,
              timestamp: new Date(m.created_at).getTime(),
            };
          }
          const role = resolveAgentRole(m.agent_role);
          const name = m.agent_name ?? AGENT_DISPLAY_NAME_MAP[role] ?? "Alex";
          return {
            agent: role as MessageAgent,
            name,
            avatar: AGENT_AVATAR_MAP[role],
            content: m.content,
            status: (m.status === "stopped" ? "done" : m.status) as ChatMessage["status"],
            timestamp: new Date(m.created_at).getTime(),
          };
        });

      return { messages: mapped };
    }),
  resetMessages: () => set({ messages: initialMessages }),
}));
