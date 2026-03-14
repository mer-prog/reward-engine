import db from "../db.server";
import { getCustomerOrderCount } from "./customer-stats.server";
import { buildEvaluationContext } from "./order-evaluator.server";
import { evaluateRules } from "./rule-engine.server";
import { executeReward } from "./reward-executor.server";
import type { OrderData } from "./types";

const MAX_RETRIES = 5;
const BATCH_SIZE = 10;

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

/**
 * Process pending items from the webhook queue.
 * Called by cron every 30 seconds.
 */
export async function processQueue(
  getAdminForShop: (shop: string) => Promise<AdminClient>,
): Promise<{ processed: number; failed: number }> {
  // Fetch pending items (oldest first)
  const items = await db.webhookQueue.findMany({
    where: { status: { in: ["pending", "failed"] } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  // Exclude items that have exceeded max retries but are still "failed"
  const processable = items.filter((item) => {
    if (item.status === "failed" && item.retryCount >= MAX_RETRIES) {
      // Mark as dead
      db.webhookQueue
        .update({
          where: { id: item.id },
          data: { status: "dead" },
        })
        .catch(console.error);
      return false;
    }
    return true;
  });

  let processed = 0;
  let failed = 0;

  for (const item of processable) {
    try {
      // Exclusive lock: set status to processing
      const updated = await db.webhookQueue.updateMany({
        where: { id: item.id, status: item.status },
        data: { status: "processing" },
      });

      // If another processor already grabbed it, skip
      if (updated.count === 0) continue;

      const admin = await getAdminForShop(item.shop);
      const order: OrderData = JSON.parse(item.payload);

      // Get customer order count
      const customerId = order.customer?.id;
      let customerOrderCount = 0;
      if (customerId) {
        customerOrderCount = await getCustomerOrderCount(admin, customerId);
      }

      // Build evaluation context
      const context = buildEvaluationContext(order, customerOrderCount);

      // Get all active rules for this shop
      const rules = await db.rewardRule.findMany({
        where: { shop: item.shop, isActive: true },
      });

      // Evaluate rules
      const matchedRules = evaluateRules(rules, context);

      // Execute matched rewards
      for (const rule of matchedRules) {
        if (customerId) {
          await executeReward(admin, rule, item.shop, customerId, item.orderId);
        }
      }

      // Mark as completed
      await db.webhookQueue.update({
        where: { id: item.id },
        data: {
          status: "completed",
          processedAt: new Date(),
        },
      });

      processed++;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      console.error(`[queue-processor] Failed to process ${item.id}: ${errorMsg}`);

      const newRetryCount = item.retryCount + 1;
      await db.webhookQueue.update({
        where: { id: item.id },
        data: {
          status: newRetryCount >= MAX_RETRIES ? "dead" : "failed",
          retryCount: newRetryCount,
          errorMsg,
        },
      });

      failed++;
    }
  }

  return { processed, failed };
}
