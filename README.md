# HevyTracker

**A self-hosted training and nutrition intelligence platform for strength athletes.**

HevyTracker imports workout and body-measurement history from [Hevy](https://www.hevyapp.com/), turns raw logs into auditable progression and fatigue signals, supports structured macrocycle and mesocycle planning, and provides an AI coach grounded in the athlete's own data.

This is a full-stack portfolio project focused on data integrity, explainable analytics, useful AI integration, and real-world asynchronous workflows. The interface is currently available in Spanish.

> HevyTracker is an independent project and is not affiliated with, endorsed by, or sponsored by Hevy.

## Highlights

- **Training analytics:** exercise progression, estimated 1RM, personal records, weekly muscle-group volume, adherence, and fatigue or plateau alerts.
- **Structured planning:** macrocycles, mesocycles, weekly prescriptions, deloads, target RIR, progression schemes, suggested loads, and Hevy routine export.
- **Nutrition planning:** a user-owned food catalogue, per-weekday meal plans, macro and micronutrient coverage, immutable published versions, trends, and PDF export.
- **Data-aware AI coach:** persistent streamed conversations, 18 server-side tools, workout and diet analysis, weekly evaluations, and validated mesocycle generation.
- **Body and recovery tracking:** weight, body composition, circumferences, HRV, resting heart rate, rolling baselines, and historical charts.
- **Operational tooling:** persisted background jobs, scheduled synchronization, read-only database exploration, and detailed AI token, cache, latency, and cost analytics.
- **Multi-user isolation:** authenticated resources are scoped by both owner and resource ID, with administrative features protected separately.

## Product Tour

### Training

The dashboard combines the active training block, next planned session, weekly adherence, recent workouts, body-weight trend, and actionable alerts. Athletes can inspect individual workouts, browse a calendar, track progression for each exercise, compare effective weekly sets against volume landmarks, and review stored personal records.

Workout calculations are centralized in a pure domain module. Working volume excludes warm-up sets, total tonnage includes them, RPE averages use working sets only, and estimated 1RM is intentionally omitted beyond the supported rep range rather than presenting unreliable precision.

### Planning

Plans are stored as structured weeks, sessions, and exercises instead of prose. This allows HevyTracker to compare prescriptions against completed work, suggest loads from recent performance, account for deload overrides, and determine the next session from exercise overlap rather than fragile workout names.

Plans can be authored manually or generated with AI. Generated plans must pass deterministic validation, and exercise IDs are accepted only when they came from the application's catalogue search tools.

### Nutrition

Each weekday has an independent meal plan and optional targets. Foods can be entered manually or imported from external food-information sources. Missing micronutrients remain unknown rather than being converted to zero, and partial totals retain coverage information.

#### Food Information Sources

- [Open Food Facts](https://es.openfoodfacts.org/) provides food name search and barcode imports without requiring an API key. When a product is found through search, HevyTracker retrieves the complete product record before importing it so that available micronutrients are preserved.
- [Nutriinfo](https://nutriinfo.es/) provides food information for barcode imports when configured with a Nutriinfo API key. Its API is subject to a limit of 20 requests per hour and is not used for name search.
- Both sources are integrated into the food catalogue and their data is normalized to values per 100 g. If a source does not provide usable energy data, the food can be added manually; unavailable nutrients remain unknown instead of being treated as zero.

Diet editing follows a draft/publish workflow. Published versions and nutrient snapshots are immutable, preserving an accurate historical record even when catalogue foods change later.

### AI Coach

The AI layer supports OpenRouter by default and direct OpenAI as an alternative. The coach streams responses, persists conversations, selects only the relevant tools for each question, and retrieves additional athlete data on demand. Trusted user identity always comes from the server, never from model-generated tool arguments.

Prompts, typed payloads, compact model-facing serialization, provider adapters, and domain queries are kept separate. Usage is recorded across every tool round, including input, output, reasoning, cache read/write tokens, latency, and estimated cost.

## Architecture

```text
Browser
  |
  | Vue 3 pages, components, composables, SSR reads and SSE chat
  v
Nuxt 4 / Nitro
  |
  | Authenticated API routes and domain services
  +---- Hevy API
  +---- Open Food Facts / Nutriinfo
  +---- OpenRouter / OpenAI
  |
  v
Prisma ORM
  |
  v
SQLite
```

| Layer | Technology |
| --- | --- |
| Frontend | Nuxt 4, Vue 3, TypeScript, Tailwind CSS |
| Backend | Nitro server routes and domain services |
| Persistence | Prisma 5, SQLite, committed migrations |
| Authentication | Encrypted cookie sessions, bcrypt password hashing |
| AI | Provider-neutral adapter, OpenRouter/OpenAI, SSE streaming, tool calling |
| Integrations | Hevy API, Open Food Facts, Nutriinfo |
| Documents | `pdf-lib` |
| Operations | Docker, persisted maintenance jobs, scheduled sync |

### Project Structure

```text
app/
  assets/          Design tokens and global styles
  components/      UI primitives and domain components
  composables/     Shared client state and background-job polling
  pages/           File-based application routes
server/
  api/             Authenticated Nitro endpoints
  plugins/         Scheduled synchronization
  routes/auth/     Login, registration, logout and session routes
  utils/           Training, nutrition, AI and infrastructure services
prisma/
  migrations/      Database migration history
  schema.prisma    Relational data model
scripts/           Database-backed smoke suites and validation utilities
```

## Engineering Decisions

- **Normalized analytics:** imported JSON is retained as a historical display snapshot, while aggregate queries use normalized workout, exercise, and set rows.
- **Stable exercise identity:** catalogue exercises are matched by Hevy template ID, not translated names. Localized aliases are stored per user.
- **Local calendar semantics:** all training weeks use shared Monday-to-Sunday local-time helpers to avoid UTC date drift.
- **Explainable alerts:** plateau, fatigue, undertraining, and deload detectors store the numerical evidence behind each verdict.
- **Historical fidelity:** past AI analyses are built with profile, training, and diet data that existed at that point in time.
- **Compact AI context:** typed domain payloads are serialized into compact model-facing tables, reducing token usage without leaking model concerns into domain logic.
- **Safe structured generation:** model JSON is parsed defensively and generated plans pass deterministic validation before persistence.
- **Asynchronous long-running work:** synchronization, rebuilds, and plan generation use persisted pollable jobs instead of holding HTTP requests open.
- **Accessible data visualization:** charts use semantic theme tokens, legends, and table alternatives rather than relying on color or hover alone.

## Getting Started

### Prerequisites

- Node.js 20
- npm
- A Hevy API key for workout synchronization, entered per user in **Settings**
- An OpenRouter API key for AI features, or an OpenAI key if the provider is changed in `server/utils/ai-config.ts`

### Installation

```bash
git clone https://github.com/Javiito32/hevy-tracker.git
cd hevy-tracker
npm ci
cp .env.example .env
```

Set at least the database URL and a random session password of 32 or more characters:

```dotenv
DATABASE_URL="file:./prisma/dev.db"
NUXT_SESSION_PASSWORD="replace-with-a-long-random-secret"
```

Apply the database migrations and generate the Prisma client:

```bash
npx prisma migrate dev
npx prisma generate
```

Start the development server at [http://localhost:3000](http://localhost:3000):

```bash
npm run dev
```

Register the first local account through the UI. On an empty database, the first account becomes the administrator.

### Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | SQLite connection URL |
| `NUXT_SESSION_PASSWORD` | Yes | Session encryption secret, at least 32 characters |
| `OPENROUTER_API_KEY` | For local AI | Default AI provider key |
| `NUXT_OPENROUTER_API_KEY` | For deployed AI | Runtime OpenRouter key used by Nuxt |
| `OPENAI_API_KEY` | Optional | Local key when using the direct OpenAI provider |
| `NUXT_OPENAI_API_KEY` | Optional | Deployed direct OpenAI key |
| `NUTRIINFO_API_KEY` | Optional | Local barcode fallback key |
| `NUXT_NUTRIINFO_API_KEY` | Optional | Deployed barcode fallback key |

Open Food Facts does not require an API key. The Hevy key is user-specific and is stored from the Settings page, not in the environment file.

## Verification

The project uses database-backed smoke suites. They create throwaway users in the configured SQLite database and clean them up after execution.

```bash
# Run all smoke suites
DATABASE_URL="file:./prisma/dev.db" npm run smoke

# Run an individual domain suite
DATABASE_URL="file:./prisma/dev.db" npm run smoke:training
DATABASE_URL="file:./prisma/dev.db" npm run smoke:plan
DATABASE_URL="file:./prisma/dev.db" npm run smoke:nutrition
DATABASE_URL="file:./prisma/dev.db" npm run smoke:ai

# Production compile check
npm run build
```

The AI smoke suite uses a fake provider and does not make paid model calls.

## Deployment Notes

A production `Dockerfile` and a Compose configuration are included. The container applies pending Prisma migrations before starting the Nuxt server, and the Compose setup persists SQLite data under `db_data/`.

Before exposing an instance publicly:

- Set a unique `NUXT_SESSION_PASSWORD`; never use the development fallback.
- Create the administrator in a controlled environment before opening registration. The first account on an empty database receives admin access.
- Add invitation or registration controls and AI spending limits if the service is internet-facing.
- Protect and back up the SQLite volume. It contains account data, health metrics, training history, AI conversations, and per-user Hevy credentials.
- Put the application behind HTTPS and configure the reverse proxy or publish port `3000` explicitly; the included Compose file does not publish a host port.
- Review third-party API terms before operating a public hosted service.

## Current Scope

- The UI is Spanish-first; internationalization is not implemented yet.
- SQLite is a deliberate fit for a small self-hosted deployment, not a horizontally scaled architecture.
- AI features require a configured provider and may incur usage costs.
- The repository currently relies on smoke suites and production builds rather than a unit-test, lint, or type-check pipeline.

## License

No open-source license has been selected yet. All rights are reserved unless a license is added.
