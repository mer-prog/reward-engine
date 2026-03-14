import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  IndexTable,
  EmptyState,
  InlineGrid,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { Condition, Action } from "../services/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [rules, queueStats] = await Promise.all([
    db.rewardRule.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { logs: true } } },
    }),
    getQueueStats(shop),
  ]);

  return { rules, queueStats };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const ruleId = formData.get("ruleId") as string;

  if (intent === "toggle") {
    const rule = await db.rewardRule.findUnique({ where: { id: ruleId } });
    if (rule && rule.shop === session.shop) {
      await db.rewardRule.update({
        where: { id: ruleId },
        data: { isActive: !rule.isActive },
      });
    }
  } else if (intent === "delete") {
    const rule = await db.rewardRule.findUnique({ where: { id: ruleId } });
    if (rule && rule.shop === session.shop) {
      await db.rewardLog.deleteMany({ where: { ruleId } });
      await db.rewardRule.delete({ where: { id: ruleId } });
    }
  }

  return null;
};

async function getQueueStats(shop: string) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [pending, failed, dead, recentCompleted] = await Promise.all([
    db.webhookQueue.count({ where: { shop, status: "pending" } }),
    db.webhookQueue.count({ where: { shop, status: "failed" } }),
    db.webhookQueue.count({ where: { shop, status: "dead" } }),
    db.webhookQueue.count({
      where: {
        shop,
        status: "completed",
        processedAt: { gte: oneHourAgo },
      },
    }),
  ]);

  return { pending, failed, dead, recentCompleted };
}

function summarizeConditions(conditionsJson: string): string {
  try {
    const conditions: Condition[] = JSON.parse(conditionsJson);
    return conditions
      .map((c) => {
        switch (c.type) {
          case "order_total_above":
            return `${c.value}+ spent`;
          case "order_count_equals":
            return `Order #${c.value}`;
          case "order_contains_collection":
            return `Collection: ${c.value}`;
          case "order_item_quantity_above":
            return `${c.value}+ items`;
          default:
            return c.type;
        }
      })
      .join(" AND ");
  } catch {
    return "-";
  }
}

function summarizeAction(actionJson: string): string {
  try {
    const action: Action = JSON.parse(actionJson);
    switch (action.type) {
      case "percentage_discount":
        return `${action.value}% OFF`;
      case "fixed_discount":
        return `${action.value} OFF`;
      case "free_shipping":
        return "Free Shipping";
      default:
        return action.type;
    }
  } catch {
    return "-";
  }
}

export default function Dashboard() {
  const { rules, queueStats } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  return (
    <Page>
      <TitleBar title="RewardEngine">
        <button variant="primary" url="/app/rules/new">
          New Rule
        </button>
      </TitleBar>
      <BlockStack gap="500">
        <InlineGrid columns={4} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Pending
              </Text>
              <Text as="p" variant="headingLg">
                {queueStats.pending}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Failed
              </Text>
              <Text as="p" variant="headingLg" tone="critical">
                {queueStats.failed}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Dead
              </Text>
              <Text as="p" variant="headingLg" tone="critical">
                {queueStats.dead}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Processed (1h)
              </Text>
              <Text as="p" variant="headingLg" tone="success">
                {queueStats.recentCompleted}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Layout>
          <Layout.Section>
            <Card padding="0">
              {rules.length === 0 ? (
                <EmptyState
                  heading="No reward rules yet"
                  action={{
                    content: "Create rule",
                    url: "/app/rules/new",
                  }}
                  image=""
                >
                  <p>
                    Set up conditions and rewards to automatically issue
                    discount codes to your customers.
                  </p>
                </EmptyState>
              ) : (
                <IndexTable
                  itemCount={rules.length}
                  headings={[
                    { title: "Name" },
                    { title: "Conditions" },
                    { title: "Action" },
                    { title: "Status" },
                    { title: "Fired" },
                    { title: "" },
                  ]}
                  selectable={false}
                >
                  {rules.map((rule, index) => (
                    <IndexTable.Row id={rule.id} key={rule.id} position={index}>
                      <IndexTable.Cell>
                        <Button variant="plain" url={`/app/rules/${rule.id}`}>
                          {rule.name}
                        </Button>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {summarizeConditions(rule.conditions)}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {summarizeAction(rule.action)}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={rule.isActive ? "success" : undefined}>
                          {rule.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{rule._count.logs}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            disabled={isLoading}
                            onClick={() => {
                              const fd = new FormData();
                              fd.set("intent", "toggle");
                              fd.set("ruleId", rule.id);
                              submit(fd, { method: "post" });
                            }}
                          >
                            {rule.isActive ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            disabled={isLoading}
                            onClick={() => {
                              const fd = new FormData();
                              fd.set("intent", "delete");
                              fd.set("ruleId", rule.id);
                              submit(fd, { method: "post" });
                            }}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
