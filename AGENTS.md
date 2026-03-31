<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# 一、 整体系统架构 (System Architecture)

整体采用 Serverless 全栈架构，极大地降低运维成本，将精力聚焦于 AI 编排与前端交互。

前端与 API 层： 采用 Next.js (App Router)。它既负责渲染高保真的 React 页面，又提供轻量级的后端 API 路由，完美承接 AI 大模型的流式输出。

云端运行环境： 前端直接集成 Sandpack，在浏览器内存中提供类似 VS Code 的文件树、代码高亮编辑器和实时预览窗口 。

后端服务与数据持久化 (BaaS)： 采用 Supabase。负责接管所有复杂的数据库读写、文件结构存储以及用户登录鉴权。

托管部署： Vercel 平台自动化一键部署，提供全局 CDN 与动态路由支持。

# 二、 核心大脑：LangGraph 多智能体编排 (AI Team Mode)

为了完美复刻 Atoms 的“团队模式 (Team Mode)” ，摒弃了单模型直接生成代码的粗糙做法，转而采用 LangGraph.js 状态机架构：

状态流转 (State Machine)： 在后端维护一个贯穿始终的全局状态（包含用户提示词、需求文档、架构树、最终代码）。

多角色协同：

节点 A (产品经理 Emma)： 负责接收模糊需求，转化为清晰的 PRD 。

节点 B (架构师 Bob)： 依据 PRD，规划 React 多文件的目录结构与组件划分 。

节点 C (工程师 Alex)： 依据前两者的输出，严格编写 Tailwind + React 业务代码 。

结构化输出 (Structured Output)： 强制工程师 Alex 将代码输出为标准化的 JSON 对象（而非 Markdown），确保沙箱能100%无缝解析。

# 三、 动态沙箱与虚拟文件系统 (VFS & Sandbox Engine)

这是实现“所见即所得”与即时分享链路的关键。

JSONB 虚拟文件系统： 数据库中不存单文件文本，而是使用 JSONB 类型存储整个项目的多层级文件目录树结构（虚拟文件系统）。

前端沙箱渲染： Sandpack 接收这个 JSONB 数据，在浏览器中实时安装依赖（如 Lucide-React, Tailwind），并热更新渲染界面。

无服务器的即时分享 (Instant Preview)： 利用 Next.js 的动态路由（如 /preview/[id]），读取数据库中的文件树，并渲染一个隐藏了所有代码编辑器的“纯净版”全屏 Sandpack。这实现了物理级别免部署的“秒级在线访问链接”。

# 四、 数据安全与用户鉴权 (Data & Auth Strategy)

依托 Supabase 提供的开箱即用能力，实现极简且安全的数据基座：

无密码登录： 采用邮箱 Magic Link 或 Google OAuth 授权，满足流畅的初始注册体验。

行级安全 (RLS)： 数据库层面设置策略，确保用户生成的项目代码和对话历史彼此绝对隔离，只能自己查看和修改（分享预览链接除外）。

状态注入 (State Injection) 代替全量记忆： 在多轮迭代对话中，后端不携带冗长的废话历史，而是直接将当前沙箱的“最新代码快照 (JSON)”作为上下文传给 AI，实现精准的“增量修改”。

## 头像同步规则（Google OAuth）

- 初始化策略：当用户首次通过 Google 登录且 `profiles.avatar_url` 为空时，使用 Google 返回的头像 URL（`user.user_metadata.avatar_url` 或 `picture`）写入 `profiles.avatar_url`。
- 保留策略：当 `profiles.avatar_url` 已有值时，后续登录不得覆盖该值（视为用户已确认或已自定义头像）。
- 兼容策略：仅在头像为空、系统默认头像、或历史自动生成的 `google-default.svg` 头像场景下，允许回填 Google 头像。
- 兜底策略：若 Google 未返回头像 URL，则使用系统默认头像，不得阻塞登录流程。

# 五、 UI/UX 与交互设计理念 (Vibe & Design)

为了还原专业级 AI IDE 的科技感与沉浸感：

布局设计： 经典的 IDE 结构。左侧为可平滑折叠的控制侧边栏（包含对话、项目历史），右侧为主工作区（代码沙箱与预览视窗）。

UI 动效引擎： 引入 Framer Motion 处理页面过渡、骨架屏加载以及侧边栏的丝滑推拉，消除用户的等待焦虑。

AI“母语”样式： 弃用 CSS-in-JS，全盘采用 Tailwind CSS 作为全局样式方案。因为 Tailwind 是大模型训练集中覆盖最广的样式语言，能最大程度降低 AI 生成错误样式的幻觉。

透明的工作流反馈： 借助 Server-Sent Events (SSE)，后端将 LangGraph 各节点的进度实时推送到前端（如“Emma 正在编写需求...”），提供极佳的掌控感。

# UI 设计与代码规范 v2 (给 Copilot 的系统指令 - 落地页特别版)

## 技术栈

- 语言：React (Next.js App Router) + TypeScript (.tsx)
- 样式：严格使用 Tailwind CSS。
- 动效：使用 `framer-motion`。
- 图标：严格使用 `lucide-react`。

## 组件开发原则

- **呼吸感:** 布局要留白充分 (generous padding)，让元素有呼吸感。
- **卡片悬浮:** 所有卡片和按钮在悬停 (hover) 时，应有轻微的缩放 (`scale-105`) 和更强的毛玻璃效果，过渡时间 300ms。



# 大原则
如果有遇到问题和后续开发一致性的规范要求时，请更新AGENTS.md中的规范要求，并且在后续的开发中遵守这些规范要求。


# SKILLS
.agents/skills，这个目录是当前项目的技能库，里面的每个文件都是一个技能的实现细节和使用说明。每当你需要实现一个新功能或者优化现有功能时，请先查看这个目录，看看是否已经有相关的技能可以复用或者参考。