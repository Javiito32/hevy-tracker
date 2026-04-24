# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm run preview      # Preview production build

# Database
npx prisma studio    # Open Prisma DB GUI
npx prisma migrate dev --name <name>   # Create and apply a migration
npx prisma generate  # Regenerate Prisma client after schema changes
npx prisma db push   # Push schema changes without a migration (dev only)
```

## Environment Setup

Copy `.env` and fill in both keys before running:

```
DATABASE_URL="file:./dev.db"
HEVY_API_KEY=your_hevy_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

Both keys are exposed to server-side code via `useRuntimeConfig()` as `config.hevyApiKey` and `config.openaiApiKey`. They are declared in `nuxt.config.ts` under `runtimeConfig` (server-only, not `public`).

## Architecture

### Directory structure

```
app/            ← Nuxt frontend (pages, components, layouts)
server/
  api/          ← Nitro API route handlers (file = route)
  utils/        ← Shared server utilities (prisma, hevy-client, ai-context, volume-calculator)
  plugins/      ← Nitro plugins (cron job)
prisma/
  schema.prisma ← SQLite schema
  dev.db        ← SQLite database file
```

The project uses **Nuxt 4** with the `/app` subdirectory convention (`future.compatibilityVersion: 3` is set in `nuxt.config.ts`). Frontend code lives in `app/`, server code in `server/`.

### API routes

Nitro file-based routing: `server/api/workouts/[id].get.ts` → `GET /api/workouts/:id`. The HTTP method is the file suffix (`.get.ts`, `.post.ts`, `.patch.ts`). Dynamic segments use `getRouterParam(event, 'id')`.

All server handlers use `defineEventHandler`. Prisma is accessed via the singleton in `server/utils/prisma.ts` — import from there, not `new PrismaClient()` directly (avoids connection exhaustion in dev).

### Data sync flow

`POST /api/sync` (`server/api/sync.post.ts`) handles all Hevy data ingestion:

- **Workouts — bootstrap mode**: if the local DB has 0 workouts, fetches all pages from `GET /v1/workouts` (page size 10).
- **Workouts — incremental mode**: on subsequent syncs, fetches `GET /v1/workouts/events?since=<last_updated_at>` and processes `created`, `updated`, and `deleted` events via upsert/delete.
- **Body metrics — bootstrap**: similar full-page fetch from `GET /v1/body_measurements`.
- **Body metrics — incremental**: fetches day-by-day from the last recorded date to today using `GET /v1/body_measurements/{YYYY-MM-DD}`.

The sync runs automatically via a cron job at 02:00 AM server time (`server/plugins/cron.ts`).

Per-workout computed fields stored in DB:
- `total_volume` — sum of `weight_kg × reps` across all sets (via `calcSetVolume`)
- `rpe_avg` — average RPE across sets that have RPE data (via `calcAverageRPE`)
- `exercises_summary` — JSON string of `Array<{ name, sets, total_volume, estimated_1rm, sets_details }>`. **Always `JSON.parse()` before use in API responses.**
- `estimated_1rm` — per-exercise max, using Epley's formula: `w × (1 + r/30)` (via `calcEstimated1RM`)

### AI integration

**Chat** (`POST /api/chat`): takes `{ message, historyContext, conversationId }`. The system prompt is built dynamically in `server/utils/ai-context.ts` — it queries the active mesocycle and last 5 workouts from the DB and formats them as Spanish narrative context. Chat messages are persisted to `AiConversation` / `AiMessage` tables.

**Workout analysis** (`POST /api/workouts/:id/analyze`): builds a detailed per-workout prompt with all exercise sets, RPE, and mesocycle context. Returns a markdown string.

Both endpoints gate on `config.openaiApiKey` and return a graceful error string (not a 500) when the key is missing.

### Settings & User model

The `User` model in Prisma stores `hevy_api_key` and `openai_api_key`. The app is single-user; `settings.get.ts` and `settings.post.ts` always use `findFirst()` / `create()` with no user auth. Keys are masked before being returned to the frontend (`maskKey` in `settings.get.ts`). The POST endpoint skips updating a field if the submitted value contains `••••` (i.e., the masked placeholder was not changed).

### Mesocycles

Only one mesocycle can be `active` at a time. Both `index.post.ts` (create) and `[id].patch.ts` (update) automatically `updateMany` all other active mesocycles to `paused` before activating a new one.

### Frontend patterns

- Data fetching uses Nuxt's `useFetch()` for SSR-compatible calls; mutations use `$fetch()` directly.
- No global state store (no Pinia). Each page manages its own local `ref()` state.
- Markdown from AI responses is rendered via `v-html` with a lightweight regex-based formatter in `ChatMessageBubble.vue` (component) and an inline `renderMarkdown()` helper in the workout detail page.
- The `CalendarGrid` component emits `select-date` upward; the parent `calendar.vue` page owns the selected date state.
