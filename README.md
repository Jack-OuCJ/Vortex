# atoms-demo

一个面向 AI 应用生成与迭代的工作台项目，目标是复刻类似 Atoms 的开发体验。用户可以先在首页输入需求创建项目，再进入工作台与 AI 协作生成代码、修改文件，并在浏览器内完成预览。

当前项目基于 Next.js App Router 构建，前端提供首页、登录页和 Workbench；后端通过 API 路由承接 AI 对话、项目管理和文件持久化；数据层使用 Supabase 保存用户、项目、会话和项目文件；浏览器侧通过 WebContainer 提供文件系统、命令执行和预览能力。

## 项目包含什么

- 首页项目入口：输入需求后自动创建项目并跳转到工作台。
- AI 工作台：支持对话、文件树、Monaco 编辑器、步骤流反馈和预览联动。
- 多角色 AI 编排：后端使用 LangGraph / LangChain 组织路由与执行流程。
- 项目持久化：Supabase 保存项目、文件、聊天会话和消息历史。
- 登录鉴权：基于 Supabase Auth，支持邮箱登录和 OAuth 回调。

## 技术栈

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS 4 + Framer Motion
- Monaco Editor
- WebContainer
- Supabase
- LangChain / LangGraph / OpenAI Compatible API

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env.local`，至少补齐下面这些变量：

```bash
NEXT_PUBLIC_SUPABASE_URL=你的 Supabase Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的 Supabase Anon Key
OPENAI_API_KEY=你的模型服务 Key

# 可选：使用 OpenAI 兼容网关时配置
OPENAI_BASE_URL=

# 可选：如果需要接 Turnstile 校验接口再配置
TURNSTILE_SECRET_KEY=
```

说明：

- `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 是前后端都依赖的必填项。
- `OPENAI_API_KEY` 用于 `/api/chat` 和 `/api/projects/title` 的模型调用。
- `OPENAI_BASE_URL` 为空时默认走标准 OpenAI SDK 配置；如果你接的是兼容接口，可以在这里填网关地址。
- `TURNSTILE_SECRET_KEY` 仅在你实际使用 `/api/turnstile/verify` 时需要。

### 3. 准备 Supabase 数据表

本项目依赖以下核心表：

- `profiles`
- `projects`
- `project_files`
- `chat_sessions`
- `chat_messages`

另外，首页和额度展示还会读取 `profiles` 表中的这些字段：

- `email`
- `username`
- `avatar_url`
- `ai_balance`
- `max_ai_balance`

如果你的 Supabase 项目还没有这些表和字段，需要先按当前项目后端约定完成建表与 RLS 配置，再启动应用。

### 4. 启动开发环境

```bash
npm run dev
```

默认启动地址：

```text
http://localhost:3000
```

## 运行后的基本流程

1. 打开首页输入一个需求。
2. 系统会先创建项目，再跳转到 `/workbench`。
3. 在工作台中，AI 会通过流式接口返回步骤、工具调用状态和最终代码结果。
4. 生成或修改后的文件会同步到 Supabase，并在浏览器侧预览。

## 常用命令

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## 说明

- 当前仓库不是默认的 Next.js 示例工程，README 也应以本项目的工作台和 AI 编排能力为准。
- 如果本地能正常打开首页但无法创建项目，优先检查 Supabase 环境变量、登录态以及数据表是否齐全。
- 如果对话接口报错，优先检查 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 是否配置正确。
