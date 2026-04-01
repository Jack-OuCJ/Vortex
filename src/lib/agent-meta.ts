export type AgentRole =
  | "leader"
  | "seo"
  | "pm"
  | "architect"
  | "engineer"
  | "analyst"
  | "researcher";

export const AGENT_AVATAR_MAP: Record<AgentRole, string> = {
  leader: "/teams-avatar/Leader.png",
  seo: "/teams-avatar/seo.png",
  pm: "/teams-avatar/pm.png",
  architect: "/teams-avatar/architect.png",
  engineer: "/teams-avatar/50-engineer.png",
  analyst: "/teams-avatar/data-analyst.png",
  researcher: "/teams-avatar/deep-researcher.png",
};

export const AGENT_DISPLAY_NAME_MAP: Record<AgentRole, string> = {
  leader: "Emma",
  seo: "Sarah",
  pm: "Liam",
  architect: "Bob",
  engineer: "Alex",
  analyst: "David",
  researcher: "Maya",
};

export const AGENT_ROLE_LABEL_MAP: Record<AgentRole, string> = {
  leader: "团队领导",
  seo: "SEO专家",
  pm: "产品经理",
  architect: "架构师",
  engineer: "工程师",
  analyst: "技术分析师",
  researcher: "深度研究员",
};