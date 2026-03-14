import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Divider,
  Checkbox,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { Condition, ConditionType, ActionType, Action } from "../services/types";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rule = await db.rewardRule.findUnique({
    where: { id: params.id },
  });

  if (!rule || rule.shop !== session.shop) {
    throw new Response("Not Found", { status: 404 });
  }

  return json({ rule });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const rule = await db.rewardRule.findUnique({ where: { id: params.id } });
  if (!rule || rule.shop !== session.shop) {
    throw new Response("Not Found", { status: 404 });
  }

  const name = formData.get("name") as string;
  const conditions = formData.get("conditions") as string;
  const actionData = formData.get("action") as string;
  const usageLimit = formData.get("usageLimit") as string;
  const validFrom = formData.get("validFrom") as string;
  const validUntil = formData.get("validUntil") as string;

  if (!name || !conditions || !actionData) {
    return json({ error: "Name, conditions, and action are required." });
  }

  await db.rewardRule.update({
    where: { id: params.id },
    data: {
      name,
      conditions,
      action: actionData,
      usageLimit: usageLimit ? parseInt(usageLimit, 10) : null,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
    },
  });

  return redirect("/app");
};

const CONDITION_TYPES: { value: ConditionType; label: string }[] = [
  { value: "order_total_above", label: "Order total above" },
  { value: "order_count_equals", label: "Order count equals" },
  { value: "order_contains_collection", label: "Order contains collection" },
  { value: "order_item_quantity_above", label: "Item quantity above" },
];

const ACTION_TYPES: { value: ActionType; label: string }[] = [
  { value: "percentage_discount", label: "Percentage discount" },
  { value: "fixed_discount", label: "Fixed amount discount" },
  { value: "free_shipping", label: "Free shipping" },
];

function conditionValueLabel(type: ConditionType): string {
  switch (type) {
    case "order_total_above":
      return "Amount (e.g. 5000)";
    case "order_count_equals":
      return "Order number (e.g. 3)";
    case "order_contains_collection":
      return "Collection handle";
    case "order_item_quantity_above":
      return "Quantity (e.g. 5)";
  }
}

function actionValueLabel(type: ActionType): string {
  switch (type) {
    case "percentage_discount":
      return "Discount % (e.g. 10)";
    case "fixed_discount":
      return "Discount amount (e.g. 500)";
    case "free_shipping":
      return "";
  }
}

