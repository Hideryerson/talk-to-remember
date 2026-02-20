# Recall App (Split Architecture)

This repository is now split into two independent projects:

- `frontend/` → Next.js PWA (deploy to Vercel)
- `backend/` → Node.js API + Gemini proxy (deploy to Render)

## Local development

1. Start backend
   - `cd backend`
   - `cp .env.example .env`
   - fill `GOOGLE_API_KEY`
   - fill `SUPABASE_URL`
   - fill `SUPABASE_SERVICE_ROLE_KEY`
   - `npm install`
   - `npm run dev`

2. Start frontend
   - `cd frontend`
   - `cp .env.example .env.local`
   - set `NEXT_PUBLIC_BACKEND_URL=http://localhost:8080`
   - set `NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws/live`
   - `npm install`
   - `npm run dev`
