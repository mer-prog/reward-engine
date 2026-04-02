# RewardEngine

**A no-code rule engine for automated reward and coupon distribution on Shopify.**

## Features

- **Visual Rule Builder** — Create reward rules with a no-code UI: combine conditions, set actions, and define validity periods
- **Flexible Conditions** — Trigger on order total thresholds, cumulative order count, collection-based purchases, or item quantity
- **Automated Rewards** — Auto-generate percentage discounts, fixed-amount coupons, or free shipping codes
- **Reliable Webhook Processing** — Three-layer architecture: instant response + background queue + idempotency for zero missed orders
- **Queue Monitor** — Real-time dashboard for pending, failed, and dead-letter queue items with manual retry
- **Auto-Retry with Backoff** — Failed jobs retry up to 5 times with exponential backoff before moving to dead-letter queue
- **Activity Log** — Full history of every reward issued, linked to customer, order, and rule
- **Usage Limits** — Cap total redemptions per rule and set validity date ranges

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Remix (Shopify App Template) |
| Language | TypeScript |
| Database | Prisma + SQLite |
| UI | Polaris React |
| API | Shopify GraphQL Admin API |
| Scheduling | cron-job.org (queue processor) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- A Shopify development store

### Setup

```bash
# Install dependencies
npm install

# Set up the database
npx prisma migrate dev

# Start development server
shopify app dev
```

### Deployment

```bash
shopify app deploy
```

Configure a cron job (e.g., via [cron-job.org](https://cron-job.org)) to call `POST /api/process-queue` every 30 seconds for background order processing.

## Architecture

```
reward-engine/
├── app/
│   ├── routes/          # Rule CRUD, activity log, queue monitor, webhooks, cron endpoint
│   ├── services/        # Webhook receiver, queue processor, rule engine, reward executor
│   └── components/      # Rule builder, condition/action selectors, queue status cards
├── prisma/              # Database schema (WebhookQueue, RewardRule, RewardLog)
└── shopify.app.toml     # Shopify app configuration
```

### Processing Pipeline

```
Shopify orders/create webhook
  -> HMAC verification + idempotency check
  -> Enqueue as "pending" -> return 200 OK immediately

Cron (every 30s) -> /api/process-queue
  -> Fetch pending items -> mark as "processing"
  -> Evaluate all active rules against the order
  -> Execute matched rewards (create discount codes via GraphQL)
  -> Log results -> mark as "completed"
  -> On failure: increment retry count -> exponential backoff
  -> After 5 failures: mark as "dead" for manual review
```

## License

MIT
