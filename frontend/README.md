# Recall Frontend (Next.js PWA)

## Quick start

1. Copy env file:
   - `cp .env.example .env.local`
2. Set backend endpoints in `.env.local`
3. Install dependencies:
   - `npm install`
4. Run:
   - `npm run dev`

## Vercel env vars

- `NEXT_PUBLIC_BACKEND_URL=https://<your-render-domain>`
- `NEXT_PUBLIC_WS_URL=wss://<your-render-domain>/ws/live`

## Common auth issue: "Load failed"

If login/register shows `Load failed`, usually one of these is wrong:
- `NEXT_PUBLIC_BACKEND_URL` is missing or still `http://` while frontend is `https://`
- backend CORS does not include your Vercel domain
