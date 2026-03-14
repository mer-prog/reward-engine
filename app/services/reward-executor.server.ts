import type { RewardRule } from "@prisma/client";
import type { Action } from "./types";
import { graphqlWithRetry } from "./graphql-retry.server";
import db from "../db.server";

interface DiscountCreateResult {
  discountCodeBasicCreate: {
    codeDiscountNode: {
      id: string;
      codeDiscount: {
        codes: {
          edges: Array<{
            node: { code: string };
          }>;
        };
      };
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

/**
 * Execute a reward action: create a discount code via Shopify Admin API.
 */
export async function executeReward(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  rule: RewardRule,
  shop: string,
  customerId: string,
  orderId: string,
): Promise<string | null> {
  const action: Action = JSON.parse(rule.action);
  const code = generateDiscountCode(rule.name);

  const discountInput = buildDiscountInput(action, code);
  if (!discountInput) return null;

  const data = await graphqlWithRetry<DiscountCreateResult>(
    admin,
    DISCOUNT_CREATE_MUTATION,
    { basicCodeDiscount: discountInput },
  );

  const userErrors = data.discountCodeBasicCreate.userErrors;
  if (userErrors.length > 0) {
    throw new Error(`Discount creation failed: ${JSON.stringify(userErrors)}`);
  }

  const createdCode =
    data.discountCodeBasicCreate.codeDiscountNode?.codeDiscount.codes.edges[0]
      ?.node.code ?? code;

  // Log the reward
  await db.rewardLog.create({
    data: {
      ruleId: rule.id,
      shop,
      customerId,
      orderId,
      discountCode: createdCode,
      actionType: action.type,
    },
  });

  // Increment usage count
  await db.rewardRule.update({
    where: { id: rule.id },
    data: { usageCount: { increment: 1 } },
  });

  console.log(`[reward-executor] Created discount ${createdCode} for rule "${rule.name}"`);
  return createdCode;
}

function generateDiscountCode(ruleName: string): string {
  const suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
  const prefix = ruleName
    .replace(/[^a-zA-Z0-9]/g, "")
    .substring(0, 10)
    .toUpperCase();
  return `${prefix}-${suffix}`;
}

function buildDiscountInput(
  action: Action,
  code: string,
): Record<string, unknown> | null {
  const title = action.title ?? `Reward: ${code}`;
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  switch (action.type) {
    case "percentage_discount":
      return {
        title,
        code,
        startsAt,
        endsAt,
        usageLimit: 1,
        customerSelection: { all: true },
        customerGets: {
          value: { percentage: (action.value ?? 10) / 100 },
          items: { all: true },
        },
      };

    case "fixed_discount":
      return {
        title,
        code,
        startsAt,
        endsAt,
        usageLimit: 1,
        customerSelection: { all: true },
        customerGets: {
          value: {
            discountAmount: {
              amount: action.value ?? 500,
              appliesOnEachItem: false,
            },
          },
          items: { all: true },
        },
      };

    case "free_shipping":
      return {
        title,
        code,
        startsAt,
        endsAt,
        usageLimit: 1,
        customerSelection: { all: true },
        customerGets: {
          value: { percentage: 1.0 },
          items: { all: true },
        },
      };

    default:
      console.warn(`[reward-executor] Unknown action type: ${action.type}`);
      return null;
  }
}

const DISCOUNT_CREATE_MUTATION = `#graphql
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) {
              edges {
                node {
                  code
                }
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
