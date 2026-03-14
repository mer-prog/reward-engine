import type { ActionFunctionArgs } from "@remix-run/node";
import { processQueue } from "../services/queue-processor.server";
import { unauthenticated } from "../shopify.server";

/**
 * Queue processing endpoint called by cron-job.org every 30 seconds.
 * POST /api/process-queue
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Basic auth check via a shared secret
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await processQueue(async (shop: string) => {
    const { admin } = await unauthenticated.admin(shop);
    return admin;
  });

  return Response.json(result);
};

export const loader = async () => {
  return new Response("Method Not Allowed", { status: 405 });
};
