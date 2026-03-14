import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { enqueueOrder } from "../services/webhook-receiver.server";

/**
 * orders/create webhook handler.
 * Phase 1: Instant response — HMAC verify + idempotency check + enqueue + 200 OK.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[webhooks] Received ${topic} for ${shop}`);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Ignored", { status: 200 });
  }

  const orderId = (payload as { admin_graphql_api_id?: string }).admin_graphql_api_id;
  if (!orderId) {
    console.error("[webhooks] No order ID in payload");
    return new Response("OK", { status: 200 });
  }

  await enqueueOrder(shop, orderId, JSON.stringify(payload));

  return new Response("OK", { status: 200 });
};
