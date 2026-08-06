# Dreaux Restaurant Ops

Professional multi-tenant restaurant operations platform.

## Current foundation

- React
- TypeScript
- Vite
- Supabase authentication client
- Mobile-first navigation
- Routes for Floor, Cash, Tasks, Rewards, Team, Reports, and Admin
- Environment variables kept out of GitHub

## Setup

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase Project URL and publishable key.
3. Run:

```bash
npm install
npm run dev
```

## Deployment

Use Vercel and add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never use a Supabase secret or service-role key in the frontend.