export default function EditRule() {
  const { rule } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const parsedConditions: { type: ConditionType; value: string }[] = (() => {
    try {
      return (JSON.parse(rule.conditions) as Condition[]).map((c) => ({
        type: c.type,
        value: String(c.value),
      }));
    } catch {
      return [{ type: "order_total_above" as ConditionType, value: "" }];
    }
  })();

  const parsedAction: Action = (() => {
    try {
      return JSON.parse(rule.action);
    } catch {
      return { type: "percentage_discount" as ActionType, value: 10 };
    }
  })();

  const [name, setName] = useState(rule.name);
  const [conditions, setConditions] = useState(parsedConditions);
  const [actionType, setActionType] = useState<ActionType>(parsedAction.type);
  const [actionValue, setActionValue] = useState(
    String(parsedAction.value ?? ""),
  );
  const [actionTitle, setActionTitle] = useState(parsedAction.title ?? "");
  const [usageLimit, setUsageLimit] = useState(
    rule.usageLimit != null ? String(rule.usageLimit) : "",
  );
  const [hasUsageLimit, setHasUsageLimit] = useState(rule.usageLimit != null);
  const [validFrom, setValidFrom] = useState(
    rule.validFrom ? rule.validFrom.split("T")[0] : "",
  );
  const [validUntil, setValidUntil] = useState(
    rule.validUntil ? rule.validUntil.split("T")[0] : "",
  );
  const [hasDateRange, setHasDateRange] = useState(
    !!(rule.validFrom || rule.validUntil),
  );

  const addCondition = () => {
    setConditions([...conditions, { type: "order_total_above", value: "" }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (
    index: number,
    field: "type" | "value",
    val: string,
  ) => {
    const updated = [...conditions];
    if (field === "type") {
      updated[index] = { ...updated[index], type: val as ConditionType };
    } else {
      updated[index] = { ...updated[index], value: val };
    }
    setConditions(updated);
  };

  const handleSubmit = () => {
    const conditionsPayload: Condition[] = conditions.map((c) => ({
      type: c.type,
      value:
        c.type === "order_contains_collection" ? c.value : Number(c.value),
    }));

    const actionPayload = {
      type: actionType,
      ...(actionType !== "free_shipping" ? { value: Number(actionValue) } : {}),
      ...(actionTitle ? { title: actionTitle } : {}),
    };

    const fd = new FormData();
    fd.set("name", name);
    fd.set("conditions", JSON.stringify(conditionsPayload));
    fd.set("action", JSON.stringify(actionPayload));
    if (hasUsageLimit && usageLimit) fd.set("usageLimit", usageLimit);
    if (hasDateRange && validFrom) fd.set("validFrom", validFrom);
    if (hasDateRange && validUntil) fd.set("validUntil", validUntil);

    submit(fd, { method: "post" });
  };

  const isValid =
    name.trim() !== "" &&
    conditions.every((c) => c.value.trim() !== "") &&
    (actionType === "free_shipping" || actionValue.trim() !== "");

  return (
    <Page
      title="Edit Rule"
      backAction={{ url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Basic Info
                </Text>
                <TextField
                  label="Rule name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Conditions (AND)
                </Text>
                <Banner tone="info">
                  All conditions must be met for the reward to trigger.
                </Banner>
                {conditions.map((condition, index) => (
                  <InlineStack key={index} gap="300" align="start" blockAlign="end">
                    <div style={{ flex: 1 }}>
                      <Select
                        label="Type"
                        options={CONDITION_TYPES}
                        value={condition.type}
                        onChange={(val) => updateCondition(index, "type", val)}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label={conditionValueLabel(condition.type)}
                        value={condition.value}
                        onChange={(val) => updateCondition(index, "value", val)}
                        autoComplete="off"
                      />
                    </div>
                    {conditions.length > 1 && (
                      <Button
                        tone="critical"
                        onClick={() => removeCondition(index)}
                      >
                        Remove
                      </Button>
                    )}
                  </InlineStack>
                ))}
                <Button onClick={addCondition}>Add condition</Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Action
                </Text>
                <FormLayout>
                  <Select
                    label="Action type"
                    options={ACTION_TYPES}
                    value={actionType}
                    onChange={(val) => setActionType(val as ActionType)}
                  />
                  {actionType !== "free_shipping" && (
                    <TextField
                      label={actionValueLabel(actionType)}
                      value={actionValue}
                      onChange={setActionValue}
                      type="number"
                      autoComplete="off"
                    />
                  )}
                  <TextField
                    label="Coupon title (optional)"
                    value={actionTitle}
                    onChange={setActionTitle}
                    autoComplete="off"
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Options
                </Text>
                <Checkbox
                  label="Set usage limit"
                  checked={hasUsageLimit}
                  onChange={setHasUsageLimit}
                />
                {hasUsageLimit && (
                  <TextField
                    label="Max usage count"
                    value={usageLimit}
                    onChange={setUsageLimit}
                    type="number"
                    autoComplete="off"
                  />
                )}
                <Divider />
                <Checkbox
                  label="Set validity period"
                  checked={hasDateRange}
                  onChange={setHasDateRange}
                />
                {hasDateRange && (
                  <InlineStack gap="300">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Valid from"
                        value={validFrom}
                        onChange={setValidFrom}
                        type="date"
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Valid until"
                        value={validUntil}
                        onChange={setValidUntil}
                        type="date"
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            <InlineStack align="end">
              <Button
                variant="primary"
                disabled={!isValid || isSubmitting}
                loading={isSubmitting}
                onClick={handleSubmit}
              >
                Save Rule
              </Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
