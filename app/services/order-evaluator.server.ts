import type { OrderData, EvaluationContext } from "./types";

/**
 * Parse webhook payload and build evaluation context.
 */
export function buildEvaluationContext(
  order: OrderData,
  customerOrderCount: number,
): EvaluationContext {
  // Calculate total item quantity
  let totalItemQuantity = 0;
  const collectionHandles: string[] = [];

  for (const edge of order.lineItems.edges) {
    const item = edge.node;
    totalItemQuantity += item.quantity;

    if (item.product?.collections) {
      for (const colEdge of item.product.collections.edges) {
        const handle = colEdge.node.handle;
        if (!collectionHandles.includes(handle)) {
          collectionHandles.push(handle);
        }
      }
    }
  }

  return {
    order,
    customerOrderCount,
    totalItemQuantity,
    collectionHandles,
  };
}
