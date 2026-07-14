export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();
let globalRedirecting = false;

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function notifyUnauthorized(): void {
  if (globalRedirecting) return;
  globalRedirecting = true;
  for (const listener of unauthorizedListeners) {
    try {
      listener();
    } catch {
      // swallow listener errors to avoid breaking fetch chain
    }
  }
  setTimeout(() => { globalRedirecting = false; }, 0);
}

export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    init.signal = options.signal;
  }

  const response = await fetch(url, init);

  if (response.status === 401) {
    notifyUnauthorized();
  }

  let data: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const code = (data as { error?: string } | null)?.error ?? `http_${response.status}`;
    throw new ApiError(response.status, code, code);
  }

  return data as T;
}
