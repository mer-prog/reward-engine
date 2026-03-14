// Condition types supported by the rule engine
export type ConditionType =
  | "order_total_above"
  | "order_count_equals"
  | "order_contains_collection"
  | "order_item_quantity_above";

export interface Condition {
  type: ConditionType;
  value: number | string;
}

// Action types supported by the rule engine
export type ActionType =
  | "percentage_discount"
  | "fixed_discount"
  | "free_shipping";

export interface Action {
  type: ActionType;
  value?: number; // discount amount or percentage
  title?: string; // coupon title
}

// Shopify order data (simplified)
export interface OrderData {
  id: string; // gid://shopify/Order/...
  name: string; // #1001
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  customer: {
    id: string;
    email: string;
    ordersCount: string;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        quantity: number;
        product: {
          id: string;
          collections: {
            edges: Array<{
              node: {
                id: string;
                handle: string;
              };
            }>;
          };
        } | null;
      };
    }>;
  };
}

// Context passed to rule evaluation
export interface EvaluationContext {
  order: OrderData;
  customerOrderCount: number;
  totalItemQuantity: number;
  collectionHandles: string[];
}
