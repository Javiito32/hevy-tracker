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
  utils/        ← Shared server utilities (prisma, hevy-client, openfoodfacts-client, ai-provider, ai-service, ai-chat, ai-prompts, ai-context, ai-payload, ai-tools, ai-config, ai-usage, conversations, volume-calculator, nutrition-calculator, diet-service, food-input)
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

- `server/utils/ai-provider.ts` — neutral `AiProvider` interface (`generate(messages, options)` plus `generateStream(...)` yielding `StreamEvent`s) with neutral `ChatMessage` / `ToolDefinition` / `ToolCall` / `TokenUsage` types, plus an OpenAI-compatible adapter that serves two providers: **`openrouter`** (default — routes to any vendor's model via OpenRouter slugs like `anthropic/claude-sonnet-5`; key: `OPENROUTER_API_KEY`) and **`openai`** (direct; key: `OPENAI_API_KEY`). Swapping vendors/models = changing `AI_PROVIDER`/`AI_MODEL` in `ai-config.ts`.
- `server/utils/ai-config.ts` — all tunables: `AI_PROVIDER`, `AI_MODEL` (OpenRouter slug when provider is openrouter), `AI_REASONING_EFFORT` (null for models without it), `MAX_TOOL_ITERATIONS`, `CHAT_HISTORY_WINDOW`, `MAX_OUTPUT_TOKENS` per task type.
- `server/utils/ai-service.ts` — `runAiTask()` shared runner for the stateless endpoints (builds messages, calls the provider, persists usage to `AiConversation`/`AiMessage`) + `aiKeysFromConfig()` helper.
- `server/utils/ai-prompts.ts` — all stateless system prompts, built from a shared persona + grounding rules + task instructions.

`createAiProvider()` throws a 503 when the active provider's API key is missing or unconfigured — endpoints no longer gate individually.

#### Token accounting

Every provider call reports a `TokenUsage` (`{ inputTokens, outputTokens, totalTokens }`), read from the OpenAI-compatible `usage` block (`prompt_tokens` / `completion_tokens` / `total_tokens`). The in/out split is what makes cost computable — output tokens are priced several times higher than input, so a single total can't be priced.

- `totalTokens` is stored as its own field rather than derived: providers may bill extras (reasoning tokens) that land in neither bucket.
- A chat turn can chain several billed calls (one per tool-call round), so `runChatTurn` **sums** usage across iterations via `addUsage()` — the last call's usage would undercount.
- Persisted to `AiMessage` as `tokens_used` / `input_tokens` / `output_tokens`.
- Messages written before the `20260806141206_ai_usage_analytics` migration have `tokens_used` only; `input_tokens` / `output_tokens` are null. Those rows are reported as "sin desglose" and **excluded from cost**, never estimated with an assumed ratio.

#### Two architectural patterns

**1. Chat** — conversational, stateful across turns. Two endpoints over one shared runner:
- `POST /api/chat/stream` — SSE, what the UI uses. Frames are JSON on a `data:` line: `{type:'tool',name}`, `{type:'delta',text}`, `{type:'done',conversationId,model,title,tokens,inputTokens,outputTokens,toolsInvoked}`, `{type:'error',message}`. `EventSource` can't POST, so the client reads it off `fetch()`'s body reader.
- `POST /api/chat` — buffered, returns the whole reply. Client fallback and for non-SSE callers.
- Both delegate to `runChatTurn()` in `server/utils/ai-chat.ts`, which owns the tool-call loop, persistence and `updated_at`. Don't duplicate turn logic in an endpoint — the two would drift.
- Takes `{ message, conversationId }`. Conversation history is loaded **server-side from the DB** (last `CHAT_HISTORY_WINDOW = 8` messages); the client never sends history.
- `conversationId: null` always **creates a new conversation**. It must never fall back to an existing one — resolving null to the user's oldest conversation is the bug this design replaced.
- System prompt built by `buildLeanSystemPrompt` in `server/utils/ai-context.ts`: athlete profile + active mesocycle + last 3 workout summaries embedded as formatted text.
- Uses tool calling (`server/utils/ai-tools.ts`) so the model fetches additional data on demand. Tool-call loop capped at `MAX_TOOL_ITERATIONS = 5`; on the final iteration `toolChoice: 'none'` forces the model to answer with the data gathered so far.
- Chat turns persisted to `AiConversation` / `AiMessage`.

#### Conversations

`AiConversation.context_type` is the dividing line: `'general'` rows are chat threads (`CHAT_CONTEXT_TYPE` in `server/utils/conversations.ts`), every other value is written by `recordAiInteraction()` — one row per analysis/generation, kept only for the admin usage stats. Chat endpoints filter on it so analysis rows never surface in the UI. Human labels for each value live in `TASK_LABELS` (`server/utils/ai-usage.ts`) — add one there when introducing a new context type.

- `updated_at` is written **explicitly** at the end of each turn, not via `@updatedAt`: Prisma only refreshes that on writes to the row itself, so appending a message would leave it stale — exactly the field the ordering depends on.
- `title` is derived from the first user message by `deriveConversationTitle()`, trimmed to 60 chars on a word boundary. No extra model call.
- `GET /api/conversations` lists threads ordered by `updated_at desc` (so reopening `/chat` resumes the last one you actually talked to) and filters out empty rows. `[id].get` loads the transcript newest-first with a `take`, then reverses — querying ascending with a take would return the *oldest* 100 messages.
- `[id].get` / `[id].patch` / `[id].delete` all resolve ownership through `requireOwnedConversation()`, which 404s (not 403s) on someone else's id. Messages cascade on delete.
- There is no "create empty conversation" endpoint: the row is created with the first message, so abandoned drafts don't accumulate.

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
| `POST /api/nutrition/ai-analyze` | Diet analysis | `NutritionAnalysisPayload` |
| `POST /api/nutrition/ai-targets` | Nutrition targets (JSON mode) | `NutritionTargetsPayload` |

`ai-generate` and `ai-targets` pass `jsonMode: true` (mapped to the vendor's JSON mode by the adapter) and expects the model to return a structured mesocycle plan. All other stateless endpoints return Markdown.

#### `server/utils/ai-payload.ts`

Shared builders used by the stateless endpoints:

- `buildAthleteProfile(userId, { includeInjuries? })` — fetches user profile, weekly weight history (last 5 weeks), and body measurement snapshots (current, ~1 month ago, ~3 months ago).
- `buildWorkoutData(w, includeExercises)` — maps a DB workout row to a typed `Workout` object. Pass `false` for summary-only (no sets detail).
- `extractCompoundLiftsData(workouts)` — returns best estimated 1RM per compound exercise across a list of workouts.
- `buildLastMesocycleSummaryData(userId)` — returns the last completed mesocycle as a structured object for use in plan feedback.

`includeInjuries: true` is only passed in `ai-generate` (injuries are a hard design constraint when building a new block).

#### `server/utils/ai-tools.ts`

13 tools available to the chat endpoint (defined provider-neutrally as `AI_TOOLS: ToolDefinition[]`):

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
| `get_diet` | A diet version: meals, foods with grams, daily totals. No args = the version in force now; `date` = the one in force that day; `version_id` = a specific one. |
| `get_diet_history` | Published diet versions with date range, change note and totals. Chain into `get_diet` for a version's meals. |
| `search_foods` | The user's food catalogue by name/brand, values per 100 g. |
| `save_user_note` | Persists a memory note about the user (`AiNote`) surfaced in future system prompts. |
| `deactivate_user_note` | Marks a saved note inactive by id. |

Tool implementations enforce `user_id` scoping — they never access another user's data. Adding new tools requires updating both `TOOL_IMPLS` and `AI_TOOLS` in `ai-tools.ts`.

### Admin panel & AI usage analytics

`/admin` (middleware `admin`) reports AI usage and cost. All endpoints gate on `requireAdmin()`.

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/ai-stats?from&to` | Aggregates for a date range: `totals`, `by_model`, `by_user`, `by_user_model`, `by_user_task`, `by_task`, `unpriced_models`, `timeline`, `month_to_date`, `top_interactions`. |
| `GET /api/admin/ai-usage?from&to&userId&model&contextType&page` | Paginated log of individual interactions (50/page, server-side pagination). |
| `GET /api/admin/ai-prices` | Configured prices + `unpriced_models` seen in use. |
| `POST /api/admin/ai-prices` | **Upsert** by model slug — one endpoint for create and edit. |
| `DELETE /api/admin/ai-prices/:id` | Routed by row **id, not model**: slugs contain `/`, which a single dynamic segment can't carry. |

`server/utils/ai-usage.ts` is the single home of range parsing, pricing and cost arithmetic (`parseRange`, `rangeFilter`, `loadPrices`, `rowCost`, `accumulate`, `groupTotals`, `toUsageRow`, `TASK_LABELS`). Three endpoints report money; a divergent formula between them would show three different totals for the same period. Put new cost logic here, not in an endpoint.

- **Prices live in the DB** (`AiModelPrice`), not `ai-config.ts`: a vendor price change shouldn't need a deploy. Quoted **per 1M tokens**, the unit vendors publish.
- **`rowCost` returns `null`, never an estimate**, when the model is unpriced or the row predates the in/out split. Totals therefore exclude those rows and report `unpriced_count` / `no_breakdown_count` so the UI can flag a figure as partial. Don't "fill the gap" with an assumed input/output ratio — an invented number that looks authoritative is worse than a `—`.
- Aggregation is a **JS reduction over one query**, not `groupBy`: every dimension the panel needs (user, task type) lives on the parent `AiConversation`, and Prisma can't group across a relation.
- The users table (`/api/admin/users`) reports **all-time** usage; `ai-stats` is the date-scoped view.

#### The trend chart

`timeline` feeds `AiUsageTrendChart` (stacked columns, one band per bucket, split by model):

- Buckets switch from daily to **weekly** past `DAILY_BUCKET_LIMIT = 92` days — a year of daily columns is unreadable.
- `bucketKeys()` emits **every** bucket in the span including empty ones. A chart that skips quiet days compresses them away and overstates how steady the spend was.
- Bucketing uses `localDayKey` / `localWeekKey` (**local** components, not `toISOString()`): "which day did this cost land on" is a question about the admin's calendar, and UTC slicing would push evening usage into the next day.
- `series[].color_index` is the model's position in the **all-time alphabetical** model list, not its rank in range. Ranking by cost would repaint every band whenever the date filter changes, and a reader who learned "sonnet is blue" would be misled by the next range they pick.
- Models past `SERIES_LIMIT = 4` fold into one `Otros` series (colour outside the palette — it isn't an identity). Never generate more hues.
- Series colours are the **validated** dark categorical slots; they pass all six checks against this app's surface (`#0f172a`). Re-run `scripts/validate_palette.js` from the `dataviz` skill before changing any of them.
- `month_to_date` is deliberately **not** range-scoped: "what will this month cost" is a fixed question, and a projection over an arbitrary filter is meaningless.
- A near-zero bar is left visually near-invisible rather than clamped to a minimum height — clamping would put the top of the stack somewhere other than the true total on the axis. The band-wide hover target and the chart's table view carry the value instead.

### Settings & User model

The `User` model in Prisma stores `hevy_api_key`. The `OPENAI_API_KEY` is read exclusively from `.env` via `config.openaiApiKey` — it is never stored in the database. `settings.get.ts` and `settings.post.ts` handle profile and Hevy API key updates. The Hevy key is masked before being returned to the frontend (`maskKey` in `settings.get.ts`). The POST endpoint skips updating a field if the submitted value contains `••••` (i.e., the masked placeholder was not changed).

### Mesocycles

Only one mesocycle can be `active` at a time. Both `index.post.ts` (create) and `[id].patch.ts` (update) automatically `updateMany` all other active mesocycles to `paused` before activating a new one.

### Nutrition

`/nutrition` designs a diet; `/nutrition/foods` is the food catalogue; `/nutrition/history` is the change log.

**Everything is per 100 g.** `Food` stores 16 nutrients (kcal + 3 macros + 12 micros) on that basis — no `_100g` suffix on the field names, the basis is documented on the model. `kcal` and the macros are non-null; the 12 micros are nullable, where **null means unknown, never zero**.

**History is immutable, and that is the point.** `DietItem` stores `food_name` + `nutrients_snapshot` (JSON of the food's per-100 g values at insert time), so editing or deleting a `Food` can never rewrite what a past version said. `food_id` is `SetNull` for exactly this reason, which is also why `Food` needs no soft-delete flag.

- `DietPlan` (one `active` per user, `updateMany` demotion like `Mesocycle`) → `DietVersion` → `DietMeal` → `DietItem`.
- **Only a `draft` version is mutable.** `assertDraft` 409s on anything else; there is no path that edits a published version. "✎ Editar dieta" calls `POST /api/nutrition/plans/:id/draft` → `ensureDraft()`, which deep-clones the active version (snapshots included) and is idempotent. Publishing sets the new version's `start_date` and the old one's `end_date` to today.
- Ranges are **half-open** `[start_date, end_date)`: publish-and-replace on the same day leaves a version covering no days, and "which diet on date D" stays unambiguous. `resolveVersion({date})` is what the AI's `get_diet` uses.
- Targets live on `DietVersion`, not `DietPlan` — otherwise the history couldn't say what the athlete was aiming for at the time.
- `DietMeal.day_type` (`all | training | rest`) lets a plan differ between training and rest days; totals are computed per day type.

**Totals are denormalised and must never drift.** `DietVersion` carries 4 hot columns (`total_kcal` + macros) plus `totals_json` with all 16 nutrients per day type — the same split as `Workout.total_volume` vs `exercises_summary`, so the history list and the chart never parse JSON. **Every write path goes through `recalcVersionTotals()` in `server/utils/diet-service.ts`**; that uniformity is the only thing keeping the columns true. Put new diet mutation logic there, not in an endpoint.

**Partial totals ship with their coverage.** `sumNutrients` returns the sum of whatever foods have the data and is null only when none do; `sumCoverage` records `{known, total}` per nutrient. Returning null as soon as one food lacked a micro was tried and is wrong — food databases carry micros for a minority of products, so one gap would blank the nutrient for the whole diet. A partial figure is a legitimate lower bound; what makes it honest is that it is **never shipped bare**: the UI prefixes it with `≥`, and the AI payload/tool add `micronutrients_partial` saying how many foods backed it. Never present a partial total as complete, and never fill a gap with 0.

**Open Food Facts** (`server/utils/openfoodfacts-client.ts`, no API key, descriptive `User-Agent` required):
- An unknown barcode returns **HTTP 200 with `{"status":0}`** — a try/catch on the status code never fires, so `fetchOffProduct` checks `status === 1` and returns `null`.
- Search (`search.openfoodfacts.org/search`) returns **kcal and macros only, no micronutrients**, so importing always re-fetches the full product by code. Never import from a search payload.
- `<nutrient>_100g` is **always grams**, whatever the sibling `_unit` says (verified: almonds report `calcium_100g: 0.2367` = 237 mg with `calcium_unit: 'g'`). Applying `_unit` to `_100g` would be a 1000× error; `_unit` is consulted only on the `_value` fallback path.
- Imports are **rejected, not clamped**, when energy is unresolvable or a value is implausible (`NUTRIENT_MAX`) — contributor data really does contain 85 g of sodium per 100 g. A clamped number still reads as authoritative while being wrong.
- OFF rate-limits search (~10 req/min per IP): the client caches for 10 min and the UI debounces 500 ms. Never call it in a loop.
- Camera scanning needs `BarcodeDetector` + a secure context, which plain-HTTP LAN deployments don't have — **manual code entry is the primary path**, the camera is progressive enhancement.

### Frontend patterns

- Data fetching uses Nuxt's `useFetch()` for SSR-compatible calls; mutations use `$fetch()` directly.
- No global state store (no Pinia). Each page manages its own local `ref()` state.
- Token counts, costs and dates in the admin panel are formatted with the shared helpers in `app/utils/format.ts` (auto-imported): `formatTokens`, `formatCost`, `formatDateTime`, `formatDateShort`, `NO_VALUE`. Costs use 4 decimals below a cent — 2 would render most per-interaction rows as `0,00 $`. A value that can't be computed renders as `NO_VALUE` (`—`), never `0`.
- Nutrition components live in `app/components/nutrition/`; shared labels, units and formatters are in `app/utils/nutrition.ts` (auto-imported), which mirrors the label/unit tables in `server/utils/nutrition-calculator.ts` — keep the two in sync. A nutrient with no data renders as `NO_VALUE`, never `0`.
- Admin analytics components live in `app/components/admin/` (`AiRangeFilter`, `AiRunRateCard`, `AiUsageTrendChart`, `AiModelPricesCard`, `AiUsageByModelCard`, `AiUsageByUserCard`, `AiTopInteractionsCard`, `AiUsageLogCard`); `admin/index.vue` is the orchestrator and owns the selected date range, mirroring how `calendar.vue` owns the date `CalendarGrid` emits.
- Charts are hand-rolled inline SVG (no chart library) — `AiUsageTrendChart` and `charts/LineChart.vue`. Conventions: hairline **solid** gridlines (`#1e293b`) and axis text `#64748b`, marks capped at 24px with a 2px surface gap between stacked segments, a legend whenever there are ≥2 series, and a table view so no value is reachable only by hovering. Load the `dataviz` skill before adding or restyling one.
- Child components call `useFetch()` **without `await`** — a top-level await makes the component async and forces a Suspense boundary. Nuxt resolves pending `useFetch` calls before SSR renders either way.
- Markdown from AI responses is rendered via `v-html` with the shared `renderMarkdown()` in `app/utils/markdown.ts` (auto-imported). It is line-based, escapes HTML first, and handles headings, both list types, tables, code, quotes and rules. Use it rather than adding another local regex chain — it replaced four divergent copies.
- The `CalendarGrid` component emits `select-date` upward; the parent `calendar.vue` page owns the selected date state.
