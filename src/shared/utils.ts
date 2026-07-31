// 共享小工具（canvas-v2-prd §5.2 C0 拆分）。叶子模块：不 import App.tsx / ../canvas/*。

export const LOG_TEXT_LIMIT = 800;

export function uid() {
  return crypto.randomUUID();
}

export function getClientId() {
  const storageKey = "imageStudioClientId";
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const next = uid();
  localStorage.setItem(storageKey, next);
  return next;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function truncateForLog(value: string, limit = LOG_TEXT_LIMIT) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...(${value.length} chars)`;
}

export async function readApiJson<T>(response: Response, endpoint: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const looksHtml = /^\s*</.test(text);
    throw {
      status: response.status,
      endpoint,
      contentType,
      error: looksHtml
        ? "服务返回了 HTML，不是 JSON。线上通常是 /api 路由未命中、请求体过大、网关拦截或部署平台返回了错误页。"
        : "服务返回了不可解析的 JSON。",
      raw: truncateForLog(text, 1600),
    };
  }
}
