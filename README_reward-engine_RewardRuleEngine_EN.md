# RewardEngine — Automated Reward Distribution Rule Engine for Shopify

> **What:** A Shopify Embedded App that listens to order webhooks, evaluates no-code reward rules, and automatically issues discount codes
> **Who:** Shopify Plus / mid-to-large merchants
> **Tech:** Remix · TypeScript · Prisma · SQLite · Polaris React · Shopify GraphQL Admin API · App Bridge

Source Code: [github.com/mer-prog/reward-engine](https://github.com/mer-prog/reward-engine)

---

## Skills Demonstrated

| Skill | Implementation |
|-------|---------------|
| Shopify Embedded App Development | End-to-end App Bridge + Polaris React admin UI, OAuth authentication, webhook registration and HMAC verification |
| Async Queue Architecture | Three-layer webhook processing: instant response + background queue + idempotency checks for zero missed orders |
| Rule Engine Design | Generic engine evaluating 4 condition types × 3 action types with AND-combined logic, validity periods, and usage limits |
| GraphQL API Integration | Automated coupon generation via `discountCodeBasicCreate` mutation with exponential backoff retry on rate limits |
| Database Design | Queue management with optimistic locking via Prisma + SQLite, relational logging, and composite unique constraints for idempotency |
| Internationalization | Custom React Context-based i18n system (EN/JA toggle) with nested JSON translation files and parameter interpolation |
| Fault Tolerance | Up to 5 automatic retries, dead-letter queue classification, and manual reprocessing from queue monitor UI |

---

## Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| Framework | Remix ^2.16.1 | SSR, routing, form handling |
| Language | TypeScript ^5.2.2 (strict mode) | Type-safe development |
| UI Library | Polaris React ^12.0.0 | Shopify admin-consistent components |
| App Bridge | @shopify/app-bridge-react ^4.1.6 | Shopify admin embedding and NavMenu |
| ORM | Prisma ^6.2.1 | Database operations and migrations |
| Database | SQLite | Local file-based database |
| Session Storage | @shopify/shopify-app-session-storage-prisma ^8.0.0 | OAuth session persistence |
| Build Tool | Vite ^6.2.2 | HMR and bundling |
| Linting | ESLint ^8.42.0 + Prettier ^3.2.4 | Code quality |
| Bot Detection | isbot ^5.1.0 | SSR streaming control |
| Scheduler | cron-job.org | 30-second interval queue processing trigger |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       Shopify Store                             │
│                    (orders/create Webhook)                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ POST /webhooks
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: Instant Response (< 1 second)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ HMAC Verify  │→│ Idempotency  │→│ Insert WebhookQueue   │ │
│  │ (App Bridge) │  │ Check         │  │ status = "pending"    │ │
│  └──────────────┘  │(shop+orderId) │  └───────────────────────┘ │
│                    └──────────────┘         │ Return 200 OK     │
└────────────────────────────────────────────┼────────────────────┘
                                             │
            ┌────────────────────────────────┘
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: Background Processing                                │
│  cron-job.org (30s interval) → POST /api/process-queue         │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Fetch       │→│ Rule         │→│ Execute Reward         │ │
│  │ pending (10) │  │ Evaluation   │  │ discountCodeBasicCreate│ │
│  └─────────────┘  │ (AND logic)  │  └────────────────────────┘ │
│         │          └──────────────┘            │                │
│         ▼                                     ▼                │
│  ┌─────────────────┐              ┌────────────────────────┐   │
│  │ Exclusive Lock  │              │ Log to RewardLog       │   │
│  │ status=processing│              │ Increment usageCount   │   │
│  └─────────────────┘              └────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: Error Handling                                       │
│  ┌──────────────────────────────────────────┐                   │
│  │ Failure → retryCount++ → status="failed" │                   │
│  │ retryCount >= 5 → status="dead"          │                   │
│  │ GraphQL THROTTLED → backoff (1s, 2s, 4s) │                   │
│  └──────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Shopify Admin (Embedded App)                                   │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Dashboard  │ │ Rule     │ │ Activity │ │ Queue Monitor    │ │
│  │ Queue Stats│ │ Create / │ │ Log      │ │ Retry Button     │ │
│  │ Rule List  │ │ Edit     │ │          │ │ Status Filters   │ │
│  └────────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### Rule Engine
Evaluates 4 condition types combined with AND logic. Each rule supports optional validity periods and usage limits. `rule-engine.server.ts` iterates through all active rules and evaluates conditions via `evaluateCondition`.

**Condition Types:**
| Condition | Evaluation Logic |
|-----------|-----------------|
| `order_total_above` | Checks if `totalPriceSet.shopMoney.amount` meets or exceeds the threshold |
| `order_count_equals` | Matches customer's cumulative order count (fetched via GraphQL API) against target |
| `order_contains_collection` | Checks if any line item's product belongs to the specified collection handle |
| `order_item_quantity_above` | Checks if total item quantity across all line items meets the threshold |

**Action Types:**
| Action | Execution |
|--------|-----------|
| `percentage_discount` | Issues a percentage-off coupon (30-day expiry, single use) |
| `fixed_discount` | Issues a fixed-amount discount coupon |
| `free_shipping` | Issues a free shipping coupon (implemented as 100% discount internally) |

### Three-Layer Webhook Processing
1. **Instant Response:** After HMAC verification, ensures idempotency via `shop + orderId` composite unique constraint, enqueues the order, and returns 200 OK immediately
2. **Background Processing:** cron-job.org calls `/api/process-queue` every 30 seconds, processing up to 10 items per batch. Optimistic locking via `updateMany` with `where: { id, status }` prevents concurrent processing
3. **Failure Recovery:** Failed items increment `retryCount`; items exceeding 5 retries transition to `dead` status. Manual reprocessing is available through the admin queue monitor

### GraphQL API Integration
`graphqlWithRetry` handles all API calls. When a `THROTTLED` error is detected, it applies exponential backoff (1s, 2s, 4s) with up to 3 retries. Discount codes are generated via the `discountCodeBasicCreate` mutation, using a rule-name prefix + random 6-character suffix.

### Internationalization (i18n)
Custom React Context-based implementation. `I18nProvider` manages locale state, and the `useTranslation` hook exposes a `t()` function. Supports nested keys (dot notation) and parameter interpolation with `{value}` syntax. Defaults to Japanese with English fallback. Users toggle between EN/JA via the `LanguageToggle` component in the top-right corner.

---

## Screen Specifications

### Dashboard (`app._index.tsx` — 267 lines)
- Queue statistics cards (4 columns): Pending / Failed / Dead / Processed in last hour
- Rule list table: Name, condition summary, action, status badge, fire count
- Toggle enable/disable and delete buttons per rule
- EmptyState when no rules exist

### Rule Creation (`app.rules.new.tsx` — 298 lines)
- Rule name input
- Conditions section: condition type select + value input, add/remove multiple conditions (AND-combined)
- Action section: action type select + value input + optional coupon title
- Options: usage limit checkbox + input, validity period checkbox + date range inputs
- Validation: submit enabled only when name, all condition values, and action value are filled

### Rule Editing (`app.rules.$id.tsx` — 342 lines)
- Same UI structure as the creation screen
- Pre-populates form fields from existing rule data via `loader`
- Includes shop ownership verification

### Activity Log (`app.activity.tsx` — 109 lines)
- Displays the 100 most recent reward issuance records
- Columns: date, customer ID, order ID, rule name, action type badge, discount code
- Joins `RewardLog` with `RewardRule` to display rule names

### Queue Monitor (`app.queue.tsx` — 227 lines)
- Status filter via ChoiceList (multi-select)
- Columns: order ID, status badge, retry count, error message, created at, processed at
- Retry button for `failed` and `dead` items (resets status to `pending`)

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhooks` | Shopify HMAC | Receives `orders/create` webhook. Idempotency check, enqueue, return 200 OK |
| POST | `/api/process-queue` | Bearer token (`CRON_SECRET`) | Queue processing endpoint called by cron-job.org. Processes up to 10 pending/failed items |
| GET | `/app` | Shopify OAuth | Dashboard (rule list + queue statistics) |
| POST | `/app` | Shopify OAuth | Toggle rule active/inactive (`intent=toggle`) or delete (`intent=delete`) |
| GET | `/app/rules/new` | Shopify OAuth | Rule creation form |
| POST | `/app/rules/new` | Shopify OAuth | Save new rule |
| GET | `/app/rules/:id` | Shopify OAuth | Rule editing form |
| POST | `/app/rules/:id` | Shopify OAuth | Update existing rule |
| GET | `/app/activity` | Shopify OAuth | Activity log listing |
| GET | `/app/queue` | Shopify OAuth | Queue monitor with status filters |
| POST | `/app/queue` | Shopify OAuth | Retry queue item (`intent=retry`) |

---

## Database Design

```
┌──────────────────────────────────────┐
│ WebhookQueue                         │
├──────────────────────────────────────┤
│ id          TEXT PK (cuid)           │
│ shop        TEXT                     │
│ orderId     TEXT                     │
│ payload     TEXT (JSON)              │
│ status      TEXT [pending|processing │
│             |completed|failed|dead]  │
│ retryCount  INTEGER (default: 0)     │
│ errorMsg    TEXT?                     │
│ processedAt DATETIME?                │
│ createdAt   DATETIME                 │
├──────────────────────────────────────┤
│ UNIQUE(shop, orderId) ← Idempotency │
│ INDEX(status, createdAt) ← Queries  │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐       ┌──────────────────────────┐
│ RewardRule                           │       │ RewardLog                │
├──────────────────────────────────────┤       ├──────────────────────────┤
│ id         TEXT PK (cuid)            │──┐    │ id           TEXT PK     │
│ shop       TEXT                      │  │    │ ruleId       TEXT FK ────┤
│ name       TEXT                      │  │    │ shop         TEXT        │
│ isActive   BOOLEAN (default: true)   │  │    │ customerId   TEXT        │
│ conditions TEXT (JSON: Condition[])   │  │    │ orderId      TEXT        │
│ action     TEXT (JSON: Action)       │  │    │ discountCode TEXT?       │
│ usageLimit INTEGER?                  │  │    │ actionType   TEXT        │
│ usageCount INTEGER (default: 0)      │  │    │ createdAt    DATETIME    │
│ validFrom  DATETIME?                 │  └───→│                          │
│ validUntil DATETIME?                 │       └──────────────────────────┘
│ createdAt  DATETIME                  │
│ updatedAt  DATETIME                  │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ Session (Shopify OAuth)              │
├──────────────────────────────────────┤
│ id, shop, state, isOnline, scope,    │
│ expires, accessToken, userId,        │
│ firstName, lastName, email,          │
│ accountOwner, locale, collaborator,  │
│ emailVerified, refreshToken,         │
│ refreshTokenExpires                  │
└──────────────────────────────────────┘
```

---

## Security Design

| Measure | Implementation |
|---------|---------------|
| Webhook HMAC Verification | `authenticate.webhook(request)` — Shopify App Remix automatically validates the HMAC signature |
| OAuth Session Authentication | `authenticate.admin(request)` — Validates Shopify OAuth session on all admin routes |
| Per-Shop Data Isolation | All database queries include `where: { shop: session.shop }`, preventing cross-store data access |
| Queue Endpoint Protection | `Authorization: Bearer {CRON_SECRET}` header validation on the processing endpoint |
| Idempotency Guarantee | `WebhookQueue` composite unique constraint `@@unique([shop, orderId])` prevents duplicate processing |
| Optimistic Locking | `updateMany` with `where: { id, status }` condition serves as a lightweight lock to prevent concurrent processing |

---

## Project Structure

```
reward-engine/
├── app/
│   ├── components/
│   │   ├── AppContent.tsx             (25 lines)  Navigation + language toggle + Outlet
│   │   └── LanguageToggle.tsx         (27 lines)  EN/JA toggle buttons
│   ├── i18n/
│   │   ├── i18nContext.tsx            (64 lines)  i18n Context Provider + useTranslation
│   │   ├── en.json                   (125 lines)  English translations
│   │   └── ja.json                   (125 lines)  Japanese translations
│   ├── routes/
│   │   ├── app._index.tsx            (267 lines)  Dashboard (rule list + queue stats)
│   │   ├── app.rules.new.tsx         (298 lines)  Rule creation form
│   │   ├── app.rules.$id.tsx         (342 lines)  Rule editing form
│   │   ├── app.activity.tsx          (109 lines)  Activity log listing
│   │   ├── app.queue.tsx             (227 lines)  Queue monitor
│   │   ├── app.tsx                    (37 lines)  App layout (AppProvider + I18nProvider)
│   │   ├── webhooks.tsx               (27 lines)  orders/create webhook handler
│   │   └── api.process-queue.tsx      (28 lines)  Queue processing cron endpoint
│   ├── services/
│   │   ├── webhook-receiver.server.ts (33 lines)  Idempotency check + queue insertion
│   │   ├── queue-processor.server.ts (116 lines)  Batch queue processing + locking
│   │   ├── rule-engine.server.ts      (61 lines)  Condition evaluation engine (AND logic)
│   │   ├── reward-executor.server.ts (169 lines)  Discount code creation + logging
│   │   ├── order-evaluator.server.ts  (34 lines)  Order data → evaluation context mapping
│   │   ├── customer-stats.server.ts   (29 lines)  Customer cumulative order count fetch
│   │   ├── graphql-retry.server.ts    (45 lines)  Exponential backoff GraphQL retry
│   │   └── types.ts                   (67 lines)  Type definitions (Condition, Action, OrderData)
│   ├── db.server.ts                   (15 lines)  Prisma client singleton
│   ├── shopify.server.ts              (35 lines)  Shopify app config (OAuth, API version)
│   └── root.tsx                       (30 lines)  HTML root layout
├── prisma/
│   ├── schema.prisma                             Database schema definitions
│   └── migrations/                               Migration history
├── shopify.app.toml                              Shopify app config (scopes, webhooks)
├── vite.config.ts                                Vite config (HMR, Remix plugin)
├── tsconfig.json                                 TypeScript config (strict mode)
└── package.json                                  Dependency definitions
```

---

## Setup

### Prerequisites

- Node.js >= 20.19
- Shopify CLI
- A Shopify development store

### Installation

```bash
# Clone the repository
git clone https://github.com/mer-prog/reward-engine.git
cd reward-engine

# Install dependencies
npm install

# Set up the database
npx prisma migrate dev

# Start the development server
shopify app dev
```

### Deployment

```bash
shopify app deploy
```

After deployment, configure a cron job (e.g., via [cron-job.org](https://cron-job.org)) to send a POST request to `/api/process-queue` every 30 seconds.

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SHOPIFY_API_KEY` | Shopify app API key | Yes |
| `SHOPIFY_API_SECRET` | Shopify app API secret | Yes |
| `SHOPIFY_APP_URL` | Public URL of the app | Yes |
| `SCOPES` | API scopes (`read_orders,read_customers,write_discounts,read_products`) | Yes |
| `CRON_SECRET` | Auth token for queue processing endpoint | No (unauthenticated if unset) |
| `SHOP_CUSTOM_DOMAIN` | Custom shop domain | No |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| SQLite as database | Standard Shopify App Template choice. No external DB needed for MVP, simplifying deployment |
| DB-backed queue instead of Redis/BullMQ | Prioritizes zero-cost operation. SQLite + cron-job.org provides sufficient throughput for the target scale |
| Instant response + queue pattern | Shopify webhooks require a response within 5 seconds. Offloading heavy processing to a queue guarantees timely 200 OK |
| Optimistic locking via `updateMany` | Simple lock mechanism through conditional updates. Avoids distributed lock complexity |
| Exponential backoff (1s, 2s, 4s) | Handles Shopify GraphQL API rate limits gracefully without triggering escalated throttling |
| JSON columns for conditions/actions | Keeps rule structure flexible. Adding new condition types requires no database migration |
| Custom i18n implementation | Avoids external library dependencies while staying lightweight within Shopify Embedded App constraints |
| 30-second cron interval | Minimum interval in cron-job.org's free tier. Balances order processing latency against zero operating cost |

---

## Running Costs

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| cron-job.org | Free tier (30-second interval) | $0 |
| SQLite | Local file | $0 |
| Shopify CLI / App Hosting | Provided by Shopify | $0 |
| **Total** | | **$0** |

---

## Author

[@mer-prog](https://github.com/mer-prog)
