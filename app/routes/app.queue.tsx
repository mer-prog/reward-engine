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

const STATUS_OPTIONS = [
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Dead", value: "dead" },
];

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

  const selectedStatuses = searchParams.getAll("status");

  const handleStatusChange = (selected: string[]) => {
    const params = new URLSearchParams();
    selected.forEach((s) => params.append("status", s));
    setSearchParams(params);
  };

  const handleClearAll = () => {
    setSearchParams(new URLSearchParams());
  };

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
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
          label: `Status: ${selectedStatuses.join(", ")}`,
          onRemove: handleClearAll,
        },
      ]
    : [];

  return (
    <Page title="Queue Monitor" backAction={{ url: "/app" }}>
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
              <EmptyState heading="No queue items" image="">
                <p>
                  {selectedStatuses.length > 0
                    ? "No items match the selected filters."
                    : "No webhook events have been received yet."}
                </p>
              </EmptyState>
            ) : (
              <IndexTable
                itemCount={items.length}
                headings={[
                  { title: "Order ID" },
                  { title: "Status" },
                  { title: "Retries" },
                  { title: "Error" },
                  { title: "Created" },
                  { title: "Processed" },
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
                        {item.status}
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
                          Retry
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
