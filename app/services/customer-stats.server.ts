import { graphqlWithRetry } from "./graphql-retry.server";

interface CustomerStatsResult {
  customer: {
    ordersCount: string;
  } | null;
}

/**
 * Fetch customer statistics (order count etc.) from Shopify Admin API.
 */
export async function getCustomerOrderCount(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  customerId: string,
): Promise<number> {
  const data = await graphqlWithRetry<CustomerStatsResult>(
    admin,
    `#graphql
      query customerStats($id: ID!) {
        customer(id: $id) {
          ordersCount
        }
      }
    `,
    { id: customerId },
  );

  return parseInt(data.customer?.ordersCount ?? "0", 10);
}
