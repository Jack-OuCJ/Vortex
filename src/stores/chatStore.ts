import { create } from "zustand";

export type MessageAgent = "pm" | "architect" | "engineer" | "debug" | "user";

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
    agent: "pm",
    name: "Emma",
    avatar: "/teams-avatar/pm.png",
    content: "Hi! I am Emma, your Product Manager. What are we building today?",
    timestamp: new Date("2026-03-29T12:00:00").getTime(),
  },
  {
    agent: "engineer",
    name: "Alex",
    avatar: "/teams-avatar/50-engineer.png",
    content: "Alex here! Ready to dive into the code and build something great.",
    timestamp: new Date("2026-03-31T12:30:00").getTime(),
  },
];

type ChatStore = {
  inputValue: string;
  messages: ChatMessage[];
  isGenerating: boolean;
  setInputValue: (value: string) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  appendMessage: (message: ChatMessage) => void;
  updateLastAgentMessage: (name: string, update: Partial<ChatMessage>) => void;
  upsertAgentMessage: (message: ChatMessage) => void;
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
}));
