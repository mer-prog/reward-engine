import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useTranslation } from "../i18n/i18nContext";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const logs = await db.rewardLog.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { rule: { select: { name: true } } },
  });

  return { logs };
};

function actionTone(type: string): "success" | "info" | undefined {
  switch (type) {
    case "percentage_discount":
      return "success";
    case "fixed_discount":
      return "info";
    case "free_shipping":
      return "success";
    default:
      return undefined;
  }
}

export default function ActivityLog() {
  const { logs } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  function actionLabel(type: string): string {
    const key = `activity.actionLabels.${type}` as const;
    const result = t(key);
    return result !== key ? result : type;
  }

  return (
    <Page title={t("activity.title")} backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {logs.length === 0 ? (
              <EmptyState heading={t("activity.emptyHeading")} image="">
                <p>{t("activity.emptyDescription")}</p>
              </EmptyState>
            ) : (
              <IndexTable
                itemCount={logs.length}
                headings={[
                  { title: t("activity.tableDate") },
                  { title: t("activity.tableCustomer") },
                  { title: t("activity.tableOrder") },
                  { title: t("activity.tableRule") },
                  { title: t("activity.tableAction") },
                  { title: t("activity.tableDiscountCode") },
                ]}
                selectable={false}
              >
                {logs.map((log, index) => (
                  <IndexTable.Row id={log.id} key={log.id} position={index}>
                    <IndexTable.Cell>
                      {new Date(log.createdAt).toLocaleString()}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {log.customerId.replace("gid://shopify/Customer/", "#")}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {log.orderId.replace("gid://shopify/Order/", "#")}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">
                        {log.rule.name}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={actionTone(log.actionType)}>
                        {actionLabel(log.actionType)}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        {log.discountCode ?? "-"}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
