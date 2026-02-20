const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL?.trim() || "";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeApiPath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path;
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = normalizeApiPath(path);
  if (!BACKEND_URL) {
    return normalizedPath;
  }
  return `${trimTrailingSlash(BACKEND_URL)}${normalizedPath}`;
}

export function getBackendWsUrl(): string | null {
  if (!WS_URL) {
    return null;
  }

  const url = trimTrailingSlash(WS_URL);
  if (!/^wss?:\/\//i.test(url)) {
    throw new Error("NEXT_PUBLIC_WS_URL must start with ws:// or wss://");
  }

  return url;
}
