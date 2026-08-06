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
OPENROUTER_API_KEY=your_openrouter_api_key_here   # default AI provider
OPENAI_API_KEY=your_openai_api_key_here           # only if AI_PROVIDER=openai
```

Keys are exposed to server-side code via `useRuntimeConfig()` as `config.hevyApiKey`, `config.openrouterApiKey`, and `config.openaiApiKey`. They are declared in `nuxt.config.ts` under `runtimeConfig` (server-only, not `public`).

## Architecture

### Directory structure

```
app/            ← Nuxt frontend (pages, components, layouts)
server/
  api/          ← Nitro API route handlers (file = route)
  utils/        ← Shared server utilities (prisma, hevy-client, ai-provider, ai-service, ai-prompts, ai-context, ai-payload, ai-tools, ai-config, volume-calculator)
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

The AI subsystem is **provider-agnostic**. No endpoint imports a vendor SDK directly:

- `server/utils/ai-provider.ts` — neutral `AiProvider` interface (`generate(messages, options)`) with neutral `ChatMessage` / `ToolDefinition` / `ToolCall` types, plus an OpenAI-compatible adapter that serves two providers: **`openrouter`** (default — routes to any vendor's model via OpenRouter slugs like `anthropic/claude-sonnet-5`; key: `OPENROUTER_API_KEY`) and **`openai`** (direct; key: `OPENAI_API_KEY`). Swapping vendors/models = changing `AI_PROVIDER`/`AI_MODEL` in `ai-config.ts`.
- `server/utils/ai-config.ts` — all tunables: `AI_PROVIDER`, `AI_MODEL` (OpenRouter slug when provider is openrouter), `AI_REASONING_EFFORT` (null for models without it), `MAX_TOOL_ITERATIONS`, `CHAT_HISTORY_WINDOW`, `MAX_OUTPUT_TOKENS` per task type.
- `server/utils/ai-service.ts` — `runAiTask()` shared runner for the stateless endpoints (builds messages, calls the provider, persists usage to `AiConversation`/`AiMessage`) + `aiKeysFromConfig()` helper.
- `server/utils/ai-prompts.ts` — all stateless system prompts, built from a shared persona + grounding rules + task instructions.

`createAiProvider()` throws a 503 when the active provider's API key is missing or unconfigured — endpoints no longer gate individually.

#### Two architectural patterns

**1. Chat** (`POST /api/chat`) — conversational, stateful across turns.
- Takes `{ message, conversationId }`. Conversation history is loaded **server-side from the DB** (last `CHAT_HISTORY_WINDOW = 8` messages); the client never sends history.
- System prompt built by `buildLeanSystemPrompt` in `server/utils/ai-context.ts`: athlete profile + active mesocycle + last 3 workout summaries embedded as formatted text.
- Uses tool calling (`server/utils/ai-tools.ts`) so the model fetches additional data on demand. Tool-call loop capped at `MAX_TOOL_ITERATIONS = 5`; on the final iteration `toolChoice: 'none'` forces the model to answer with the data gathered so far.
- Chat turns persisted to `AiConversation` / `AiMessage`.

**2. Stateless analysis/generation endpoints** — one-shot, no conversation history, all via `runAiTask()`.
- System message = persona + instructions only (no data), from `ai-prompts.ts`.
- User message = `JSON.stringify(payload, null, 2)` with all structured data.
- Payload types and builder functions live in `server/utils/ai-payload.ts`.

| Endpoint | Task type | Payload type |
|---|---|---|
| `POST /api/workouts/:id/analyze` | Workout analysis | `WorkoutAnalysisPayload` |
| `POST /api/mesocycles/:id/evaluate` | Weekly evaluation | `WeekEvaluationPayload` |
| `POST /api/mesocycles/:id/final-summary` | Mesocycle final summary | `FinalSummaryPayload` |
| `POST /api/mesocycles/ai-feedback` | Plan feedback | `MesocycleFeedbackPayload` |
| `POST /api/mesocycles/ai-generate` | Mesocycle generation | `MesocycleGeneratePayload` |

`ai-generate` passes `jsonMode: true` (mapped to the vendor's JSON mode by the adapter) and expects the model to return a structured mesocycle plan. All other stateless endpoints return Markdown.

#### `server/utils/ai-payload.ts`

Shared builders used by the stateless endpoints:

- `buildAthleteProfile(userId, { includeInjuries? })` — fetches user profile, weekly weight history (last 5 weeks), and body measurement snapshots (current, ~1 month ago, ~3 months ago).
- `buildWorkoutData(w, includeExercises)` — maps a DB workout row to a typed `Workout` object. Pass `false` for summary-only (no sets detail).
- `extractCompoundLiftsData(workouts)` — returns best estimated 1RM per compound exercise across a list of workouts.
- `buildLastMesocycleSummaryData(userId)` — returns the last completed mesocycle as a structured object for use in plan feedback.

`includeInjuries: true` is only passed in `ai-generate` (injuries are a hard design constraint when building a new block).

#### `server/utils/ai-tools.ts`

10 tools available to the chat endpoint (defined provider-neutrally as `AI_TOOLS: ToolDefinition[]`):

| Tool | Returns |
|---|---|
| `get_workouts_in_range` | Workouts in date range. Summary includes exercise names, sets and volume per exercise (max 40 workouts). Full adds all sets with weight/reps/RPE (max 12 workouts). Truncation is reported to the model with a `truncated` flag. |
| `get_workout_detail` | Full detail of a single workout by `workout_id` or `date`. |
| `list_exercises` | All exercises ever logged: name, type, session count, last date, best 1RM. Use before `get_exercise_progression` when the exact name is unknown. |
| `get_exercise_progression` | Per-session history for one exercise: 1RM, total volume, top set. Prefers exact name matches; substring fallback returns `matched_exercises` and a warning if several distinct exercises matched. |
| `get_body_metrics_range` | All body metrics in a date range: weight, body fat %, lean mass, all circumferences (bilateral left/right for biceps flexed/relaxed, forearms, thighs, calves), HRV, resting HR. Only non-null fields are emitted. |
| `get_mesocycle_evaluations` | Weekly evaluations of a mesocycle (defaults to active). |
| `get_previous_mesocycles` | Completed/paused mesocycles with final summary. |
| `get_weekly_aggregates` | Per-week: sessions, total volume, avg RPE, and volume+sets breakdown by exercise. |
| `save_user_note` | Persists a memory note about the user (`AiNote`) surfaced in future system prompts. |
| `deactivate_user_note` | Marks a saved note inactive by id. |

Tool implementations enforce `user_id` scoping — they never access another user's data. Adding new tools requires updating both `TOOL_IMPLS` and `AI_TOOLS` in `ai-tools.ts`.

### Settings & User model

The `User` model in Prisma stores `hevy_api_key`. The `OPENAI_API_KEY` is read exclusively from `.env` via `config.openaiApiKey` — it is never stored in the database. `settings.get.ts` and `settings.post.ts` handle profile and Hevy API key updates. The Hevy key is masked before being returned to the frontend (`maskKey` in `settings.get.ts`). The POST endpoint skips updating a field if the submitted value contains `••••` (i.e., the masked placeholder was not changed).

### Mesocycles

Only one mesocycle can be `active` at a time. Both `index.post.ts` (create) and `[id].patch.ts` (update) automatically `updateMany` all other active mesocycles to `paused` before activating a new one.

### Frontend patterns

- Data fetching uses Nuxt's `useFetch()` for SSR-compatible calls; mutations use `$fetch()` directly.
- No global state store (no Pinia). Each page manages its own local `ref()` state.
- Markdown from AI responses is rendered via `v-html` with a lightweight regex-based formatter in `ChatMessageBubble.vue` (component) and an inline `renderMarkdown()` helper in the workout detail page.
- The `CalendarGrid` component emits `select-date` upward; the parent `calendar.vue` page owns the selected date state.
