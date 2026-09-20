# Realm Labs CRM

Operator CRM for Realm Labs (`realmlabscrm.com`). Login is Google Workspace on `realmlabs.co`.

Product rules live in `.cursor/rules/realm-labs-crm.mdc`. Domain behavior (routing, scoring, suppression, send) lives in `packages/contracts` — that package is the executable spec. Do not add a feature that is not in those two places.

## Layout

| Path | Role |
|------|------|
| `apps/web` | Next.js UI (boards, people, settings) |
| `apps/api` | Fastify `/api/*`, OAuth, enqueue |
| `apps/worker` | BullMQ: Gmail/Calendar sync, score, campaign drain |
| `packages/contracts` | Zod schemas and pure logic |
| `packages/db` | Drizzle schema and migrations |

## Local

Postgres 16 on `127.0.0.1:5433`, Redis on `6379`:

```bash
docker compose up -d
cp .env.example .env
# Set SESSION_SECRET (≥32 chars), TOKEN_ENCRYPTION_KEY and EMAIL_HASH_KEY
# (each 64 hex chars). Never rotate EMAIL_HASH_KEY once suppressions exist.
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Web is `http://localhost:3000`, API `http://localhost:3001`. Fill Google OAuth from `.env.example` names; mailbox connect reuses `GOOGLE_REDIRECT_URI`.

```bash
pnpm test
pnpm lint
```

Tests cover routing, report math, email matching, scoring math, suppression precedence, unsubscribe GET-never-writes, and recruiter source/kind planners. Do not add UI tests.

## Invariants that must not drift

- Operator mailboxes: `nathan@realmlabs.co` (`personal`), `stefano@realmlabs.co` (`partner`). No `application@` inbox.
- Campaign From is `@mail.realmlabs.co` only (not a CRM user). Reply-To is the contact owner, or Stefano if none. Enqueue is not send: drain claims `queued → sending` before Postmark. `POSTMARK_SEND_ENABLED` stays false until verify-webhook is 200 and `ALERT_WEBHOOK_URL` pages. Applicant mail is at most two stage touches per tag start; empty templates skip.
- Suppression is HMAC of `canonicalEmail`, tombstone before purge. Consent (`inquiry` / `newsletter` / `stay_in_touch`) is a separate subsystem.
- Kickbox is new website form intake only.
- Contacts may be `contact` or `recruiter` (`quant_analyst` | `quant_developer`). Recruiter people are lead sources, not campaign leads: skip scoring, campaign tags, and outbound send. Source `recruiter` points at a recruiter person id. A recruiter cannot themselves have source `recruiter`.
- Timestamps UTC in the database, displayed `America/Los_Angeles`. Keyboard-first boards and lists (`j`/`k`, enter, esc).

Env names and comments: `.env.example`. Production is Fly (`fly.web.toml`, `fly.api.toml`, `fly.worker.toml`, `fly.backup.toml`) or `docker-compose.prod.yml`.
