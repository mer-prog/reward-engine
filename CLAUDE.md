# RewardEngine — 特典付与条件管理アプリ

## プロジェクト概要

Upworkポートフォリオ用のShopify Embedded App。
「○円以上購入でクーポン」「○回目の注文でギフト」など、あらゆる特典付与条件をノーコードで設定できるルールエンジン。
注文殺到時も取りこぼさない即レス＋キュー＋冪等性の3層アーキテクチャ。

**ターゲット:** Shopify Plus / 中〜大規模マーチャント
**Dev Store:** ryo-dev-plus（Shopify Plus Dev Store）

## 技術スタック

- Remix（Shopify App Template）
- TypeScript
- Prisma + SQLite
- Polaris React
- GraphQL Admin API
- Shopify App Bridge

## 必要なAPIスコープ

read_orders, read_customers, write_discounts, read_products

## ディレクトリ構成

reward-engine/
├── CLAUDE.md
├── app/
│   ├── routes/
│   │   ├── app._index.tsx           # ルール一覧ダッシュボード
│   │   ├── app.rules.new.tsx        # 新規ルール作成
│   │   ├── app.rules.$id.tsx        # ルール編集
│   │   ├── app.activity.tsx         # 特典付与ログ
│   │   ├── app.queue.tsx            # キュー処理状況モニター
│   │   ├── webhooks.tsx             # orders/create webhook（即レス＋キュー投入）
│   │   └── api.process-queue.tsx    # キュー処理エンドポイント（Cron呼び出し）
│   ├── services/
│   │   ├── webhook-receiver.server.ts  # Webhook受信＆HMAC検証＆キュー投入
│   │   ├── queue-processor.server.ts   # キューからpending取得＆順次処理
│   │   ├── rule-engine.server.ts       # ルール評価エンジン
│   │   ├── reward-executor.server.ts   # 特典付与実行（ディスカウント作成）
│   │   ├── order-evaluator.server.ts   # 注文データ展開＆ルール評価
│   │   ├── customer-stats.server.ts    # 顧客統計取得（累計購入額等）
│   │   └── graphql-retry.server.ts     # GraphQL呼び出しのリトライ＆指数バックオフ
│   ├── components/
│   │   ├── RuleBuilder.tsx           # ルール設定UI
│   │   ├── ConditionSelector.tsx     # 条件種別選択
│   │   ├── ActionSelector.tsx        # アクション種別選択
│   │   ├── RuleCard.tsx              # ルールカード表示
│   │   ├── ActivityTable.tsx         # 付与ログテーブル
│   │   └── QueueStatusCard.tsx       # キュー処理状況カード
│   └── shopify.server.ts
├── prisma/
│   └── schema.prisma
├── shopify.app.toml
└── package.json

## ルールエンジン設計

### 条件タイプ（MVP）
- order_total_above: 注文合計が指定額以上
- order_count_equals: 累計注文回数が指定回数目
- order_contains_collection: 特定コレクションの商品を含む
- order_item_quantity_above: 注文内の商品数が指定数以上

### アクションタイプ（MVP）
- percentage_discount: %割引クーポン発行
- fixed_discount: 定額割引クーポン発行
- free_shipping: 送料無料クーポン発行

## Webhook処理アーキテクチャ（即レス＋キュー＋冪等性）

### Phase 1: 即レスポンス（webhooks.tsx — 1秒以内）
Shopify orders/create Webhook
  -> HMAC検証
  -> 冪等性チェック（同じorderIdが既にキューにあればスキップ）
  -> WebhookQueueテーブルにpendingとして保存
  -> 即座に200 OK返却

### Phase 2: バックグラウンド処理（api.process-queue.tsx）
cron-job.org（30秒間隔）-> POST /api/process-queue
  -> WebhookQueueからpendingを最大10件取得
  -> 各注文に対して:
    1. statusを"processing"に更新（排他制御）
    2. order-evaluator: 注文データを展開
    3. customer-stats: 顧客の累計データ取得
    4. rule-engine: 全アクティブルールの条件を評価
    5. マッチしたルールごとにreward-executorが実行
       -> discountCodeBasicCreate mutationでクーポン作成（リトライ付き）
    6. RewardLogに記録
    7. statusを"completed"に更新
  -> 処理失敗時: statusを"failed"、retryCountをインクリメント
  -> retryCount < 5 なら次回Cronで再処理
  -> retryCount >= 5 なら"dead"（管理画面で手動対応）

### Phase 3: GraphQL APIのレート制限対策
指数バックオフ付きリトライ（1s, 2s, 4s、最大3回）

## Prismaスキーマ

model WebhookQueue {
  id          String   @id @default(cuid())
  shop        String
  orderId     String
  payload     String
  status      String   @default("pending") // pending | processing | completed | failed | dead
  retryCount  Int      @default(0)
  errorMsg    String?
  processedAt DateTime?
  createdAt   DateTime @default(now())
  @@unique([shop, orderId])
  @@index([status, createdAt])
}

model RewardRule {
  id          String   @id @default(cuid())
  shop        String
  name        String
  isActive    Boolean  @default(true)
  conditions  String   // JSON（Condition[]）
  action      String   // JSON（Action）
  usageLimit  Int?
  usageCount  Int      @default(0)
  validFrom   DateTime?
  validUntil  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  logs        RewardLog[]
}

model RewardLog {
  id           String   @id @default(cuid())
  ruleId       String
  rule         RewardRule @relation(fields: [ruleId], references: [id])
  shop         String
  customerId   String
  orderId      String
  discountCode String?
  actionType   String
  createdAt    DateTime @default(now())
}

## 画面構成

### ダッシュボード（app._index.tsx）
- キュー状況カード: pending / failed / dead件数 / 直近1時間の処理件数
- ルール一覧（名前、条件サマリ、有効/無効、発動回数）
- 「新規ルール作成」ボタン
- 各ルールに「編集」「有効/無効切替」「削除」

### キューモニター（app.queue.tsx）
- WebhookQueueの全件一覧（ステータス別フィルタ）
- failed / dead のキューに「再処理」ボタン
- dead の詳細表示（エラーメッセージ、注文ID、リトライ回数）

### ルール作成（app.rules.new.tsx）
1. ルール名入力
2. 条件追加（種別選択 -> パラメータ入力、複数条件はAND結合）
3. アクション設定（種別選択 -> パラメータ入力）
4. 有効期間設定（任意）
5. 使用回数上限（任意）
6. プレビュー -> 保存

### 付与ログ（app.activity.tsx）
- 特典付与の履歴一覧（日時、顧客、注文、適用ルール、発行クーポン）

## コーディング規約

- TypeScript strict mode
- Polaris Reactコンポーネント使用
- サービスロジックは *.server.ts に分離
- Conventional Commits形式

## MVPスコープ

含む:
- 4条件タイプ x 3アクションタイプのルール設定
- 即レス＋キュー方式のWebhook処理
- 冪等性チェック（同一注文の重複処理防止）
- GraphQL APIリトライ＆指数バックオフ
- 失敗キューの自動リトライ（最大5回）＆dead判定
- キューモニター画面（failed / deadの手動再処理）
- 付与ログ表示

含まない（来週以降）:
- ポイント制（累積ポイント管理）
- ルールのOR結合
- 顧客タグベースの条件
- メール通知
- Redis/BullMQキュー

## コスト

- cron-job.org: 無料枠（30秒間隔）
- その他: 完全無料

## 開発コマンド

shopify app dev
shopify app deploy
