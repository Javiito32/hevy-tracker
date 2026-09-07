# Repository Guide

`README.md` is still the Nuxt starter and is not authoritative. Use the executable config and the targeted notes below; `CLAUDE.md` contains deeper rationale for these invariants.

## Setup And Verification

- Use npm and the committed `package-lock.json`; production builds on Node 20 Alpine. Install with `npm ci`.
- Copy `.env.example` to `.env`. SQLite requires `DATABASE_URL` (normally `file:./prisma/dev.db`) and sessions require a 32+ character `NUXT_SESSION_PASSWORD`. The Hevy key is per-user data entered in Settings, not an environment variable.
- OpenRouter is the default AI provider (`server/utils/ai-config.ts`); use `OPENROUTER_API_KEY` locally and `NUXT_OPENROUTER_API_KEY` in deployed Nuxt runtime config. OpenAI is only needed when that provider is selected. Nutriinfo has the same plain/`NUXT_` local/runtime split.
- `npm run dev` starts Nuxt on port 3000; `npm run build` is the production compile check. There are no configured lint, formatter, typecheck, or unit-test scripts.
- Smoke suites use the real SQLite database, create throwaway users, and clean up. Set the URL explicitly: `DATABASE_URL="file:./prisma/dev.db" npm run smoke`. Focus with `smoke:training`, `smoke:migrations`, `smoke:plan`, `smoke:nutrition`, or `smoke:ai`; the AI suite uses a fake provider and makes no paid model calls.
- Run the closest smoke suite plus `npm run build`. Run `npm run palette` whenever chart-series colors change. `npm run ai:budgets` reports production usage distributions; it is not a test.
- After schema changes use `npx prisma migrate dev --name <name>` and `npx prisma generate`. Production startup runs `prisma migrate deploy`; do not substitute `db push` for a committed migration. `npm run db:reset` destroys and reseeds the configured database.

## Application Shape

- This is one Nuxt 4 application using the `app/` convention: UI is under `app/`, Nitro handlers under `server/api/`, domain logic under `server/utils/`, and SQLite/Prisma under `prisma/`.
- API method and route come from the filename, e.g. `server/api/workouts/[id].get.ts` is `GET /api/workouts/:id`.
- Import the singleton from `server/utils/prisma.ts`; do not instantiate `PrismaClient` in application code. Smoke scripts are the intentional exception.
- Keep handlers thin. Shared arithmetic and mutation rules belong in the existing domain service, not in an endpoint or component.
- Scope lookups by both resource id and authenticated `user_id`. Cross-user ids should resolve as 404, not reveal that the resource exists.

## Data Invariants

- Weeks are local-time Monday through Sunday, and weekday numbers are `1 = Monday ... 7 = Sunday`. Reuse `server/utils/dates.ts`; never key local days/weeks with `toISOString()` or duplicate week arithmetic.
- `buildWorkoutMetrics()` in `server/utils/workout-metrics.ts` is the only definition of stored workout metrics. `total_volume` excludes warm-ups; `total_tonnage` includes them; RPE averages exclude warm-ups. Drop sets and failure sets are working sets. e1RM is not reported above the 12-rep/RIR table cap.
- Aggregate workout queries use normalized `WorkoutExercise`/`ExerciseSet` rows. `Workout.exercises_summary` is a JSON display snapshot and must be parsed before use; do not make it a new aggregate source.
- Match catalogue exercises by `exercise_template_id`, not translated names. Names differ between Hevy's English catalogue and localized workout history; aliases are per user. `writeWorkoutExercises()` replaces a workout's normalized rows rather than merging them.
- All structured plan writes go through `savePlan()` in `server/utils/plan-service.ts`; it replaces the plan and re-derives `split_description` and session targets. Generated plans must pass `validateGeneratedMesocycle()` before persistence.
- All diet writes go through `server/utils/diet-service.ts`: only drafts are mutable and every mutation must recalculate denormalized totals. Published versions and `DietItem.nutrients_snapshot` are historical snapshots, not live catalogue views.
- Nutrition values are per 100 g. Missing micronutrients are `null`, never zero; partial totals must retain coverage and be presented as lower bounds. Diets are independent per weekday, and hot totals are the mean of days containing food, not a weekly sum or a seven-day average.
- Background sync, maintenance, and AI plan generation use `MaintenanceJob` plus polling. Do not move long jobs inline. Database-writing jobs reuse a running job by default; argument-dependent generation explicitly does not.

## AI Boundaries

- Endpoints must use the neutral provider in `ai-provider.ts`; provider/model/reasoning/token settings live in `ai-config.ts`, and stateless tasks run through `runAiTask()`.
- Typed AI payloads are built in `ai-payload.ts` and compact model-facing text is rendered only in `ai-serialize.ts`. If a serializer section heading changes, update the prompt that references it.
- Chat behavior, history, tool loops, persistence, and streaming are shared in `ai-chat.ts`; do not fork logic between buffered and SSE endpoints. Tool implementations receive trusted `userId` from the runner, never from model arguments.
- Parse structured model output with `parseAiJson()`, not `JSON.parse()`. Plan generation also requires deterministic validation and only accepts exercise ids returned by its catalogue search.
- Preserve provider reasoning blocks verbatim across tool rounds and sum token usage across every billed round. Chat prompt caching covers only the invariant prefix; athlete data is dynamic and must remain after the cache breakpoint.

## Frontend Conventions

- Preserve the achromatic semantic-token system in `app/assets/css/main.css` and `tailwind.config.ts`. Use classes such as `bg-surface`, `text-ink-2`, and verdict/data-series tokens; do not add palette utilities (`slate-*`, `indigo-*`, etc.) or `dark:` variants.
- Compose primitives from `app/components/ui/`. Figures use `font-data`; verdict color must be accompanied by text/glyph/position. Shared status/delta styles live in `app/utils/theme.ts`.
- Use `useFetch()` for SSR reads without top-level `await`; use `$fetch()` for mutations. Use `useToast()` rather than `alert()`.
- Render AI Markdown only with `renderMarkdown()` and put `class="md"` on the `v-html` container; the renderer escapes HTML and styling belongs in the shared CSS block.
- Client nutrition labels/units in `app/utils/nutrition.ts` intentionally mirror `server/utils/nutrition-calculator.ts`; update both lists together.
- Charts are inline SVG and categorical colors come from `app/utils/series.ts`. Do not introduce dual axes; provide a legend for multiple series and a table view for values otherwise available only on hover.

## External API Traps

- Hevy workout/body pagination is capped at 10, so bootstrap sync is intentionally asynchronous. Detector failure must not make imported workout data fail.
- Open Food Facts returns HTTP 200 with `status: 0` for an unknown barcode. Barcode preview and import must share `barcode-lookup.ts`; search payloads are not complete enough to import without a product refetch.
- Nutriinfo is barcode fallback only and is limited to 20 requests/hour. Keep its one-hour hit/miss cache, never use it for typeahead, and do not cache auth, network, or rate-limit failures as misses.
