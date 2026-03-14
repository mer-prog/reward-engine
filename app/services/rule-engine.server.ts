import type { Condition, EvaluationContext } from "./types";
import type { RewardRule } from "@prisma/client";

/**
 * Evaluate all active rules against an order context.
 * All conditions within a rule are AND-combined.
 * Returns rules that match.
 */
export function evaluateRules(
  rules: RewardRule[],
  context: EvaluationContext,
): RewardRule[] {
  const now = new Date();

  return rules.filter((rule) => {
    // Check validity period
    if (rule.validFrom && new Date(rule.validFrom) > now) return false;
    if (rule.validUntil && new Date(rule.validUntil) < now) return false;

    // Check usage limit
    if (rule.usageLimit !== null && rule.usageCount >= rule.usageLimit) return false;

    // Evaluate all conditions (AND)
    const conditions: Condition[] = JSON.parse(rule.conditions);
    return conditions.every((condition) => evaluateCondition(condition, context));
  });
}

function evaluateCondition(
  condition: Condition,
  context: EvaluationContext,
): boolean {
  switch (condition.type) {
    case "order_total_above": {
      const threshold = Number(condition.value);
      const orderTotal = parseFloat(
        context.order.totalPriceSet.shopMoney.amount,
      );
      return orderTotal >= threshold;
    }

    case "order_count_equals": {
      const target = Number(condition.value);
      return context.customerOrderCount === target;
    }

    case "order_contains_collection": {
      const handle = String(condition.value);
      return context.collectionHandles.includes(handle);
    }

    case "order_item_quantity_above": {
      const threshold = Number(condition.value);
      return context.totalItemQuantity >= threshold;
    }

    default:
      console.warn(`[rule-engine] Unknown condition type: ${(condition as Condition).type}`);
      return false;
  }
}
