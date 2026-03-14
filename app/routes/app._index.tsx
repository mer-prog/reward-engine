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
import { useTranslation } from "../i18n/i18nContext";

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

export default function Dashboard() {
  const { rules, queueStats } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";
  const { t } = useTranslation();

  function summarizeConditions(conditionsJson: string): string {
    try {
      const conditions: Condition[] = JSON.parse(conditionsJson);
      return conditions
        .map((c) => {
          switch (c.type) {
            case "order_total_above":
              return t("conditions.spent", { value: c.value });
            case "order_count_equals":
              return t("conditions.orderNumber", { value: c.value });
            case "order_contains_collection":
              return t("conditions.collection", { value: c.value });
            case "order_item_quantity_above":
              return t("conditions.items", { value: c.value });
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
          return t("actions.percentOff", { value: action.value ?? 0 });
        case "fixed_discount":
          return t("actions.fixedOff", { value: action.value ?? 0 });
        case "free_shipping":
          return t("actions.freeShipping");
        default:
          return action.type;
      }
    } catch {
      return "-";
    }
  }

  return (
    <Page>
      <TitleBar title={t("dashboard.title")} />
      <BlockStack gap="500">
        <InlineGrid columns={4} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {t("dashboard.pending")}
              </Text>
              <Text as="p" variant="headingLg">
                {queueStats.pending}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {t("dashboard.failed")}
              </Text>
              <Text as="p" variant="headingLg" tone="critical">
                {queueStats.failed}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {t("dashboard.dead")}
              </Text>
              <Text as="p" variant="headingLg" tone="critical">
                {queueStats.dead}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {t("dashboard.processedOneHour")}
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
                  heading={t("dashboard.emptyHeading")}
                  action={{
                    content: t("dashboard.createRule"),
                    url: "/app/rules/new",
                  }}
                  image=""
                >
                  <p>{t("dashboard.emptyDescription")}</p>
                </EmptyState>
              ) : (
                <IndexTable
                  itemCount={rules.length}
                  headings={[
                    { title: t("dashboard.tableHeadingName") },
                    { title: t("dashboard.tableHeadingConditions") },
                    { title: t("dashboard.tableHeadingAction") },
                    { title: t("dashboard.tableHeadingStatus") },
                    { title: t("dashboard.tableHeadingFired") },
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
                          {rule.isActive
                            ? t("dashboard.active")
                            : t("dashboard.inactive")}
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
                            {rule.isActive
                              ? t("dashboard.disable")
                              : t("dashboard.enable")}
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
                            {t("dashboard.delete")}
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
