# RewardEngine — 注文条件に基づく特典自動付与ルールエンジン

> **何を:** Shopify の注文 Webhook を受信し、ノーコードで設定したルール条件を評価して、ディスカウントコードを自動発行する Embedded App
> **誰に:** Shopify Plus / 中〜大規模マーチャント
> **技術:** Remix · TypeScript · Prisma · SQLite · Polaris React · Shopify GraphQL Admin API · App Bridge

ソースコード: [github.com/mer-prog/reward-engine](https://github.com/mer-prog/reward-engine)

---

## このプロジェクトで証明できるスキル

| スキル | 実装内容 |
|--------|----------|
| Shopify Embedded App 開発 | App Bridge + Polaris React による管理画面、OAuth 認証、Webhook 登録・HMAC 検証を一貫して実装 |
| 非同期キュー設計 | 即レスポンス＋バックグラウンドキュー＋冪等性チェックの 3 層 Webhook 処理アーキテクチャ |
| ルールエンジン設計 | 4 条件タイプ × 3 アクションタイプを AND 結合で評価し、有効期間・使用回数上限も考慮する汎用エンジン |
| GraphQL API 統合 | Shopify Admin API の `discountCodeBasicCreate` mutation によるクーポン自動生成、指数バックオフ付きリトライ |
| データベース設計 | Prisma + SQLite による排他制御付きキュー管理、リレーション付きログ記録、複合ユニーク制約による冪等性保証 |
| 国際化対応 | React Context ベースの自前 i18n（EN/JA 切替）、JSON 翻訳ファイルによるネスト対応・パラメータ補間 |
| 障害耐性設計 | 最大 5 回の自動リトライ、dead letter キュー、キューモニター画面からの手動再処理 |

---

## 技術スタック

| カテゴリ | 技術 | 用途 |
|----------|------|------|
| フレームワーク | Remix ^2.16.1 | SSR・ルーティング・フォーム処理 |
| 言語 | TypeScript ^5.2.2 (strict mode) | 型安全な開発 |
| UI ライブラリ | Polaris React ^12.0.0 | Shopify 管理画面準拠のコンポーネント |
| App Bridge | @shopify/app-bridge-react ^4.1.6 | Shopify 管理画面への埋め込み・NavMenu |
| ORM | Prisma ^6.2.1 | データベース操作・マイグレーション |
| データベース | SQLite | ローカルファイル DB |
| セッション管理 | @shopify/shopify-app-session-storage-prisma ^8.0.0 | OAuth セッションの永続化 |
| ビルドツール | Vite ^6.2.2 | HMR・バンドル |
| リンター | ESLint ^8.42.0 + Prettier ^3.2.4 | コード品質管理 |
| ボット判定 | isbot ^5.1.0 | SSR ストリーミング制御 |
| スケジューラ | cron-job.org | 30 秒間隔のキュー処理トリガー |

---

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────┐
│                       Shopify ストア                            │
│                    (orders/create Webhook)                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ POST /webhooks
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: 即レスポンス (< 1秒)                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ HMAC 検証    │→│ 冪等性チェック │→│ WebhookQueue に挿入   │ │
│  │ (App Bridge) │  │ (shop+orderId)│  │ status = "pending"    │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
│                                             │ 即座に 200 OK     │
└─────────────────────────────────────────────┼───────────────────┘
                                              │
            ┌─────────────────────────────────┘
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: バックグラウンド処理                                    │
│  cron-job.org (30秒間隔) → POST /api/process-queue              │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ pending取得  │→│ ルール評価    │→│ 特典実行               │ │
│  │ (最大10件)   │  │ (AND結合)    │  │ discountCodeBasicCreate│ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│         │                                       │              │
│         ▼                                       ▼              │
│  ┌─────────────────┐              ┌────────────────────────┐   │
│  │ 排他制御         │              │ RewardLog に記録       │   │
│  │ status=processing│              │ usageCount++           │   │
│  └─────────────────┘              └────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: エラーハンドリング                                     │
│  ┌──────────────────────────────────────────┐                   │
│  │ 失敗 → retryCount++ → status="failed"   │                   │
│  │ retryCount >= 5 → status="dead"          │                   │
│  │ GraphQL THROTTLED → 指数バックオフ(1s,2s,4s)│                │
│  └──────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Shopify 管理画面 (Embedded App)                                 │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ダッシュボード│ │ルール作成 │ │付与ログ  │ │キューモニター    │ │
│  │キュー統計   │ │ルール編集 │ │          │ │再処理ボタン      │ │
│  │ルール一覧   │ │条件+特典  │ │          │ │ステータスフィルタ │ │
│  └────────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 主要機能

### ルールエンジン
4 種類の条件タイプを AND 結合で評価する。各ルールには有効期間と使用回数上限を設定可能。`rule-engine.server.ts` が全アクティブルールを走査し、`evaluateCondition` で各条件を判定する。

**条件タイプ:**
| 条件 | 評価ロジック |
|------|-------------|
| `order_total_above` | `totalPriceSet.shopMoney.amount` が閾値以上か判定 |
| `order_count_equals` | GraphQL API で取得した顧客の累計注文回数と一致するか判定 |
| `order_contains_collection` | 注文内商品のコレクションハンドルに指定値が含まれるか判定 |
| `order_item_quantity_above` | 注文内の合計商品数が閾値以上か判定 |

**アクションタイプ:**
| アクション | 実行内容 |
|-----------|----------|
| `percentage_discount` | 指定%の割引クーポンを発行（有効期限 30 日、1 回使用可） |
| `fixed_discount` | 指定額の定額割引クーポンを発行 |
| `free_shipping` | 送料無料クーポンを発行（内部的には 100% 割引として実装） |

### Webhook 3 層処理
1. **即レスポンス:** HMAC 検証後、`shop + orderId` の複合ユニーク制約で冪等性を保証し、キューに投入して即座に 200 OK を返却
2. **バックグラウンド処理:** cron-job.org が 30 秒間隔で `/api/process-queue` を呼び出し、最大 10 件をバッチ処理。`updateMany` の `where` 条件で楽観的排他制御を実現
3. **障害復旧:** 失敗時は `retryCount` をインクリメントし、5 回を超えると `dead` ステータスに遷移。管理画面から手動再処理が可能

### GraphQL API 統合
`graphqlWithRetry` がすべての API 呼び出しを担当。`THROTTLED` エラー検出時は指数バックオフ（1 秒、2 秒、4 秒）で最大 3 回リトライする。ディスカウントコードは `discountCodeBasicCreate` mutation で生成し、ルール名ベースのプレフィックス + ランダム 6 文字のコードを発行する。

### 国際化（i18n）
React Context ベースの自前実装。`I18nProvider` がロケール状態を管理し、`useTranslation` フックで `t()` 関数を提供する。ネストキー（ドット区切り）とパラメータ補間 `{value}` に対応。デフォルトは日本語、フォールバックは英語。画面右上の `LanguageToggle` コンポーネントで EN/JA を切り替え可能。

---

## 画面仕様

### ダッシュボード (`app._index.tsx` — 267 行)
- キュー統計カード（4 列）: 待機中 / 失敗 / 停止 / 直近 1 時間処理数
- ルール一覧テーブル: 名前、条件サマリ、アクション、ステータス Badge、発動回数
- 各ルールに有効/無効切替ボタンと削除ボタン
- ルールが 0 件の場合は EmptyState を表示

### ルール作成 (`app.rules.new.tsx` — 298 行)
- ルール名入力
- 条件セクション: 条件タイプ Select + 値入力、複数条件の追加・削除（AND 結合）
- アクションセクション: アクションタイプ Select + 値入力 + クーポンタイトル
- オプション: 使用回数制限 Checkbox + 入力、有効期間 Checkbox + 日付入力
- バリデーション: 名前と全条件値が入力済み、かつアクション値が設定済みの場合のみ送信可能

### ルール編集 (`app.rules.$id.tsx` — 342 行)
- 作成画面と同一の UI 構成
- 既存ルールのデータを `loader` で取得しフォームに初期値として設定
- ショップ所有権の検証付き

### 付与ログ (`app.activity.tsx` — 109 行)
- 直近 100 件の特典付与履歴を表示
- カラム: 日時、顧客 ID、注文 ID、ルール名、アクションタイプ Badge、ディスカウントコード
- `RewardLog` と `RewardRule` のリレーションでルール名を取得

### キューモニター (`app.queue.tsx` — 227 行)
- ステータス別フィルタ（ChoiceList による複数選択）
- カラム: 注文 ID、ステータス Badge、リトライ回数、エラーメッセージ、作成日時、処理日時
- `failed` / `dead` のアイテムに「再処理」ボタン（ステータスを `pending` にリセット）

---

## API エンドポイント

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| POST | `/webhooks` | Shopify HMAC | `orders/create` Webhook 受信。冪等性チェック後にキューへ投入し即座に 200 OK を返却 |
| POST | `/api/process-queue` | Bearer トークン (`CRON_SECRET`) | cron-job.org から呼び出されるキュー処理エンドポイント。pending/failed を最大 10 件処理 |
| GET | `/app` | Shopify OAuth | ダッシュボード表示（ルール一覧 + キュー統計） |
| POST | `/app` | Shopify OAuth | ルールの有効/無効切替 (`intent=toggle`) および削除 (`intent=delete`) |
| GET | `/app/rules/new` | Shopify OAuth | ルール作成画面表示 |
| POST | `/app/rules/new` | Shopify OAuth | 新規ルール保存 |
| GET | `/app/rules/:id` | Shopify OAuth | ルール編集画面表示 |
| POST | `/app/rules/:id` | Shopify OAuth | ルール更新保存 |
| GET | `/app/activity` | Shopify OAuth | 付与ログ一覧表示 |
| GET | `/app/queue` | Shopify OAuth | キューモニター表示（ステータスフィルタ対応） |
| POST | `/app/queue` | Shopify OAuth | キューアイテムの再処理 (`intent=retry`) |

---

## データベース設計

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
│ UNIQUE(shop, orderId)  ← 冪等性保証  │
│ INDEX(status, createdAt) ← 取得最適化│
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

## セキュリティ設計

| 対策 | 実装箇所 |
|------|---------|
| Webhook HMAC 検証 | `authenticate.webhook(request)` — Shopify App Remix が自動的に HMAC 署名を検証 |
| OAuth セッション認証 | `authenticate.admin(request)` — 全管理画面ルートで Shopify OAuth セッションを検証 |
| ショップ単位のデータ分離 | 全 DB クエリに `where: { shop: session.shop }` を付与し、他店舗のデータにアクセス不可 |
| キュー処理エンドポイント保護 | `Authorization: Bearer {CRON_SECRET}` ヘッダーで認証 |
| 冪等性保証 | `WebhookQueue` の `@@unique([shop, orderId])` で同一注文の重複処理を防止 |
| 排他制御 | `updateMany` の `where: { id, status }` 条件で楽観的ロックを実現し、複数プロセスの同時処理を防止 |

---

## プロジェクト構成

```
reward-engine/
├── app/
│   ├── components/
│   │   ├── AppContent.tsx             (25行)  ナビゲーション + 言語切替 + Outlet
│   │   └── LanguageToggle.tsx         (27行)  EN/JA 切替ボタン
│   ├── i18n/
│   │   ├── i18nContext.tsx            (64行)  i18n Context Provider + useTranslation
│   │   ├── en.json                   (125行)  英語翻訳ファイル
│   │   └── ja.json                   (125行)  日本語翻訳ファイル
│   ├── routes/
│   │   ├── app._index.tsx            (267行)  ダッシュボード（ルール一覧 + キュー統計）
│   │   ├── app.rules.new.tsx         (298行)  ルール新規作成画面
│   │   ├── app.rules.$id.tsx         (342行)  ルール編集画面
│   │   ├── app.activity.tsx          (109行)  付与ログ一覧
│   │   ├── app.queue.tsx             (227行)  キューモニター
│   │   ├── app.tsx                    (37行)  アプリレイアウト（AppProvider + I18nProvider）
│   │   ├── webhooks.tsx               (27行)  orders/create Webhook ハンドラー
│   │   └── api.process-queue.tsx      (28行)  キュー処理 Cron エンドポイント
│   ├── services/
│   │   ├── webhook-receiver.server.ts (33行)  冪等性チェック + キュー投入
│   │   ├── queue-processor.server.ts (116行)  バッチキュー処理 + 排他制御
│   │   ├── rule-engine.server.ts      (61行)  条件評価エンジン（AND 結合）
│   │   ├── reward-executor.server.ts (169行)  ディスカウントコード生成 + ログ記録
│   │   ├── order-evaluator.server.ts  (34行)  注文データ → 評価コンテキスト変換
│   │   ├── customer-stats.server.ts   (29行)  顧客累計注文回数取得
│   │   ├── graphql-retry.server.ts    (45行)  指数バックオフ付き GraphQL リトライ
│   │   └── types.ts                   (67行)  型定義（Condition, Action, OrderData 等）
│   ├── db.server.ts                   (15行)  Prisma クライアント（シングルトン）
│   ├── shopify.server.ts              (35行)  Shopify App 設定（OAuth, API バージョン等）
│   └── root.tsx                       (30行)  HTML ルートレイアウト
├── prisma/
│   ├── schema.prisma                          データベーススキーマ定義
│   └── migrations/                            マイグレーション履歴
├── shopify.app.toml                           Shopify アプリ設定（スコープ, Webhook）
├── vite.config.ts                             Vite 設定（HMR, Remix プラグイン）
├── tsconfig.json                              TypeScript 設定（strict mode）
└── package.json                               依存関係定義
```

---

## セットアップ

### 前提条件

- Node.js >= 20.19
- Shopify CLI
- Shopify 開発ストア

### 手順

```bash
# リポジトリをクローン
git clone https://github.com/mer-prog/reward-engine.git
cd reward-engine

# 依存関係をインストール
npm install

# データベースをセットアップ
npx prisma migrate dev

# 開発サーバーを起動
shopify app dev
```

### デプロイ

```bash
shopify app deploy
```

デプロイ後、[cron-job.org](https://cron-job.org) で 30 秒間隔の POST リクエストを `/api/process-queue` に設定する。

### 環境変数

| 変数 | 説明 | 必須 |
|------|------|------|
| `SHOPIFY_API_KEY` | Shopify アプリの API キー | はい |
| `SHOPIFY_API_SECRET` | Shopify アプリの API シークレット | はい |
| `SHOPIFY_APP_URL` | アプリの公開 URL | はい |
| `SCOPES` | API スコープ（`read_orders,read_customers,write_discounts,read_products`） | はい |
| `CRON_SECRET` | キュー処理エンドポイントの認証トークン | いいえ（未設定時は認証なし） |
| `SHOP_CUSTOM_DOMAIN` | カスタムドメイン | いいえ |

---

## 設計判断の根拠

| 判断 | 根拠 |
|------|------|
| SQLite を採用 | Shopify App Template 標準構成。MVP フェーズでは外部 DB 不要でデプロイ簡素化 |
| Redis/BullMQ ではなく DB キュー | 無料枠での運用を優先。cron-job.org + SQLite で十分なスループットを確保 |
| 即レスポンス + キュー方式 | Shopify Webhook は 5 秒以内にレスポンスが必要。重い処理をキューに分離して確実に 200 OK を返す |
| 楽観的排他制御 | `updateMany` の `where` 条件で簡易ロックを実現。分散ロックの複雑さを回避 |
| 指数バックオフ（1s, 2s, 4s） | Shopify GraphQL API のレート制限に対応。過度なリトライによる制限強化を防止 |
| JSON カラムで条件・アクションを保存 | ルール構造の柔軟性を確保。条件タイプの追加が DB マイグレーション不要 |
| 自前 i18n 実装 | 外部ライブラリの依存を避け、Shopify Embedded App の制約内で軽量に実現 |
| 30 秒間隔の Cron | cron-job.org 無料枠の最小間隔。注文処理の即時性とコストのバランス |

---

## 運用コスト

| サービス | プラン | 月額 |
|---------|--------|------|
| cron-job.org | 無料枠（30 秒間隔） | 0 円 |
| SQLite | ローカルファイル | 0 円 |
| Shopify CLI / App Hosting | Shopify 提供 | 0 円 |
| **合計** | | **0 円** |

---

## 作者

[@mer-prog](https://github.com/mer-prog)
