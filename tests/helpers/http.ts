export async function readJson<T = Record<string, unknown>>(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as T,
  };
}

export function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
