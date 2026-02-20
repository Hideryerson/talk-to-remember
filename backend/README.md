# Recall Backend (Render)

后端职责：
- `REST API`：`/api/*`
- `Gemini Live` 代理：`/ws/live`
- 数据持久化：`Supabase Postgres`

## 1) 在 Supabase 创建数据库表（一次性）

1. 打开 [Supabase](https://supabase.com/) 并创建一个项目。  
2. 进入 `SQL Editor`，新建查询，粘贴下面 SQL 并执行：

```sql
create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  name text not null default '',
  hobbies text[] not null default '{}',
  self_intro text not null default '',
  preferences jsonb not null default '{}'::jsonb,
  conversation_summaries text[] not null default '{}',
  onboarding_complete boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  image_data_url text not null default '',
  image_mime_type text not null default 'image/jpeg',
  image_versions jsonb not null default '[]'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  name text
);

create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);
```

## 2) 获取 Supabase 密钥并配置环境变量

在 Supabase 项目里：
- `Project Settings` → `API`
- 复制：
  - `Project URL` → 给 `SUPABASE_URL`
  - `service_role` key → 给 `SUPABASE_SERVICE_ROLE_KEY`

`service_role` 非常敏感，只能放后端（Render），绝不能放前端。

## 3) 本地启动

1. `cp .env.example .env`
2. 填写 `.env`：
   - `GOOGLE_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. `npm install`
4. `npm run dev`

## 4) Render 部署

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variables:
  - `GOOGLE_API_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CORS_ORIGINS`（建议填你的 Vercel 域名）
