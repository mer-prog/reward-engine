import db from "../db.server";

/**
 * Webhook receiver: idempotency check + queue insertion.
 * Returns immediately after enqueuing for fast 200 response.
 */
export async function enqueueOrder(
  shop: string,
  orderId: string,
  payload: string,
): Promise<{ enqueued: boolean }> {
  // Idempotency: skip if this order is already in the queue
  const existing = await db.webhookQueue.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });

  if (existing) {
    console.log(`[webhook-receiver] Order ${orderId} already in queue, skipping`);
    return { enqueued: false };
  }

  await db.webhookQueue.create({
    data: {
      shop,
      orderId,
      payload,
      status: "pending",
    },
  });

  console.log(`[webhook-receiver] Order ${orderId} enqueued for ${shop}`);
  return { enqueued: true };
}
