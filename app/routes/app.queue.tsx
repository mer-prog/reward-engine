import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Badge,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Filters,
  ChoiceList,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useTranslation } from "../i18n/i18nContext";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const statusFilter = url.searchParams.getAll("status");

  const where: { shop: string; status?: { in: string[] } } = {
    shop: session.shop,
  };
  if (statusFilter.length > 0) {
    where.status = { in: statusFilter };
  }

  const items = await db.webhookQueue.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return { items };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const itemId = formData.get("itemId") as string;

  if (intent === "retry") {
    const item = await db.webhookQueue.findUnique({ where: { id: itemId } });
    if (item && item.shop === session.shop && (item.status === "failed" || item.status === "dead")) {
      await db.webhookQueue.update({
        where: { id: itemId },
        data: { status: "pending", errorMsg: null },
      });
    }
  }

  return null;
};

function statusTone(status: string): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "completed":
      return "success";
    case "pending":
      return "info";
    case "processing":
      return "warning";
    case "failed":
      return "warning";
    case "dead":
      return "critical";
    default:
      return undefined;
  }
}

export default function QueueMonitor() {
  const { items } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state !== "idle";
  const { t } = useTranslation();

  const STATUS_OPTIONS = [
    { label: t("queue.statusOptions.pending"), value: "pending" },
    { label: t("queue.statusOptions.processing"), value: "processing" },
    { label: t("queue.statusOptions.completed"), value: "completed" },
    { label: t("queue.statusOptions.failed"), value: "failed" },
    { label: t("queue.statusOptions.dead"), value: "dead" },
  ];

  const selectedStatuses = searchParams.getAll("status");

  const handleStatusChange = (selected: string[]) => {
    const params = new URLSearchParams();
    selected.forEach((s) => params.append("status", s));
    setSearchParams(params);
  };

  const handleClearAll = () => {
    setSearchParams(new URLSearchParams());
  };

  const statusLabel = (status: string): string => {
    const key = `queue.statusOptions.${status}`;
    const result = t(key);
    return result !== key ? result : status;
  };

  const filters = [
    {
      key: "status",
      label: t("queue.statusLabel"),
      filter: (
        <ChoiceList
          title={t("queue.statusLabel")}
          titleHidden
          choices={STATUS_OPTIONS}
          selected={selectedStatuses}
          onChange={handleStatusChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = selectedStatuses.length > 0
    ? [
        {
          key: "status",
          label: `${t("queue.statusLabel")}: ${selectedStatuses.map((s) => statusLabel(s)).join(", ")}`,
          onRemove: handleClearAll,
        },
      ]
    : [];

  return (
    <Page title={t("queue.title")} backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Filters
              queryValue=""
              onQueryChange={() => {}}
              onQueryClear={() => {}}
              filters={filters}
              appliedFilters={appliedFilters}
              onClearAll={handleClearAll}
              hideQueryField
            />
            {items.length === 0 ? (
              <EmptyState heading={t("queue.emptyHeading")} image="">
                <p>
                  {selectedStatuses.length > 0
                    ? t("queue.emptyFilteredDescription")
                    : t("queue.emptyDescription")}
                </p>
              </EmptyState>
            ) : (
              <IndexTable
                itemCount={items.length}
                headings={[
                  { title: t("queue.tableOrderId") },
                  { title: t("queue.tableStatus") },
                  { title: t("queue.tableRetries") },
                  { title: t("queue.tableError") },
                  { title: t("queue.tableCreated") },
                  { title: t("queue.tableProcessed") },
                  { title: "" },
                ]}
                selectable={false}
              >
                {items.map((item, index) => (
                  <IndexTable.Row id={item.id} key={item.id} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {item.orderId.replace("gid://shopify/Order/", "#")}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={statusTone(item.status)}>
                        {statusLabel(item.status)}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{item.retryCount}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" truncate>
                        {item.errorMsg ?? "-"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {new Date(item.createdAt).toLocaleString()}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {item.processedAt
                        ? new Date(item.processedAt).toLocaleString()
                        : "-"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {(item.status === "failed" || item.status === "dead") && (
                        <Button
                          size="slim"
                          disabled={isLoading}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("intent", "retry");
                            fd.set("itemId", item.id);
                            submit(fd, { method: "post" });
                          }}
                        >
                          {t("queue.retry")}
                        </Button>
                      )}
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
