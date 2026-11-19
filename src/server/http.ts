export class ProviderError extends Error {
  constructor(message: string, readonly status = 502, readonly code = "provider_error") {
    super(message);
  }
}

export async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
    if (!r.ok) throw new ProviderError(`${new URL(url).host} answered ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`Could not reach ${new URL(url).host}`);
  } finally {
    clearTimeout(t);
  }
}

export function jsonError(e: unknown) {
  if (!(e instanceof ProviderError)) console.error(e);
  // Internal errors (database, Stripe) are logged, never shown to the browser as is.
  const err = e instanceof ProviderError ? e : new ProviderError("Something went wrong on our side. Try again in a moment.", 500, "internal");
  return Response.json({ error: err.code, message: err.message }, { status: err.status });
}
