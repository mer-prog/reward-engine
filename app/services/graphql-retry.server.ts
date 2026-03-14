/**
 * GraphQL API call with exponential backoff retry.
 * Retries up to 3 times with delays: 1s, 2s, 4s.
 */
export async function graphqlWithRetry<T>(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  query: string,
  variables?: Record<string, unknown>,
  maxRetries = 3,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await admin.graphql(query, variables ? { variables } : undefined);
      const json = await response.json();

      if (json.errors && json.errors.length > 0) {
        const throttled = json.errors.some(
          (e: { extensions?: { code?: string } }) => e.extensions?.code === "THROTTLED",
        );
        if (throttled && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await sleep(delay);
          continue;
        }
        throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
      }

      return json.data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error("GraphQL request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
