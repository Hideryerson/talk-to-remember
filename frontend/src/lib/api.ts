const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  "";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL?.trim() ||
  process.env.NEXT_PUBLIC_BACKEND_WS_URL?.trim() ||
  process.env.NEXT_PUBLIC_WS_PROXY_URL?.trim() ||
  "";

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
  const url = `${trimTrailingSlash(BACKEND_URL)}${normalizedPath}`;

  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    url.startsWith("http://")
  ) {
    throw new Error("NEXT_PUBLIC_BACKEND_URL must use https:// on an https site.");
  }

  return url;
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
