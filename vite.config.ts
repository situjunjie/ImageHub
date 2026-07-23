import react from "@vitejs/plugin-react";
import { Buffer } from "node:buffer";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { defineConfig, loadEnv, type PluginOption, type ViteDevServer } from "vite";

const _env = loadEnv("development", process.cwd(), "");
for (const key of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "OAUTH_PROVIDER_URL", "OAUTH_REDIRECT_URI"]) {
  if (_env[key] && !process.env[key]) process.env[key] = _env[key];
}

type ImageProtocol =
  | "custom-openai"
  | "openai-images"
  | "openai-responses"
  | "gemini-native"
  | "gemini-openai"
  | "google-imagen"
  | "stability-core";

type ProxyBody = Record<string, unknown>;

type ReferenceImage = {
  dataUrl: string;
  name: string;
  type: string;
};

type ReferenceUrlPayload = {
  field: "image";
  urls: string[];
  mode: string;
  cleanup?: () => void;
};

type GenerateRequest = {
  protocol?: ImageProtocol;
  model?: string;
  prompt?: string;
  size?: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  outputFormat?: string;
  seed?: string;
  negativePrompt?: string;
  referenceImages?: ReferenceImage[];
};

type GenerateBody = {
  baseUrl?: string;
  apiKey?: string;
  clientId?: string;
  request?: GenerateRequest & {
    batchId?: string;
    index?: number;
    total?: number;
  };
};

type ImageResult = {
  ok: true;
  status?: number;
  images: Array<{ dataUrl: string; revisedPrompt?: string }>;
  raw?: unknown;
} | {
  ok: false;
  status?: number;
  detail?: unknown;
};

type AdminUser = {
  username: string;
  passwordHash: string;
  salt: string;
  mustChangePassword: boolean;
  createdAt: number;
  updatedAt: number;
};

type RequestLogStatus = "running" | "success" | "error";
type RequestLogType = "image_generation" | "prompt_analysis" | "agent_analysis";

type RequestLog = {
  requestId: string;
  requestType: RequestLogType;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  clientId: string;
  clientUserAgent: string;
  clientIpHash: string;
  protocol: ImageProtocol;
  apiBaseUrl: string;
  apiKeyPresent?: boolean;
  apiKeyLength?: number;
  apiKeyPrefix?: string;
  apiKeySuffix?: string;
  endpoint: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  size?: string;
  resolution?: string;
  quality?: string;
  outputFormat?: string;
  seed?: string;
  agentId?: string;
  agentName?: string;
  agentScenario?: string;
  promptVariant?: string;
  referenceCount: number;
  referenceTotalBytes?: number;
  referenceUploadStatus?: "none" | "received" | "forwarded" | "succeeded" | "failed";
  upstreamPayloadKeys?: string[];
  upstreamReferenceCount?: number;
  upstreamReferenceMode?: string;
  upstreamSize?: string;
  requestParams?: unknown;
  upstreamRequest?: unknown;
  responseBody?: unknown;
  status: RequestLogStatus;
  httpStatus?: number;
  errorMessage?: string;
  errorType?: string;
  errorCode?: string;
  errorRaw?: string;
  errorFull?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  imageSaved: boolean;
  savedImages?: SavedImageMeta[];
  stages?: RequestStages;
};

type SavedImageMeta = {
  id: string;
  mime: string;
  bytes: number;
};

type RequestStages = {
  receivedAt?: number;
  upstreamRequestedAt?: number;
  upstreamRespondedAt?: number;
  imageSavedAt?: number;
  returnedAt?: number;
};

type AdminAuditLog = {
  id: string;
  action: string;
  username: string;
  createdAt: number;
  detail?: string;
};

type AdminStore = {
  admins: AdminUser[];
  requestLogs: RequestLog[];
  auditLogs: AdminAuditLog[];
};

type SquareFeedTab = "latest" | "hot" | "top_day" | "top_week" | "top_month";
type SquareActionResult = "added" | "replaced" | "rejected" | "liked" | "unliked" | "noop";

type SquareItem = {
  id: string;
  imageId: string;
  requestId?: string;
  thumbnailDataUrl: string;
  imageHash: string;
  prompt: string;
  caption: string;
  model: string;
  params: Record<string, unknown>;
  width?: number;
  height?: number;
  aspectRatio?: string;
  sourceType: string;
  reasonPlan?: unknown;
  recommenderHash: string;
  recommenderLabel: string;
  pageLabel?: string;
  active: boolean;
  featured?: boolean;
  likeCount: number;
  qualityScore: number;
  trustScore: number;
  createdAt: number;
  updatedAt: number;
  replacedById?: string;
};

type SquareRecommendLog = {
  id: string;
  requestId: string;
  apiKeyHash: string;
  imageId?: string;
  itemId?: string;
  action: SquareActionResult;
  result: "success" | "rejected" | "error";
  reasonCode: string;
  replacedItemId?: string;
  remainingDailyQuota: number;
  remainingShelfSlots: number;
  ipHash: string;
  uaHash: string;
  promptHash?: string;
  imageHash?: string;
  sourceType?: string;
  timestamp: number;
};

type SquareLikeLog = {
  id: string;
  requestId: string;
  apiKeyHash: string;
  itemId: string;
  action: "like" | "unlike";
  result: "success" | "rejected" | "noop" | "error";
  reasonCode: string;
  likeCount: number;
  remainingLikeQuota: number;
  ipHash: string;
  uaHash: string;
  timestamp: number;
};

type SquareLikeState = {
  apiKeyHash: string;
  itemId: string;
  liked: boolean;
  createdAt: number;
  updatedAt: number;
};

type SquareQuotaDaily = {
  apiKeyHash: string;
  dateKey: string;
  dailyRecommendUsed: number;
  dailyLikeUsed: number;
  firstSeenAt: number;
  updatedAt: number;
};

type SquareModerationAudit = {
  id: string;
  requestId: string;
  apiKeyHash: string;
  itemId?: string;
  imageId?: string;
  event: string;
  reasonCode: string;
  severity: "low" | "medium" | "high";
  ipHash: string;
  uaHash: string;
  timestamp: number;
  detail?: unknown;
};

type SquareStore = {
  items: SquareItem[];
  recommendLogs: SquareRecommendLog[];
  likeLogs: SquareLikeLog[];
  likes: SquareLikeState[];
  quotas: SquareQuotaDaily[];
  moderationAudits: SquareModerationAudit[];
};

const API_TIMEOUT_MS = 300_000;
const MAX_REQUEST_BYTES = 60 * 1024 * 1024;
const DEFAULT_PROTOCOL: ImageProtocol = "custom-openai";
const GPT_IMAGE_2_MODEL = "gpt-image-2";
const GPT_IMAGE_2_PRO_MODEL = "gpt-image-2-pro";
const GPT_IMAGE_2_FAMILY_MODEL = "gpt-5.4-image-2";
const GEMINI_3_PRO_IMAGE_MODEL = "gemini-3-pro-image-preview";
const GEMINI_NATIVE_API_PREFIX = "/v1beta";
const ALLOWED_API_BASE_URLS: string[] = ["https://www.taijiai.online/", "https://bobdong.cn/"];
const SESSION_COOKIE = "image_studio_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const DATA_DIR = join(process.cwd(), ".data");
const ADMIN_STORE_PATH = join(DATA_DIR, "admin-store.json");
const SQUARE_STORE_PATH = join(DATA_DIR, "square-store.json");
const LOCAL_IMAGE_DIR = join(DATA_DIR, "images");
const LOCAL_IMAGE_URL_PREFIX = "/api/images/local/";
// 相对路径形如 <用户目录>/<文件名>.<ext>，用户目录与文件名均限制安全字符、禁止路径穿越
const LOCAL_IMAGE_PATH_PATTERN = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,120}\.(png|jpg|webp|gif)$/;
const REFERENCE_TEMP_TTL_MS = 1000 * 60 * 10;
const PUBLIC_REFERENCE_BASE_URL = "https://imagehub.taijiai.online";
const SQUARE_TIME_ZONE = "Asia/Shanghai";
const OAUTH_CLIENT_ID = (process.env.OAUTH_CLIENT_ID || "").trim();
const OAUTH_CLIENT_SECRET = (process.env.OAUTH_CLIENT_SECRET || "").trim();
const OAUTH_PROVIDER_URL = (process.env.OAUTH_PROVIDER_URL || "https://www.taijiai.online").replace(/\/+$/, "");
const OAUTH_REDIRECT_URI = (process.env.OAUTH_REDIRECT_URI || "").trim();
const OAUTH_ENABLED = OAUTH_CLIENT_ID.length > 0 && OAUTH_CLIENT_SECRET.length > 0;
const OAUTH_SESSION_COOKIE = "imagehub_oauth_session";
const OAUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;
if (OAUTH_ENABLED && OAUTH_PROVIDER_URL && !ALLOWED_API_BASE_URLS.some((url) => url.replace(/\/+$/, "") === OAUTH_PROVIDER_URL)) {
  ALLOWED_API_BASE_URLS.push(OAUTH_PROVIDER_URL);
}
const SQUARE_SHELF_LIMIT = 4;
const SQUARE_DAILY_RECOMMEND_LIMIT = 10;
const SQUARE_DAILY_LIKE_LIMIT = 10;
const SQUARE_MAX_FEED_LIMIT = 20;
const SQUARE_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const CONFIG_STORE_PATH = join(DATA_DIR, "config-store.json");
const DEFAULT_AGENT_ANALYZE_SYSTEM_PROMPT = [
  "你是一个图片生成 Agent 的任务拆解器。",
  "你要识别用户当前输入属于 single_image、multi_image_batch、brochure_project 或 page_refine 哪一种。",
  "如果是多图任务，要尽量拆成逐张独立 job；如果只是说明总张数但没有逐张差异，也可以返回 1 个 job 并把 count 设为总数。",
  "如果是宣传画册任务，不要直接输出 jobs，而是返回 brochureProject，包含 title, companyName, industry, purpose, pageCount, summary, outline, styleDirections, requestPrompt。",
  "outline 每项包含 pageNo, role, title, objective。styleDirections 返回 3 到 6 个方向。",
  "如果是 page_refine，需要输出 1 个 job，说明是某一页单独重做。",
  "只返回 JSON，不要使用 Markdown。",
  "JSON 顶层字段必须包含 intentType, confidence, reasoningSummary, estimatedCostLevel, requiresConfirmation, autoExecute, jobs, brochureProject。",
  "estimatedCostLevel 只能是 low、medium、high。confidence 范围 0 到 1。",
  "每个 job 可包含 id, title, prompt, objective, negativePrompt, aspectRatio, size, resolution, quality, count。",
].join("\n");
const DEFAULT_PROMPT_ANALYZE_SYSTEM_PROMPT = [
  "你是一个专业的 GPT 生图发送前分析器。",
  "你的任务是判断提示词是否适合进入生图流程，并给出提示词优化、参数推荐、失败预判和风格增强。",
  "只返回 JSON，不要使用 Markdown。",
  "JSON 字段必须包含 safe, score, riskLevel, summary, optimizedPrompt, suggestedNegativePrompt, suggestedParams, risks, styleEnhancements。",
  "riskLevel 只能是 low、medium、high。safe=false 仅用于高风险或大概率失败场景。",
  "suggestedParams 可包含 aspectRatio, size, resolution, count, quality, styleStrength, referenceWeight。",
  "risks 每项包含 level, title, description, fix。styleEnhancements 每项包含 name, description, promptFragment。",
  "优化提示词时要保留用户原意，不要替换主体，不要加入未授权的具体人物身份。",
].join("\n");

const temporaryReferences = new Map<string, {
  bytes: Buffer;
  mime: string;
  name: string;
  expiresAt: number;
}>();

const FRONTEND_BUILD_TIME_ZONE = "Asia/Shanghai";
const FRONTEND_BUILD_DATE = new Date();

function frontendDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: FRONTEND_BUILD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

function formatFrontendVersion(date: Date) {
  const parts = frontendDateParts(date);
  const pad = (item: number, length = 2) => String(item).padStart(length, "0");
  return [
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    pad(date.getMilliseconds(), 3),
  ].join("");
}

function formatFrontendBuiltAtLocal(date: Date) {
  const parts = frontendDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${String(date.getMilliseconds()).padStart(3, "0")} ${FRONTEND_BUILD_TIME_ZONE}`;
}

function createFrontendBuildVersion() {
  const explicitVersion = process.env.FRONTEND_BUILD_VERSION?.trim();
  if (explicitVersion) return explicitVersion.replace(/[^a-zA-Z0-9._-]/g, "");
  return formatFrontendVersion(FRONTEND_BUILD_DATE);
}

const FRONTEND_BUILD_VERSION = createFrontendBuildVersion();
const FRONTEND_BUILD_INFO = {
  version: FRONTEND_BUILD_VERSION,
  builtAt: FRONTEND_BUILD_DATE.toISOString(),
  builtAtLocal: formatFrontendBuiltAtLocal(FRONTEND_BUILD_DATE),
  timeZone: FRONTEND_BUILD_TIME_ZONE,
};

const adminSessions = new Map<string, { username: string; expiresAt: number }>();

interface OAuthSessionData {
  sub: string;
  username: string;
  displayName: string;
  email: string;
  role: number;
  group: string;
  apiKey: string;
  expiresAt: number;
}
const oauthSessions = new Map<string, OAuthSessionData>();
const oauthPendingStates = new Map<string, { expiresAt: number }>();

const DEFAULT_MODELS: Record<ImageProtocol, string[]> = {
  "custom-openai": [GPT_IMAGE_2_MODEL, GPT_IMAGE_2_PRO_MODEL, GPT_IMAGE_2_FAMILY_MODEL],
  "openai-images": [GPT_IMAGE_2_MODEL, GPT_IMAGE_2_PRO_MODEL, GPT_IMAGE_2_FAMILY_MODEL],
  "openai-responses": ["gpt-4.1", "gpt-4.1-mini"],
  "gemini-native": [GEMINI_3_PRO_IMAGE_MODEL, "gemini-2.5-flash-image", "gemini-2.0-flash-preview-image-generation"],
  "gemini-openai": ["gemini-2.5-flash-image"],
  "google-imagen": ["imagen-4.0-generate-001", "imagen-4.0-ultra-generate-001", "imagen-3.0-generate-002"],
  "stability-core": ["stable-image-core", "stable-image-ultra"],
};

const PROTOCOLS = Object.keys(DEFAULT_MODELS) as ImageProtocol[];

function readJsonBody(req: IncomingMessage): Promise<ProxyBody> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_REQUEST_BYTES) {
        reject(new Error("请求体过大，请减少参考图数量或压缩图片"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return { salt, passwordHash: derived };
}

function verifyPassword(password: string, user: AdminUser) {
  const derived = scryptSync(password, user.salt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

function emptyStore(): AdminStore {
  return {
    admins: [],
    requestLogs: [],
    auditLogs: [],
  };
}

function ensureAdminStore() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(ADMIN_STORE_PATH)) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || "admin123456";
    const { salt, passwordHash } = hashPassword(initialPassword);
    const now = Date.now();
    const store: AdminStore = {
      admins: [{
        username,
        salt,
        passwordHash,
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      }],
      requestLogs: [],
      auditLogs: [{
        id: randomUUID(),
        action: "admin_initialized",
        username,
        createdAt: now,
        detail: "Default administrator created. Password reset required on first login.",
      }],
    };
    writeFileSync(ADMIN_STORE_PATH, JSON.stringify(store, null, 2));
  }
}

function readAdminStore(): AdminStore {
  ensureAdminStore();
  try {
    return { ...emptyStore(), ...JSON.parse(readFileSync(ADMIN_STORE_PATH, "utf8")) };
  } catch {
    return emptyStore();
  }
}

function writeAdminStore(store: AdminStore) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ADMIN_STORE_PATH, JSON.stringify(store, null, 2));
}

function emptySquareStore(): SquareStore {
  return {
    items: [],
    recommendLogs: [],
    likeLogs: [],
    likes: [],
    quotas: [],
    moderationAudits: [],
  };
}

function ensureSquareStore() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(SQUARE_STORE_PATH)) {
    writeFileSync(SQUARE_STORE_PATH, JSON.stringify(emptySquareStore(), null, 2));
  }
}

function readSquareStore(): SquareStore {
  ensureSquareStore();
  try {
    const parsed = JSON.parse(readFileSync(SQUARE_STORE_PATH, "utf8"));
    return {
      ...emptySquareStore(),
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      recommendLogs: Array.isArray(parsed.recommendLogs) ? parsed.recommendLogs : [],
      likeLogs: Array.isArray(parsed.likeLogs) ? parsed.likeLogs : [],
      likes: Array.isArray(parsed.likes) ? parsed.likes : [],
      quotas: Array.isArray(parsed.quotas) ? parsed.quotas : [],
      moderationAudits: Array.isArray(parsed.moderationAudits) ? parsed.moderationAudits : [],
    };
  } catch {
    return emptySquareStore();
  }
}

function writeSquareStore(store: SquareStore) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  store.items = store.items.slice(0, 2500);
  store.recommendLogs = store.recommendLogs.slice(0, 5000);
  store.likeLogs = store.likeLogs.slice(0, 8000);
  store.likes = store.likes.slice(0, 12000);
  store.quotas = store.quotas.slice(0, 5000);
  store.moderationAudits = store.moderationAudits.slice(0, 5000);
  writeFileSync(SQUARE_STORE_PATH, JSON.stringify(store, null, 2));
}

function appendAuditLog(username: string, action: string, detail?: string) {
  const store = readAdminStore();
  store.auditLogs.unshift({
    id: randomUUID(),
    username,
    action,
    detail,
    createdAt: Date.now(),
  });
  store.auditLogs = store.auditLogs.slice(0, 500);
  writeAdminStore(store);
}

type ConfigUpstream = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  note?: string;
  sort: number;
};

type ConfigModel = {
  id: string;
  displayName: string;
  sizing: "explicit-2k4k" | "official-1k";
  enabled: boolean;
  sort: number;
  tags?: string[];
};

type ConfigStore = {
  version: number;
  updatedAt: string;
  upstreams: ConfigUpstream[];
  models: ConfigModel[];
  presets: {
    promptStarters: unknown[] | null;
    stylePresets: unknown[] | null;
    industryAgents: unknown[] | null;
    negativePrompt: string | null;
  };
  systemPrompts: {
    agentAnalyze: string;
    promptAnalyze: string;
  };
  quotas: {
    squareShelfLimit: number;
    squareDailyRecommend: number;
    squareDailyLike: number;
    squareMaxFeed: number;
    generationDailyLimit: number;
    userDiskLimitMB: number;
  };
};

function defaultConfigStore(): ConfigStore {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    upstreams: [
      { id: "taiji", name: "太极 AI", baseUrl: "https://www.taijiai.online/", enabled: true, note: "主服务地址", sort: 1 },
      { id: "bobdong", name: "BobDong", baseUrl: "https://bobdong.cn/", enabled: true, note: "备用服务地址", sort: 2 },
    ],
    models: [
      { id: GPT_IMAGE_2_MODEL, displayName: "GPT Image 2", sizing: "explicit-2k4k", enabled: true, sort: 1, tags: ["2K", "4K"] },
      { id: GPT_IMAGE_2_PRO_MODEL, displayName: "GPT Image 2 Pro", sizing: "explicit-2k4k", enabled: true, sort: 2, tags: ["2K", "4K"] },
      { id: GPT_IMAGE_2_FAMILY_MODEL, displayName: "GPT 5.4 Image 2", sizing: "official-1k", enabled: true, sort: 3, tags: [] },
      { id: GEMINI_3_PRO_IMAGE_MODEL, displayName: "Gemini 3 Pro Image", sizing: "official-1k", enabled: true, sort: 4, tags: [] },
    ],
    presets: {
      promptStarters: null,
      stylePresets: null,
      industryAgents: null,
      negativePrompt: null,
    },
    systemPrompts: {
      agentAnalyze: DEFAULT_AGENT_ANALYZE_SYSTEM_PROMPT,
      promptAnalyze: DEFAULT_PROMPT_ANALYZE_SYSTEM_PROMPT,
    },
    quotas: {
      squareShelfLimit: SQUARE_SHELF_LIMIT,
      squareDailyRecommend: SQUARE_DAILY_RECOMMEND_LIMIT,
      squareDailyLike: SQUARE_DAILY_LIKE_LIMIT,
      squareMaxFeed: SQUARE_MAX_FEED_LIMIT,
      generationDailyLimit: 0,
      userDiskLimitMB: 0,
    },
  };
}

let configStoreCache: ConfigStore | null = null;

function ensureConfigStore() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(CONFIG_STORE_PATH)) {
    writeFileSync(CONFIG_STORE_PATH, JSON.stringify(defaultConfigStore(), null, 2));
  }
}

function readConfigStore(): ConfigStore {
  if (configStoreCache) return configStoreCache;
  ensureConfigStore();
  const fallback = defaultConfigStore();
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_STORE_PATH, "utf8"));
    const merged: ConfigStore = {
      ...fallback,
      ...parsed,
      upstreams: Array.isArray(parsed.upstreams) ? parsed.upstreams : fallback.upstreams,
      models: Array.isArray(parsed.models) ? parsed.models : fallback.models,
      presets: { ...fallback.presets, ...(parsed.presets && typeof parsed.presets === "object" ? parsed.presets : {}) },
      systemPrompts: { ...fallback.systemPrompts, ...(parsed.systemPrompts && typeof parsed.systemPrompts === "object" ? parsed.systemPrompts : {}) },
      quotas: { ...fallback.quotas, ...(parsed.quotas && typeof parsed.quotas === "object" ? parsed.quotas : {}) },
    };
    configStoreCache = merged;
    return merged;
  } catch {
    configStoreCache = fallback;
    return fallback;
  }
}

function writeConfigStore(store: ConfigStore) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  store.version += 1;
  store.updatedAt = new Date().toISOString();
  writeFileSync(CONFIG_STORE_PATH, JSON.stringify(store, null, 2));
  configStoreCache = store;
}

function enabledUpstreamBaseUrls(): string[] {
  return readConfigStore().upstreams
    .filter((item) => item.enabled)
    .map((item) => item.baseUrl.trim().replace(/\/+$/, ""));
}

function enabledModelIds(): string[] {
  return readConfigStore().models
    .filter((item) => item.enabled)
    .map((item) => normalizedModelId(item.id));
}

const INTERNAL_HOST_PATTERN = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i;

function validateUpstreamBaseUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("站点地址格式不合法");
  }
  const host = parsed.hostname.toLowerCase();
  if (INTERNAL_HOST_PATTERN.test(host) || host.endsWith(".local")) {
    throw new Error("不允许使用内网、回环或云元数据地址（如 127.x / 192.168.x / 169.254.x）");
  }
  const base = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  return `${base}/`;
}

function createSession(username: string) {
  const token = randomBytes(32).toString("hex");
  adminSessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function cookieValue(req: IncomingMessage, name: string) {
  const cookies = req.headers.cookie || "";
  return cookies.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function getAdminSession(req: IncomingMessage) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

function setSessionCookie(res: ServerResponse, token: string) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.round(SESSION_TTL_MS / 1000)}`);
}

function clearSessionCookie(res: ServerResponse) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function createOAuthSession(userInfo: Omit<OAuthSessionData, "expiresAt">) {
  const token = randomBytes(32).toString("hex");
  oauthSessions.set(token, { ...userInfo, expiresAt: Date.now() + OAUTH_SESSION_TTL_MS });
  return token;
}

function getOAuthSession(req: IncomingMessage) {
  const token = cookieValue(req, OAUTH_SESSION_COOKIE);
  if (!token) return null;
  const session = oauthSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    oauthSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + OAUTH_SESSION_TTL_MS;
  return { token, ...session };
}

function setOAuthCookie(res: ServerResponse, token: string) {
  const existing = res.getHeader("Set-Cookie");
  const cookie = `${OAUTH_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.round(OAUTH_SESSION_TTL_MS / 1000)}`;
  if (existing) {
    res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookie] : [String(existing), cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

function clearOAuthCookie(res: ServerResponse) {
  const existing = res.getHeader("Set-Cookie");
  const cookie = `${OAUTH_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  if (existing) {
    res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookie] : [String(existing), cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

function cleanupOAuthExpired() {
  const now = Date.now();
  for (const [key, session] of oauthSessions) {
    if (session.expiresAt < now) oauthSessions.delete(key);
  }
  for (const [key, state] of oauthPendingStates) {
    if (state.expiresAt < now) oauthPendingStates.delete(key);
  }
}

function hashClientIp(req: IncomingMessage) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "");
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function hashText(value: unknown, length = 32) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, length);
}

function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey.trim()).digest("hex");
}

function squareDayKey(value = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SQUARE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${record.year}-${record.month}-${record.day}`;
}

function getSquareQuota(store: SquareStore, apiKeyHash: string, dateKey = squareDayKey()) {
  let quota = store.quotas.find((item) => item.apiKeyHash === apiKeyHash && item.dateKey === dateKey);
  if (!quota) {
    const now = Date.now();
    quota = {
      apiKeyHash,
      dateKey,
      dailyRecommendUsed: 0,
      dailyLikeUsed: 0,
      firstSeenAt: now,
      updatedAt: now,
    };
    store.quotas.unshift(quota);
  }
  return quota;
}

function squareRemainingRecommendQuota(quota: SquareQuotaDaily) {
  return Math.max(0, readConfigStore().quotas.squareDailyRecommend - quota.dailyRecommendUsed);
}

function squareRemainingLikeQuota(quota: SquareQuotaDaily) {
  return Math.max(0, readConfigStore().quotas.squareDailyLike - quota.dailyLikeUsed);
}

function squareClientMeta(req: IncomingMessage) {
  return {
    ipHash: hashClientIp(req),
    uaHash: hashText(req.headers["user-agent"] || "", 16),
  };
}

function getSquareAdminAuth(req: IncomingMessage): { ok: true; user: AdminUser } | { ok: false; status: number; error: string; mustChangePassword?: boolean } {
  const session = getAdminSession(req);
  const adminStore = readAdminStore();
  const user = session ? adminStore.admins.find((admin) => admin.username === session.username) : undefined;
  if (!session || !user) {
    return { ok: false, status: 401, error: "未登录" };
  }
  if (user.mustChangePassword) {
    return { ok: false, status: 403, error: "首次登录必须修改密码", mustChangePassword: true };
  }
  return { ok: true, user };
}

function squareItemForExport(item: SquareItem) {
  const { thumbnailDataUrl, ...safeItem } = item;
  return safeItem;
}

function truncateText(value: unknown, max = 2000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.slice(0, max);
}

function apiKeyLogMeta(apiKey: string) {
  const trimmed = apiKey.trim();
  return {
    apiKeyPresent: trimmed.length > 0,
    apiKeyLength: trimmed.length,
    apiKeyPrefix: trimmed ? trimmed.slice(0, 6) : undefined,
    apiKeySuffix: trimmed.length > 4 ? trimmed.slice(-4) : undefined,
  };
}

function redactImageText(value: string, max = 4000) {
  return truncateText(value, max)
    .replace(/data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+/g, "[image-data-redacted]")
    .replace(/"b64_json"\s*:\s*"[^"]+"/g, "\"b64_json\":\"[image-data-redacted]\"")
    .replace(/"dataUrl"\s*:\s*"[^"]+"/g, "\"dataUrl\":\"[image-data-redacted]\"")
    .replace(/"thumbnailDataUrl"\s*:\s*"[^"]+"/g, "\"thumbnailDataUrl\":\"[image-data-redacted]\"")
    .replace(/"data"\s*:\s*"[A-Za-z0-9+/=]{180,}"/g, "\"data\":\"[large-data-redacted]\"");
}

function looksLikeLargeBase64(value: string) {
  return value.length > 180 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function imageOmittedPlaceholder(value: string, fallbackMime?: string) {
  const match = value.match(/^data:([^;]+);base64,(.*)$/);
  const mime = match?.[1] || fallbackMime || "application/octet-stream";
  const base64Body = match?.[2] ?? value;
  const cleaned = base64Body.replace(/\s+/g, "");
  const bytes = Math.round((cleaned.length * 3) / 4);
  let sha256 = "";
  try {
    sha256 = createHash("sha256").update(cleaned).digest("hex").slice(0, 8);
  } catch {
    sha256 = "";
  }
  return {
    __omitted: "image" as const,
    mime,
    bytes,
    sha256,
  };
}

function referenceImagesForLog(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item, index) => {
    const image = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl : "";
    return {
      index,
      name: typeof image.name === "string" ? truncateText(image.name, 240) : undefined,
      type: typeof image.type === "string" ? image.type : undefined,
      hasImageContent: Boolean(dataUrl),
      imageContentBytes: dataUrl.length,
      dataUrl: dataUrl ? imageOmittedPlaceholder(dataUrl, typeof image.type === "string" ? image.type : undefined) : undefined,
    };
  });
}

function sanitizeForLog(value: unknown, key = "", depth = 0): unknown {
  const lowerKey = key.toLowerCase();
  if (depth > 8) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (lowerKey === "apikey" || lowerKey === "api_key" || lowerKey === "authorization" || lowerKey === "password" || lowerKey === "token") {
    return "[redacted]";
  }
  if (lowerKey === "referenceimages") {
    return referenceImagesForLog(value);
  }
  if (typeof value === "string") {
    if (
      value.startsWith("data:image/")
      || lowerKey === "dataurl"
      || lowerKey === "thumbnaildataurl"
      || lowerKey === "b64_json"
      || (lowerKey === "data" && looksLikeLargeBase64(value))
    ) {
      return imageOmittedPlaceholder(value);
    }
    return redactImageText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizeForLog(item, key, depth + 1));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeForLog(entryValue, entryKey, depth + 1),
      ]),
    );
  }
  return String(value);
}

const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function sanitizeUserDir(value: string): string {
  const cleaned = String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return cleaned || "anonymous";
}

// 图片按 <用户目录>/<生成ID>-<序号>.<ext> 存储，用户目录取自 OAuth 用户名或 clientId
function persistGeneratedImages(
  images: Array<{ dataUrl: string; revisedPrompt?: string }>,
  options: { userDir: string; requestId: string },
) {
  const saved: SavedImageMeta[] = [];
  const userDir = sanitizeUserDir(options.userDir);
  const publicImages = images.map((image, index) => {
    try {
      const match = /^data:([^;]+);base64,(.*)$/.exec(image.dataUrl);
      if (!match) {
        return { dataUrl: image.dataUrl, revisedPrompt: image.revisedPrompt };
      }
      const mime = match[1].toLowerCase();
      const ext = IMAGE_MIME_EXT[mime] || "png";
      const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
      const dir = join(LOCAL_IMAGE_DIR, userDir);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const fileName = images.length > 1 ? `${options.requestId}-${index}.${ext}` : `${options.requestId}.${ext}`;
      const relativePath = `${userDir}/${fileName}`;
      writeFileSync(join(LOCAL_IMAGE_DIR, userDir, fileName), buffer);
      saved.push({ id: relativePath, mime: IMAGE_EXT_MIME[ext] || mime, bytes: buffer.length });
      return { url: `${LOCAL_IMAGE_URL_PREFIX}${relativePath}`, revisedPrompt: image.revisedPrompt };
    } catch {
      return { dataUrl: image.dataUrl, revisedPrompt: image.revisedPrompt };
    }
  });
  return { saved, publicImages };
}

function deleteSavedImages(saved?: SavedImageMeta[]) {
  if (!Array.isArray(saved)) return;
  for (const image of saved) {
    if (!image || typeof image.id !== "string" || !LOCAL_IMAGE_PATH_PATTERN.test(image.id) || image.id.includes("..")) continue;
    try {
      unlinkSync(join(LOCAL_IMAGE_DIR, image.id));
    } catch {
      // 文件可能已被清理，忽略
    }
  }
}

function normalizeAllowedApiBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  const allowList = [...enabledUpstreamBaseUrls(), ...ALLOWED_API_BASE_URLS.map((u) => u.replace(/\/+$/, ""))];
  const match = allowList.find((allowed) => allowed === normalized);
  if (!match) {
    throw new Error("API URL 不在允许列表中");
  }
  return `${match}/`;
}

function isAllowedApiBaseUrlError(error: unknown) {
  return error instanceof Error && error.message === "API URL 不在允许列表中";
}

function httpStatusFromDetail(detail: unknown) {
  if (!detail || typeof detail !== "object") return undefined;
  const record = detail as Record<string, unknown>;
  if (typeof record.status === "number") return record.status;
  const error = record.error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).status === "number") {
    return (error as Record<string, unknown>).status as number;
  }
  return undefined;
}

// 把 Error（含 undici 的 cause 链、code、errno）序列化成可读文本，用于记录完整错误
function describeError(error: unknown, depth = 0): string {
  if (depth > 5) return "[cause-depth-limit]";
  if (!(error instanceof Error)) {
    try { return typeof error === "string" ? error : JSON.stringify(error); } catch { return String(error); }
  }
  const parts: string[] = [`${error.name}: ${error.message}`];
  const anyErr = error as Error & { code?: unknown; errno?: unknown; cause?: unknown };
  if (anyErr.code != null) parts.push(`code=${String(anyErr.code)}`);
  if (anyErr.errno != null) parts.push(`errno=${String(anyErr.errno)}`);
  if (anyErr.cause != null && anyErr.cause !== error) {
    parts.push(`\n  ↳ cause: ${describeError(anyErr.cause, depth + 1)}`);
  }
  if (depth === 0 && error.stack) parts.push(`\n${error.stack}`);
  return parts.join(" ");
}

function safeErrorSummary(detail: unknown) {
  const record = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
  const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  return {
    message: truncateText(
      typeof record.error === "string"
        ? record.error
        : typeof error.message === "string"
          ? error.message
          : typeof detail === "string"
            ? detail
            : "请求失败",
      800,
    ),
    type: typeof error.type === "string" ? error.type : undefined,
    code: typeof error.code === "string" ? error.code : undefined,
    raw: redactImageText(typeof detail === "string" ? detail : JSON.stringify(sanitizeForLog(detail)), 2500),
    // 完整错误内容（仅脱敏图片数据，不做长度截断）——用于排查"中转站看起来没错但生成报错"的情况
    full: redactImageText(typeof detail === "string" ? detail : JSON.stringify(sanitizeForLog(detail), null, 2), 60000),
  };
}

// ── SQLite 请求/生成记录存储 ──
const REQUEST_LOG_LIMIT = 5000;
let sqliteDb: Database.Database | null = null;

function getDb(): Database.Database {
  if (sqliteDb) return sqliteDb;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(join(DATA_DIR, "imagehub.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
      request_id TEXT PRIMARY KEY,
      request_type TEXT,
      client_id TEXT,
      model TEXT,
      status TEXT,
      error_key TEXT,
      created_at INTEGER,
      duration_ms INTEGER,
      image_count INTEGER DEFAULT 0,
      ref_count INTEGER DEFAULT 0,
      ref_status TEXT,
      upstream_responded INTEGER DEFAULT 0,
      image_saved INTEGER DEFAULT 0,
      search TEXT,
      data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_request_logs_status ON request_logs(status);
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT NOT NULL,
      model TEXT NOT NULL,
      total INTEGER DEFAULT 0,
      success INTEGER DEFAULT 0,
      error INTEGER DEFAULT 0,
      images INTEGER DEFAULT 0,
      duration_sum INTEGER DEFAULT 0,
      duration_count INTEGER DEFAULT 0,
      PRIMARY KEY (date, model)
    );
    CREATE TABLE IF NOT EXISTS image_feedback (
      request_id TEXT PRIMARY KEY,
      client_id TEXT,
      model TEXT,
      rating INTEGER,
      created_at INTEGER
    );
  `);
  sqliteDb = db;
  // 首次启动时把历史 admin-store.json 里的旧日志迁移进来（一次性）
  try {
    const legacy = readAdminStore();
    if (Array.isArray(legacy.requestLogs) && legacy.requestLogs.length > 0) {
      const count = (db.prepare("SELECT COUNT(*) AS n FROM request_logs").get() as { n: number }).n;
      if (count === 0) {
        const insert = db.transaction((rows: RequestLog[]) => {
          for (const row of rows) requestLogRow(row);
        });
        insert(legacy.requestLogs);
        legacy.requestLogs = [];
        writeAdminStore(legacy);
      }
    }
  } catch {
    // 迁移失败不阻断启动
  }
  // 每日聚合表首次创建时用现有日志回填，之后由请求终态实时累加（不受 5000 条裁剪影响）
  try {
    const rollupCount = (db.prepare("SELECT COUNT(*) AS n FROM daily_stats").get() as { n: number }).n;
    if (rollupCount === 0) {
      const rows = db.prepare("SELECT data FROM request_logs").all() as Array<{ data: string }>;
      const backfill = db.transaction(() => {
        for (const row of rows) {
          try {
            const log = JSON.parse(row.data) as RequestLog;
            if (log.requestType === "image_generation" && (log.status === "success" || log.status === "error")) {
              bumpDailyStats(log);
            }
          } catch { /* 单条损坏忽略 */ }
        }
      });
      backfill();
    }
  } catch {
    // 回填失败不阻断启动
  }
  return db;
}

// 请求到达终态时累加当日聚合（date + model 维度）
function bumpDailyStats(log: RequestLog) {
  const durationMs = typeof log.durationMs === "number" ? log.durationMs : null;
  getDb().prepare(`
    INSERT INTO daily_stats (date, model, total, success, error, images, duration_sum, duration_count)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(date, model) DO UPDATE SET
      total = total + 1,
      success = success + excluded.success,
      error = error + excluded.error,
      images = images + excluded.images,
      duration_sum = duration_sum + excluded.duration_sum,
      duration_count = duration_count + excluded.duration_count
  `).run(
    squareDayKey(log.createdAt),
    log.model || "",
    log.status === "success" ? 1 : 0,
    log.status === "error" ? 1 : 0,
    log.savedImages?.length || 0,
    durationMs ?? 0,
    durationMs === null ? 0 : 1,
  );
}

function requestLogSearchText(log: RequestLog): string {
  return `${log.requestId} ${log.clientId} ${log.prompt} ${log.model} ${log.resolution || ""} ${log.agentName || ""} ${log.agentScenario || ""} ${log.errorMessage || ""}`.toLowerCase();
}

function requestLogRow(log: RequestLog) {
  const errorKey = log.status === "error"
    ? (log.errorCode || log.errorType || log.errorMessage || "未知错误")
    : null;
  const upstreamResponded = log.stages?.upstreamRespondedAt
    || (log.status !== "running" && log.errorType !== "validation_error") ? 1 : 0;
  getDb().prepare(`
    INSERT INTO request_logs
      (request_id, request_type, client_id, model, status, error_key, created_at, duration_ms, image_count, ref_count, ref_status, upstream_responded, image_saved, search, data)
    VALUES (@request_id, @request_type, @client_id, @model, @status, @error_key, @created_at, @duration_ms, @image_count, @ref_count, @ref_status, @upstream_responded, @image_saved, @search, @data)
    ON CONFLICT(request_id) DO UPDATE SET
      request_type=excluded.request_type, client_id=excluded.client_id, model=excluded.model, status=excluded.status,
      error_key=excluded.error_key, created_at=excluded.created_at, duration_ms=excluded.duration_ms, image_count=excluded.image_count,
      ref_count=excluded.ref_count, ref_status=excluded.ref_status, upstream_responded=excluded.upstream_responded,
      image_saved=excluded.image_saved, search=excluded.search, data=excluded.data
  `).run({
    request_id: log.requestId,
    request_type: log.requestType,
    client_id: log.clientId,
    model: log.model || "",
    status: log.status,
    error_key: errorKey,
    created_at: log.createdAt,
    duration_ms: typeof log.durationMs === "number" ? log.durationMs : null,
    image_count: log.savedImages?.length || 0,
    ref_count: log.referenceCount || 0,
    ref_status: log.referenceUploadStatus || null,
    upstream_responded: upstreamResponded,
    image_saved: log.imageSaved ? 1 : 0,
    search: requestLogSearchText(log),
    data: JSON.stringify(log),
  });
}

function readRequestLogRecord(requestId: string): RequestLog | null {
  const row = getDb().prepare("SELECT data FROM request_logs WHERE request_id = ?").get(requestId) as { data: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.data) as RequestLog; } catch { return null; }
}

function createRequestLog(log: RequestLog) {
  requestLogRow(log);
  // 保留最近 REQUEST_LOG_LIMIT 条，清理超出的记录与其图片文件
  const overflow = getDb()
    .prepare("SELECT data FROM request_logs ORDER BY created_at DESC LIMIT -1 OFFSET ?")
    .all(REQUEST_LOG_LIMIT) as Array<{ data: string }>;
  if (overflow.length > 0) {
    for (const row of overflow) {
      try { deleteSavedImages((JSON.parse(row.data) as RequestLog).savedImages); } catch { /* ignore */ }
    }
    getDb().prepare(`DELETE FROM request_logs WHERE request_id IN (
      SELECT request_id FROM request_logs ORDER BY created_at DESC LIMIT -1 OFFSET ?
    )`).run(REQUEST_LOG_LIMIT);
  }
}

function updateRequestLog(requestId: string, patch: Partial<RequestLog>) {
  const current = readRequestLogRecord(requestId);
  if (!current) return;
  const merged = { ...current, ...patch };
  requestLogRow(merged);
  // 生图请求首次从 running 进入终态时累加每日聚合（终态只发生一次，保证不重复计数）
  if (
    current.status === "running"
    && (merged.status === "success" || merged.status === "error")
    && merged.requestType === "image_generation"
  ) {
    bumpDailyStats(merged);
  }
}

function generationEndpointLabel(protocol: ImageProtocol, model = "", referenceCount = 0) {
  if (protocol === "openai-responses") return "/v1/responses";
  if (protocol === "gemini-native") return `${GEMINI_NATIVE_API_PREFIX}/models/${modelName(model)}:generateContent`;
  if (protocol === "google-imagen") return `/models/${modelName(model)}:predict`;
  if (protocol === "stability-core") {
    return String(model).includes("ultra")
      ? "/v2beta/stable-image/generate/ultra"
      : "/v2beta/stable-image/generate/core";
  }
  if (protocol === "openai-images" && referenceCount > 0) return "/v1/images/edits → /v1/images/generations";
  if (protocol === "custom-openai" && referenceCount > 0) return "/v1/images/generations";
  return protocol === "gemini-openai" ? "/images/generations" : "/v1/images/generations";
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超过 ${Math.round(timeoutMs / 1000)} 秒，已自动超时`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getString(body: ProxyBody, key: string) {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function getProtocol(value: unknown): ImageProtocol {
  return typeof value === "string" && PROTOCOLS.includes(value as ImageProtocol)
    ? (value as ImageProtocol)
    : DEFAULT_PROTOCOL;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getNestedString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function getNestedNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function imageBytesFromDataUrl(dataUrl: string) {
  const base64 = dataUrl.match(/^data:[^;]+;base64,(.*)$/)?.[1] || dataUrl;
  return Math.round((base64.replace(/\s+/g, "").length * 3) / 4);
}

function hashImageDataUrl(dataUrl: string) {
  const base64 = dataUrl.match(/^data:[^;]+;base64,(.*)$/)?.[1] || dataUrl;
  return createHash("sha256").update(base64.replace(/\s+/g, "")).digest("hex");
}

function normalizeSquareFeedTab(value: string | null): SquareFeedTab {
  if (value === "hot" || value === "top_day" || value === "top_week" || value === "top_month") return value;
  return "latest";
}

function squareCursorOffset(value: string | null) {
  if (!value) return 0;
  const parsedDirect = Number(value);
  if (Number.isFinite(parsedDirect) && parsedDirect >= 0) return Math.floor(parsedDirect);
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const offset = typeof decoded.offset === "number" ? decoded.offset : 0;
    return Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  } catch {
    return 0;
  }
}

function squareNextCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function squareActiveItems(store: SquareStore) {
  return store.items.filter((item) => item.active !== false);
}

function squareShelfCount(store: SquareStore, apiKeyHash: string) {
  return squareActiveItems(store).filter((item) => item.recommenderHash === apiKeyHash).length;
}

function squareQualityScore(width?: number, height?: number, prompt = "") {
  const longest = Math.max(width || 0, height || 0);
  const dimensionScore = longest >= 1024 ? 86 : longest >= 768 ? 74 : 62;
  const promptScore = prompt.trim().length >= 20 ? 82 : 68;
  return Math.round(dimensionScore * 0.72 + promptScore * 0.28);
}

function squareRankScore(item: SquareItem, tab: SquareFeedTab, now = Date.now()) {
  const periodMs = tab === "top_day"
    ? 24 * 60 * 60 * 1000
    : tab === "top_week"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
  const hotPeriodMs = tab === "hot" ? 3 * 24 * 60 * 60 * 1000 : periodMs;
  const ageMs = Math.max(0, now - item.createdAt);
  const recencyScore = Math.max(0, Math.round(100 * Math.exp(-ageMs / hotPeriodMs)));
  const likeScore = Math.min(100, Math.round(Math.log1p(item.likeCount || 0) * 32));
  const qualityScore = Math.max(0, Math.min(100, item.qualityScore || 70));
  const trustScore = Math.max(0, Math.min(100, item.trustScore || 70));
  const manualBoost = item.featured ? 8 : 0;
  return Math.round((recencyScore * 0.45 + likeScore * 0.35 + qualityScore * 0.15 + trustScore * 0.05 + manualBoost) * 100) / 100;
}

let squareRankScoreCache = new WeakMap<SquareItem, number>();

function sortSquareItems(items: SquareItem[], tab: SquareFeedTab) {
  const now = Date.now();
  squareRankScoreCache = new WeakMap();
  if (tab === "latest") {
    for (const item of items) squareRankScoreCache.set(item, squareRankScore(item, tab, now));
    return [...items].sort((a, b) => b.createdAt - a.createdAt);
  }
  const periodMs = tab === "top_day"
    ? 24 * 60 * 60 * 1000
    : tab === "top_week"
      ? 7 * 24 * 60 * 60 * 1000
      : tab === "top_month"
        ? 30 * 24 * 60 * 60 * 1000
        : 0;
  const scoped = periodMs > 0
    ? items.filter((item) => item.createdAt >= now - periodMs)
    : items;
  for (const item of scoped) squareRankScoreCache.set(item, squareRankScore(item, tab, now));
  return [...scoped].sort((a, b) => {
    const scoreDiff = (squareRankScoreCache.get(b) ?? 0) - (squareRankScoreCache.get(a) ?? 0);
    return scoreDiff || b.createdAt - a.createdAt;
  });
}

function isLikedBy(store: SquareStore, apiKeyHash: string, itemId: string) {
  return Boolean(store.likes.find((like) => like.apiKeyHash === apiKeyHash && like.itemId === itemId && like.liked));
}

function squareFeedItem(item: SquareItem, store: SquareStore, tab: SquareFeedTab, viewerApiKeyHash = "", cachedRankScore?: number) {
  return {
    id: item.id,
    imageId: item.imageId,
    requestId: item.requestId,
    thumbnailUrl: `/api/square/image/${item.id}`,
    prompt: item.prompt,
    caption: item.caption,
    model: item.model,
    params: item.params,
    width: item.width,
    height: item.height,
    aspectRatio: item.aspectRatio,
    sourceType: item.sourceType,
    reasonPlan: item.reasonPlan,
    recommenderLabel: item.recommenderLabel,
    pageLabel: item.pageLabel,
    likeCount: item.likeCount || 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    rankScore: cachedRankScore ?? squareRankScore(item, tab),
    likedByRequester: viewerApiKeyHash ? isLikedBy(store, viewerApiKeyHash, item.id) : false,
  };
}

function appendSquareRecommendLog(store: SquareStore, log: Omit<SquareRecommendLog, "id" | "timestamp">) {
  store.recommendLogs.unshift({
    id: randomUUID(),
    timestamp: Date.now(),
    ...log,
  });
}

function appendSquareLikeLog(store: SquareStore, log: Omit<SquareLikeLog, "id" | "timestamp">) {
  store.likeLogs.unshift({
    id: randomUUID(),
    timestamp: Date.now(),
    ...log,
  });
}

function appendSquareModerationAudit(store: SquareStore, audit: Omit<SquareModerationAudit, "id" | "timestamp">) {
  store.moderationAudits.unshift({
    id: randomUUID(),
    timestamp: Date.now(),
    ...audit,
  });
}

function moderationReasonForSquareText(prompt: string, caption = "") {
  const text = `${prompt}\n${caption}`.toLowerCase();
  if (/(nsfw|nude|porn|sex|色情|裸露|裸体|成人内容)/i.test(text)) return "blocked_sensitive_content";
  if (prompt.length > 8000 || caption.length > 1000) return "abnormal_text_length";
  return "";
}

function recentSquareRecommendCount(store: SquareStore, apiKeyHash: string, withinMs: number) {
  const threshold = Date.now() - withinMs;
  return store.recommendLogs.filter((log) => log.apiKeyHash === apiKeyHash && log.timestamp >= threshold).length;
}

function endpoint(baseUrl: string, path: string) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  if (!cleanBase) {
    throw new Error("API URL 不能为空");
  }
  const cleanPath = cleanBase.endsWith("/v1") && path.startsWith("/v1/")
    ? path.slice(3)
    : path;
  return `${cleanBase}${cleanPath}`;
}

function publicBaseUrlFromRequest(_req: IncomingMessage) {
  return PUBLIC_REFERENCE_BASE_URL;
}

function isPublicReferenceBaseUrl(value = "") {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return Boolean(url.protocol.startsWith("http"))
      && host !== "localhost"
      && host !== "127.0.0.1"
      && host !== "::1"
      && !host.endsWith(".local");
  } catch {
    return false;
  }
}

function modelName(value = "") {
  return value.replace(/^models\//, "");
}

function parseMaybeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function detailFromUpstream(status: number, bodyText: string) {
  const parsed = parseMaybeJson(bodyText);
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const error = (parsed as { error?: unknown }).error;
    return { status, error, raw: parsed };
  }
  return { status, error: parsed || `HTTP ${status}`, raw: parsed };
}

function outputMime(outputFormat = "png") {
  const mimeByFormat: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    webp: "image/webp",
  };
  return mimeByFormat[outputFormat] || "image/png";
}

function fullPrompt(request: GenerateRequest) {
  return request.negativePrompt
    ? `${request.prompt}\n\nNegative prompt: ${request.negativePrompt}`
    : request.prompt || "";
}

function dataUrlToReferenceImageUrl(image: ReferenceImage) {
  if (image.dataUrl.startsWith("data:")) return image.dataUrl;
  const mime = image.type || "image/png";
  return `data:${mime};base64,${image.dataUrl}`;
}

function referenceImageToBuffer(image: ReferenceImage) {
  const dataUrl = dataUrlToReferenceImageUrl(image);
  const [, mime = image.type || "image/png", data = image.dataUrl] =
    dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
  return {
    mime,
    data: Buffer.from(data, "base64"),
  };
}

function uploadedReferenceUrlFrom(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.startsWith("http") ? value : "";
  if (Array.isArray(value)) {
    return value.map(uploadedReferenceUrlFrom).find(Boolean) || "";
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const directKeys = ["url", "imageUrl", "image_url", "fileUrl", "file_url", "downloadUrl", "download_url"];
  for (const key of directKeys) {
    const url = uploadedReferenceUrlFrom(record[key]);
    if (url) return url;
  }
  return uploadedReferenceUrlFrom(record.data)
    || uploadedReferenceUrlFrom(record.result)
    || uploadedReferenceUrlFrom(record.file)
    || uploadedReferenceUrlFrom(record.files)
    || uploadedReferenceUrlFrom(record.images);
}

async function uploadCompatibleReferenceImage(baseUrl: string, apiKey: string, image: ReferenceImage, index: number) {
  const { mime, data } = referenceImageToBuffer(image);
  const fileName = image.name || `reference-${index + 1}.${mime.split("/")[1] || "png"}`;
  const form = new FormData();
  form.append("file", new Blob([data], { type: mime }), fileName);

  const response = await fetchWithTimeout(endpoint(baseUrl, "/v1/uploads/images"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  }, 60_000);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`参考图上传失败：HTTP ${response.status}`);
  }

  const url = uploadedReferenceUrlFrom(parseMaybeJson(bodyText));
  if (!url) {
    throw new Error("参考图上传成功，但响应中没有可用 URL");
  }
  return url;
}

function cleanupExpiredTemporaryReferences() {
  const now = Date.now();
  for (const [id, record] of temporaryReferences.entries()) {
    if (record.expiresAt <= now) temporaryReferences.delete(id);
  }
}

function scheduleTemporaryReferenceCleanup(id: string) {
  const timer = setTimeout(() => temporaryReferences.delete(id), REFERENCE_TEMP_TTL_MS + 1000);
  const maybeTimer = timer as unknown as { unref?: () => void };
  if (typeof maybeTimer.unref === "function") maybeTimer.unref();
}

function createTemporaryReferenceUrls(references: ReferenceImage[], publicBaseUrl: string) {
  cleanupExpiredTemporaryReferences();
  const ids: string[] = [];
  const urls = references.map((image, index) => {
    const { mime, data } = referenceImageToBuffer(image);
    const id = randomUUID();
    ids.push(id);
    temporaryReferences.set(id, {
      bytes: data,
      mime,
      name: image.name || `reference-${index + 1}.${mime.split("/")[1] || "png"}`,
      expiresAt: Date.now() + REFERENCE_TEMP_TTL_MS,
    });
    scheduleTemporaryReferenceCleanup(id);
    return `${publicBaseUrl}/api/reference-images/${encodeURIComponent(id)}`;
  });
  return {
    urls,
    cleanup: () => ids.forEach((id) => temporaryReferences.delete(id)),
  };
}

function compatibleReferenceImagePayloads(references: ReferenceImage[], publicBaseUrl = ""): ReferenceUrlPayload[] {
  if (references.length === 0) return [];

  // 上游协议：POST /v1/images/generations + JSON body + image: array<string>
  // 实测两种字符串都被识别：
  //   1. data URI —— 客户端已压到 ≤ 512KB，base64 后 ~700KB，JSON 直接装得下
  //   2. 公网 URL —— 上游回 fetch 我们的临时存储；只在 publicBaseUrl 真的公网可达时尝试
  // 顺序：data URI 优先。本地 dev 时 publicBaseUrl 写死指向生产域名，
  // 临时 URL 通道在本地内存里根本不存在，先发 data URI 能省掉一次必败的尝试。
  // 历史上的 image_urls / reference_image_urls 字段名经实测**不被上游读取**，已删除。
  const dataUriUrls = references.map(dataUrlToReferenceImageUrl);
  const payloads: ReferenceUrlPayload[] = [];

  payloads.push({
    field: "image",
    urls: dataUriUrls,
    mode: "image:data_uri",
  });

  if (isPublicReferenceBaseUrl(publicBaseUrl)) {
    const temp = createTemporaryReferenceUrls(references, publicBaseUrl);
    payloads.push({
      field: "image",
      urls: temp.urls,
      mode: "image:temporary_url",
      cleanup: temp.cleanup,
    });
  }

  return payloads;
}

function shouldTryNextReferencePayload(result: ImageResult) {
  if (result.ok) return false;
  const status = result.status || 0;
  if ([400, 401, 403, 404, 405, 413, 415, 422, 429, 500, 502, 503].includes(status)) return true;
  const detailText = JSON.stringify(result.detail || {}).toLowerCase();
  // 历史 image_urls / reference_image_urls 字段 2026-05-04 已删，正则不再匹配它们
  return /reference|image|url|data uri|base64|payload|too large|unsupported|unknown|invalid/.test(detailText);
}

function shouldFallbackToGeneration(result: ImageResult) {
  if (result.ok) return false;
  const status = result.status || 0;
  if (![400, 404, 405, 415, 422, 501].includes(status)) return false;
  const detailText = JSON.stringify(result.detail || {}).toLowerCase();
  return /invalid url|not found|method not allowed|unsupported|unknown endpoint|no route|content-type/.test(detailText);
}

function shouldFallbackReferenceEditToGeneration(result: ImageResult) {
  if (result.ok) return false;
  const status = result.status || 0;
  if (status === 401 || status === 403) return true;
  return shouldFallbackToGeneration(result);
}

const SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "1024x1024",
  "4:5": "1024x1280",
  "5:4": "1280x1024",
  "3:4": "1152x1536",
  "4:3": "1536x1152",
  "2:3": "1024x1536",
  "3:2": "1536x1024",
  "9:16": "1024x1792",
  "16:9": "1792x1024",
  "21:9": "2016x864",
  "9:21": "864x2016",
  "12:5": "2016x840",
  "5:12": "840x2016",
};

const GPT_IMAGE_2_SIZE_OPTIONS = [
  { size: "2560x1440", aspectRatio: "16:9", resolution: "2K" },
  { size: "1440x2560", aspectRatio: "9:16", resolution: "2K" },
  { size: "2048x1152", aspectRatio: "16:9", resolution: "2K" },
  { size: "1152x2048", aspectRatio: "9:16", resolution: "2K" },
  { size: "2048x2048", aspectRatio: "1:1", resolution: "2K" },
  { size: "2048x1536", aspectRatio: "4:3", resolution: "2K" },
  { size: "1536x2048", aspectRatio: "3:4", resolution: "2K" },
  { size: "2048x3072", aspectRatio: "2:3", resolution: "2K" },
  { size: "3072x2048", aspectRatio: "3:2", resolution: "2K" },
  { size: "3840x2160", aspectRatio: "16:9", resolution: "4K" },
  { size: "2160x3840", aspectRatio: "9:16", resolution: "4K" },
  { size: "3840x1600", aspectRatio: "12:5", resolution: "4K" },
  { size: "1600x3840", aspectRatio: "5:12", resolution: "4K" },
];

const RESOLUTION_MULTIPLIER: Record<string, number> = {
  "1K": 1,
  "2K": 2,
  "4K": 4,
};

function normalizeResolution(value?: string) {
  return value === "2K" || value === "4K" ? value : "1K";
}

function supportsGptImage2ExplicitSizes(model = "") {
  const normalized = normalizedModelId(model);
  return normalized === GPT_IMAGE_2_MODEL || normalized === GPT_IMAGE_2_PRO_MODEL;
}

function gptImage2SizeOptionForSize(size = "") {
  return GPT_IMAGE_2_SIZE_OPTIONS.find((option) => option.size === size);
}

function gptImage2DefaultSizeOption(aspectRatio: string, resolution = "1K") {
  const res = normalizeResolution(resolution);
  return GPT_IMAGE_2_SIZE_OPTIONS.find((option) => option.resolution === res && option.aspectRatio === aspectRatio)
    || GPT_IMAGE_2_SIZE_OPTIONS.find((option) => option.resolution === res);
}

function scaleSize(size: string, resolution = "1K") {
  const multiplier = RESOLUTION_MULTIPLIER[normalizeResolution(resolution)] || 1;
  if (multiplier === 1) return size;
  const [width, height] = size.split("x").map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return size;
  const MAX_EDGE = 3840;
  let w = Math.round(width * multiplier);
  let h = Math.round(height * multiplier);
  const longest = Math.max(w, h);
  if (longest > MAX_EDGE) {
    const factor = MAX_EDGE / longest;
    w = Math.round(width * multiplier * factor);
    h = Math.round(height * multiplier * factor);
  }
  return `${w}x${h}`;
}

function imageSizeForProtocol(request: GenerateRequest, protocol: ImageProtocol) {
  if (supportsGptImage2ExplicitSizes(request.model) && request.aspectRatio) {
    const res = normalizeResolution(request.resolution);
    const preferredOption = gptImage2SizeOptionForSize(request.size);
    if (preferredOption && preferredOption.resolution === res && preferredOption.aspectRatio === request.aspectRatio) {
      return preferredOption.size;
    }
    const defaultOption = gptImage2DefaultSizeOption(request.aspectRatio, res);
    if (defaultOption) return defaultOption.size;
    return SIZE_BY_RATIO[request.aspectRatio] || SIZE_BY_RATIO["1:1"];
  }
  if (isGptImage2Model(request.model) && request.aspectRatio) {
    return SIZE_BY_RATIO[request.aspectRatio] || SIZE_BY_RATIO["1:1"];
  }
  return request.aspectRatio
    ? scaleSize(SIZE_BY_RATIO[request.aspectRatio] || SIZE_BY_RATIO["1:1"], request.resolution)
    : request.size || "auto";
}

function normalizedModelId(model = "") {
  return model.replace(/^models\//, "").trim().toLowerCase();
}

function isGptImage2Model(model = "") {
  const normalized = normalizedModelId(model);
  return normalized === GPT_IMAGE_2_MODEL || normalized === GPT_IMAGE_2_FAMILY_MODEL || normalized.includes("image-2");
}

function isGptImage2ProModel(model = "") {
  return normalizedModelId(model) === GPT_IMAGE_2_PRO_MODEL;
}

function isGemini3ProImageModel(model = "") {
  return normalizedModelId(model) === GEMINI_3_PRO_IMAGE_MODEL;
}

function dataUrlToGeminiPart(image: ReferenceImage) {
  const [meta, data = ""] = image.dataUrl.split(",");
  const mimeType = image.type || meta.match(/^data:(.*?);base64$/)?.[1] || "image/png";
  return {
    inlineData: {
      mimeType,
      data,
    },
  };
}

function dataUrlFromBase64(base64: string, mime: string) {
  if (base64.startsWith("data:")) return base64;
  return `data:${mime};base64,${base64}`;
}

async function urlToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`读取图片 URL 失败：HTTP ${response.status} ${text.slice(0, 400)}`);
  }
  const contentType = response.headers.get("content-type") || "image/png";
  const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
  return `data:${contentType};base64,${bytes}`;
}

function extractModelIds(payload: unknown, key: "data" | "models" = "data") {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as { id?: string; name?: string; displayName?: string };
      return modelName(record.id || record.name || record.displayName || "");
    })
    .filter(Boolean);
}

function collectImageData(node: unknown, found: string[] = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((item) => collectImageData(item, found));
    return found;
  }

  const record = node as Record<string, unknown>;
  const keys = ["b64_json", "result", "bytesBase64Encoded", "data"];
  keys.forEach((key) => {
    const value = record[key];
    if (typeof value === "string" && value.length > 100) {
      found.push(value);
    }
  });

  const inlineData = record.inlineData || record.inline_data;
  if (inlineData && typeof inlineData === "object") {
    const data = (inlineData as Record<string, unknown>).data;
    if (typeof data === "string") found.push(data);
  }

  Object.values(record).forEach((value) => collectImageData(value, found));
  return found;
}

function collectText(node: unknown, found: string[] = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((item) => collectText(item, found));
    return found;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.text === "string") found.push(record.text);
  Object.values(record).forEach((value) => collectText(value, found));
  return found;
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith("{")) return fenced;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function normalizeRiskLevel(value: unknown) {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeAnalysisPayload(value: unknown, analysisModel: string) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const risks = Array.isArray(record.risks)
    ? record.risks
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((risk) => ({
        level: normalizeRiskLevel(risk.level),
        title: typeof risk.title === "string" ? risk.title : "生成风险",
        description: typeof risk.description === "string" ? risk.description : "",
        fix: typeof risk.fix === "string" ? risk.fix : undefined,
      }))
    : [];
  const riskLevel = normalizeRiskLevel(record.riskLevel || (risks.some((risk) => risk.level === "high") ? "high" : risks.some((risk) => risk.level === "medium") ? "medium" : "low"));
  const suggestedParams = record.suggestedParams && typeof record.suggestedParams === "object"
    ? record.suggestedParams as Record<string, unknown>
    : {};
  const styleStrength = suggestedParams.styleStrength;
  const referenceWeight = suggestedParams.referenceWeight;
  const styleEnhancements = Array.isArray(record.styleEnhancements)
    ? record.styleEnhancements
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "",
        description: typeof item.description === "string" ? item.description : "",
        promptFragment: typeof item.promptFragment === "string" ? item.promptFragment : "",
      }))
      .filter((item) => item.name && item.promptFragment)
    : [];
  return {
    safe: typeof record.safe === "boolean" ? record.safe : riskLevel !== "high",
    score: typeof record.score === "number" ? Math.max(0, Math.min(100, record.score)) : riskLevel === "low" ? 92 : riskLevel === "medium" ? 74 : 48,
    riskLevel,
    summary: typeof record.summary === "string" ? record.summary : "已完成发送前分析。",
    optimizedPrompt: typeof record.optimizedPrompt === "string" ? record.optimizedPrompt : "",
    suggestedNegativePrompt: typeof record.suggestedNegativePrompt === "string" ? record.suggestedNegativePrompt : "",
    suggestedParams: {
      aspectRatio: typeof suggestedParams.aspectRatio === "string" ? suggestedParams.aspectRatio : undefined,
      size: typeof suggestedParams.size === "string" ? suggestedParams.size : undefined,
      resolution: typeof suggestedParams.resolution === "string" ? suggestedParams.resolution : undefined,
      count: typeof suggestedParams.count === "number" ? suggestedParams.count : undefined,
      quality: typeof suggestedParams.quality === "string" ? suggestedParams.quality : undefined,
      styleStrength: styleStrength === "low" || styleStrength === "medium" || styleStrength === "high"
        ? styleStrength
        : undefined,
      referenceWeight: referenceWeight === "low" || referenceWeight === "medium" || referenceWeight === "high"
        ? referenceWeight
        : undefined,
    },
    risks,
    styleEnhancements,
    analysisModel,
    source: "ai",
  };
}

type AgentModeIntentType = "single_image" | "multi_image_batch" | "brochure_project" | "page_refine" | "unknown";
type AgentModeCostLevel = "low" | "medium" | "high";
type AgentModeJobSpec = {
  id: string;
  title: string;
  prompt: string;
  objective?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  size?: string;
  resolution?: "1K" | "2K" | "4K";
  quality?: string;
  count?: number;
};
type AgentModeBrochurePage = {
  pageNo: number;
  role: string;
  title: string;
  objective: string;
};
type AgentModeBrochureProject = {
  title: string;
  companyName?: string;
  industry?: string;
  purpose?: string;
  pageCount: number;
  summary: string;
  outline: AgentModeBrochurePage[];
  styleDirections: string[];
  requestPrompt?: string;
};
type AgentModeAnalysisResult = {
  intentType: AgentModeIntentType;
  confidence: number;
  reasoningSummary: string;
  estimatedCostLevel: AgentModeCostLevel;
  requiresConfirmation: boolean;
  autoExecute: boolean;
  jobs: AgentModeJobSpec[];
  brochureProject?: AgentModeBrochureProject;
  analysisModel?: string;
  source?: "ai" | "local";
};

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function clampCount(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseNaturalCountToken(value = "") {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const arabic = normalized.match(/\d+/)?.[0];
  if (arabic) return Number(arabic);
  if (normalized === "十") return 10;
  if (normalized.includes("十")) {
    const [left, right] = normalized.split("十");
    const leftValue = left ? (CHINESE_DIGITS[left] ?? 1) : 1;
    const rightValue = right ? (CHINESE_DIGITS[right] ?? 0) : 0;
    return leftValue * 10 + rightValue;
  }
  return CHINESE_DIGITS[normalized];
}

function normalizeAgentModeIntentType(value: unknown, fallback: AgentModeIntentType = "unknown"): AgentModeIntentType {
  return value === "single_image"
    || value === "multi_image_batch"
    || value === "brochure_project"
    || value === "page_refine"
    || value === "unknown"
    ? value
    : fallback;
}

function normalizeAgentModeCostLevel(value: unknown, fallback: AgentModeCostLevel = "low"): AgentModeCostLevel {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function normalizeAgentModeJobSpec(
  value: unknown,
  fallback?: Partial<AgentModeJobSpec>,
): AgentModeJobSpec {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const prompt = typeof record.prompt === "string" && record.prompt.trim()
    ? record.prompt.trim()
    : fallback?.prompt || "";
  const id = typeof record.id === "string" && record.id.trim()
    ? record.id.trim()
    : fallback?.id || `job_${randomUUID().slice(0, 8)}`;
  const count = typeof record.count === "number" && Number.isFinite(record.count)
    ? clampCount(Math.round(record.count), 1, 8)
    : clampCount(Math.round(fallback?.count || 1), 1, 8);
  const resolution = record.resolution === "1K" || record.resolution === "2K" || record.resolution === "4K"
    ? record.resolution
    : fallback?.resolution;
  return {
    id,
    title: typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : fallback?.title || "图片任务",
    prompt,
    objective: typeof record.objective === "string" && record.objective.trim()
      ? record.objective.trim()
      : fallback?.objective,
    negativePrompt: typeof record.negativePrompt === "string" && record.negativePrompt.trim()
      ? record.negativePrompt.trim()
      : fallback?.negativePrompt,
    aspectRatio: typeof record.aspectRatio === "string" && record.aspectRatio.trim()
      ? record.aspectRatio.trim()
      : fallback?.aspectRatio,
    size: typeof record.size === "string" && record.size.trim()
      ? record.size.trim()
      : fallback?.size,
    resolution,
    quality: typeof record.quality === "string" && record.quality.trim()
      ? record.quality.trim()
      : fallback?.quality,
    count,
  };
}

function normalizeAgentModeBrochurePage(
  value: unknown,
  index: number,
): AgentModeBrochurePage {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const parsedPageNo = typeof record.pageNo === "number" && Number.isFinite(record.pageNo)
    ? Math.max(1, Math.round(record.pageNo))
    : index + 1;
  return {
    pageNo: parsedPageNo,
    role: typeof record.role === "string" && record.role.trim() ? record.role.trim() : `page_${parsedPageNo}`,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : `第 ${parsedPageNo} 页`,
    objective: typeof record.objective === "string" && record.objective.trim()
      ? record.objective.trim()
      : "延续整本风格，完成本页的关键信息表达。",
  };
}

function normalizeAgentModeBrochureProject(
  value: unknown,
  fallback?: Partial<AgentModeBrochureProject>,
): AgentModeBrochureProject {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fallbackOutline = Array.isArray(fallback?.outline) ? fallback.outline : [];
  const outline = Array.isArray(record.outline)
    ? record.outline
      .map((item, index) => normalizeAgentModeBrochurePage(item, index))
      .filter((item) => item.title)
    : fallbackOutline;
  const styleDirections = Array.isArray(record.styleDirections)
    ? record.styleDirections
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6)
    : (fallback?.styleDirections || []);
  const pageCount = typeof record.pageCount === "number" && Number.isFinite(record.pageCount)
    ? clampCount(Math.round(record.pageCount), 2, 20)
    : clampCount(Math.round(fallback?.pageCount || outline.length || 8), 2, 20);
  return {
    title: typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : fallback?.title || "宣传画册方案",
    companyName: typeof record.companyName === "string" && record.companyName.trim()
      ? record.companyName.trim()
      : fallback?.companyName,
    industry: typeof record.industry === "string" && record.industry.trim()
      ? record.industry.trim()
      : fallback?.industry,
    purpose: typeof record.purpose === "string" && record.purpose.trim()
      ? record.purpose.trim()
      : fallback?.purpose,
    pageCount,
    summary: typeof record.summary === "string" && record.summary.trim()
      ? record.summary.trim()
      : fallback?.summary || `共 ${pageCount} 页的宣传画册规划。`,
    outline: outline.length > 0 ? outline : fallbackOutline,
    styleDirections: styleDirections.length > 0 ? styleDirections : (fallback?.styleDirections || []),
    requestPrompt: typeof record.requestPrompt === "string" && record.requestPrompt.trim()
      ? record.requestPrompt.trim()
      : fallback?.requestPrompt,
  };
}

function normalizeAgentModeAnalysisPayload(
  value: unknown,
  fallback: AgentModeAnalysisResult,
  analysisModel: string,
): AgentModeAnalysisResult {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const intentType = normalizeAgentModeIntentType(record.intentType, fallback.intentType);
  const jobs = Array.isArray(record.jobs)
    ? record.jobs
      .map((item, index) => normalizeAgentModeJobSpec(item, fallback.jobs[index] || fallback.jobs[0]))
      .filter((job) => Boolean(job.prompt))
    : fallback.jobs;
  const brochureProjectSource = record.brochureProject ?? record.project;
  const brochureProject = brochureProjectSource
    ? normalizeAgentModeBrochureProject(brochureProjectSource, fallback.brochureProject)
    : fallback.brochureProject;
  return {
    intentType,
    confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? Math.max(0, Math.min(1, record.confidence))
      : fallback.confidence,
    reasoningSummary: typeof record.reasoningSummary === "string" && record.reasoningSummary.trim()
      ? record.reasoningSummary.trim()
      : fallback.reasoningSummary,
    estimatedCostLevel: normalizeAgentModeCostLevel(record.estimatedCostLevel, fallback.estimatedCostLevel),
    requiresConfirmation: typeof record.requiresConfirmation === "boolean"
      ? record.requiresConfirmation
      : fallback.requiresConfirmation,
    autoExecute: typeof record.autoExecute === "boolean" ? record.autoExecute : fallback.autoExecute,
    jobs: jobs.length > 0 ? jobs : fallback.jobs,
    brochureProject: intentType === "brochure_project" || brochureProject ? brochureProject : undefined,
    analysisModel,
    source: "ai",
  };
}

function countAgentModeImages(jobs: AgentModeJobSpec[]) {
  return jobs.reduce((sum, job) => sum + Math.max(1, Math.round(job.count || 1)), 0);
}

function recommendedAgentAspectRatio(prompt: string, fallback = "1:1") {
  if (/(封面|海报|竖版|人物全身|彩页封面)/.test(prompt)) return "3:4";
  if (/(画册|宣传册|内页|横版|跨页|目录|手册)/.test(prompt)) return "4:3";
  if (/(横幅|banner|页眉|头图|展板|宽屏)/i.test(prompt)) return "16:9";
  if (/(logo|图标|头像|方图|方形)/i.test(prompt)) return "1:1";
  return fallback;
}

function recommendedAgentResolution(prompt: string) {
  if (/(宣传册|画册|海报|展板|印刷|高清|高分辨率|封面)/.test(prompt)) return "2K" as const;
  return "1K" as const;
}

function detectRequestedImageCount(prompt: string, fallback = 1) {
  const patterns = [
    /(?:做|生成|出|要|需要|想要|帮我做)\s*([0-9一二三四五六七八九十两]+)\s*张/,
    /([0-9一二三四五六七八九十两]+)\s*张(?:图|图片|海报|方案|视觉|kv)?/,
    /一共\s*([0-9一二三四五六七八九十两]+)\s*张/,
  ];
  for (const pattern of patterns) {
    const matched = prompt.match(pattern)?.[1];
    const count = parseNaturalCountToken(matched || "");
    if (count && count > 0) return clampCount(count, 1, 8);
  }
  return fallback;
}

function detectRequestedPageCount(prompt: string, fallback = 8) {
  const patterns = [
    /([0-9一二三四五六七八九十两]+)\s*页/,
    /共\s*([0-9一二三四五六七八九十两]+)\s*页/,
    /包含\s*([0-9一二三四五六七八九十两]+)\s*页/,
  ];
  for (const pattern of patterns) {
    const matched = prompt.match(pattern)?.[1];
    const count = parseNaturalCountToken(matched || "");
    if (count && count > 0) return clampCount(count, 2, 20);
  }
  return fallback;
}

function extractCompanyName(prompt: string) {
  const patterns = [
    /(?:为|给|帮|替)\s*[「“"]?([^，。,.；;\s]{2,24}?公司)[」”"]?/,
    /([A-Za-z0-9\u4e00-\u9fa5]{2,24}?公司)/,
  ];
  for (const pattern of patterns) {
    const matched = prompt.match(pattern)?.[1]?.trim();
    if (!matched) continue;
    if (/^(我|你|他|她|它|帮我|给我|做一个|做个|一个|一家|某家|某个|这个|那个)/.test(matched)) continue;
    if (/^(制造业公司|科技公司|公司|企业公司)$/.test(matched)) continue;
    if (/(一个|一家|某家|某个).{0,8}公司$/.test(matched)) continue;
    return matched;
  }
  return "";
}

function detectIndustry(prompt: string) {
  const keywordMap: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /(科技|SaaS|软件|AI|人工智能|云服务|数据)/i, value: "科技" },
    { pattern: /(制造|工业|工厂|设备|机械|供应链)/, value: "制造" },
    { pattern: /(医疗|医药|生物|健康|医院)/, value: "医疗" },
    { pattern: /(教育|培训|学校|课程)/, value: "教育" },
    { pattern: /(地产|建筑|空间|园区|楼盘)/, value: "地产" },
    { pattern: /(金融|银行|证券|投资|保险)/, value: "金融" },
    { pattern: /(美妆|护肤|时尚|服饰|珠宝)/, value: "消费品牌" },
    { pattern: /(餐饮|食品|饮品|咖啡|酒水)/, value: "餐饮消费" },
  ];
  return keywordMap.find((item) => item.pattern.test(prompt))?.value || "企业品牌";
}

function detectBrochurePurpose(prompt: string) {
  if (/(宣传画册|宣传册|公司介绍|企业介绍|企业宣传|品牌手册)/.test(prompt)) return "公司宣传";
  if (/(招商|加盟|投资人)/.test(prompt)) return "招商宣传";
  if (/(产品|目录|样本|产品册)/.test(prompt)) return "产品目录";
  if (/(品牌|企业形象)/.test(prompt)) return "品牌介绍";
  if (/(年度|年报|总结)/.test(prompt)) return "年度介绍";
  return "公司宣传";
}

function brochureStyleDirectionsFor(industry: string, prompt: string) {
  if (industry === "科技") {
    return ["科技蓝信息栅格", "极简白底产品提案感", "深色发布会视觉", "未来感数据界面风"];
  }
  if (industry === "制造") {
    return ["工业蓝目录感", "黑银设备质感", "白底参数样本册", "展会招商海报感"];
  }
  if (industry === "医疗") {
    return ["洁净白蓝专业感", "高可信研究型版式", "温和品牌手册感", "器械产品目录感"];
  }
  if (/(高端|奢华|精品|时尚)/.test(prompt)) {
    return ["高端杂志感", "黑金品牌提案感", "留白大片感", "Editorial 视觉陈列风"];
  }
  return ["科技蓝信息栅格", "高端杂志感", "制造业目录感", "招商海报感"];
}

function splitPromptIntoSegments(prompt: string) {
  const prepared = prompt
    .replace(/\r/g, "")
    .replace(/(?=第\s*[0-9一二三四五六七八九十两]+\s*(?:张|幅|图|页))/g, "\n")
    .replace(/(?=\d+\s*[\.、\)]\s*)/g, "\n");
  return prepared
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripSegmentMarker(value: string) {
  return value
    .replace(/^\s*(?:[-*•]\s*)/, "")
    .replace(/^\s*\d+\s*[\.、\)]\s*/, "")
    .replace(/^\s*第\s*[0-9一二三四五六七八九十两]+\s*(?:张|幅|图|页)\s*[:：]?\s*/, "")
    .trim();
}

function extractBrochureTopics(prompt: string) {
  const candidates: Array<{ pattern: RegExp; role: string; title: string; objective: string }> = [
    { pattern: /(品牌导语|品牌介绍|前言|导语)/, role: "intro", title: "品牌导语", objective: "概括品牌定位与主张，建立阅读预期。" },
    { pattern: /(公司介绍|企业简介|企业介绍|公司简介)/, role: "profile", title: "企业简介", objective: "说明公司背景、规模、发展历程与核心业务。" },
    { pattern: /(核心优势|优势介绍|竞争优势)/, role: "advantages", title: "核心优势", objective: "突出技术、团队、供应链或服务的差异化优势。" },
    { pattern: /(产品展示|产品介绍|产品矩阵|服务矩阵|服务介绍)/, role: "products", title: "产品/服务矩阵", objective: "梳理主要产品线、解决方案或服务模块。" },
    { pattern: /(应用场景|解决方案|场景展示)/, role: "scenarios", title: "应用场景", objective: "展示产品或服务在真实业务场景中的价值。" },
    { pattern: /(案例|客户案例|项目案例|成功案例)/, role: "cases", title: "案例展示", objective: "通过项目案例强化可信度与落地能力。" },
    { pattern: /(团队|资质|荣誉|认证)/, role: "team", title: "团队与资质", objective: "呈现团队实力、认证资质、荣誉和合作资源。" },
    { pattern: /(合作方式|联系我们|联系方式|合作流程)/, role: "cta", title: "合作方式", objective: "明确合作流程、联系入口与行动指引。" },
  ];
  return candidates
    .map((item) => ({ ...item, index: prompt.search(item.pattern) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(({ role, title, objective }) => ({ role, title, objective }));
}

function buildLocalBrochureProject(prompt: string): AgentModeBrochureProject {
  const pageCount = detectRequestedPageCount(prompt, 8);
  const companyName = extractCompanyName(prompt);
  const industry = detectIndustry(prompt);
  const purpose = detectBrochurePurpose(prompt);
  const middleTemplates: Array<{ role: string; title: string; objective: string }> = [
    { role: "intro", title: "品牌导语", objective: "概括品牌定位与主张，建立阅读预期。" },
    { role: "profile", title: "企业简介", objective: "说明公司背景、规模、发展历程与核心业务。" },
    { role: "advantages", title: "核心优势", objective: "突出技术、团队、供应链或服务的差异化优势。" },
    { role: "products", title: "产品/服务矩阵", objective: "梳理主要产品线、解决方案或服务模块。" },
    { role: "scenarios", title: "应用场景", objective: "展示产品或服务在真实业务场景中的价值。" },
    { role: "cases", title: "案例展示", objective: "通过项目案例强化可信度与落地能力。" },
    { role: "team", title: "团队与资质", objective: "呈现团队实力、认证资质、荣誉和合作资源。" },
    { role: "cta", title: "合作方式", objective: "明确合作流程、联系入口与行动指引。" },
  ];
  const detectedTopics = extractBrochureTopics(prompt);
  const mergedTemplates = [
    ...detectedTopics,
    ...middleTemplates.filter((template) => !detectedTopics.some((item) => item.role === template.role)),
  ];
  const outline: AgentModeBrochurePage[] = [{
    pageNo: 1,
    role: "cover",
    title: "封面",
    objective: "建立品牌第一印象，突出公司名、主视觉与宣传主题。",
  }];
  const middleCount = Math.max(0, pageCount - 2);
  for (let index = 0; index < middleCount; index += 1) {
    const template = mergedTemplates[index % mergedTemplates.length];
    outline.push({
      pageNo: index + 2,
      role: template.role,
      title: template.title,
      objective: template.objective,
    });
  }
  if (pageCount > 1) {
    outline.push({
      pageNo: pageCount,
      role: "back_cover",
      title: "封底",
      objective: "收束品牌形象，保留联系方式或行动号召。",
    });
  }
  const titleBase = companyName || `${industry}企业`;
  const title = `${titleBase}${purpose === "产品目录" ? "产品画册" : "宣传画册"}`;
  return {
    title,
    companyName: companyName || undefined,
    industry,
    purpose,
    pageCount,
    summary: `识别为 ${pageCount} 页的${purpose}画册需求，建议先生成整本模板板，再逐页细化。`,
    outline,
    styleDirections: brochureStyleDirectionsFor(industry, prompt),
    requestPrompt: prompt,
  };
}

function buildLocalAgentModeAnalysis(body: ProxyBody): AgentModeAnalysisResult {
  const prompt = getString(body, "prompt");
  const aspectRatio = getString(body, "aspectRatio") || "1:1";
  const size = getString(body, "size") || undefined;
  const quality = getString(body, "quality") || "auto";
  const negativePrompt = getString(body, "negativePrompt") || undefined;
  const pageRefineMatch = prompt.match(/第\s*([0-9一二三四五六七八九十两]+)\s*页.*(?:修改|改成|重做|调整|优化|替换|单独再改)/);
  const brochureKeywordScore = [
    /(画册|宣传册|宣传画册|彩页|brochure)/i.test(prompt),
    /(封底|内页|页结构|页数|整本|版式模板)/.test(prompt),
    /第\s*[0-9一二三四五六七八九十两]+\s*页/.test(prompt),
  ].filter(Boolean).length;
  if (pageRefineMatch && brochureKeywordScore > 0) {
    const pageNo = parseNaturalCountToken(pageRefineMatch[1]) || 1;
    return {
      intentType: "page_refine",
      confidence: 0.86,
      reasoningSummary: `识别为宣传画册的单页调整需求，将按第 ${pageNo} 页单独重做。`,
      estimatedCostLevel: "low",
      requiresConfirmation: false,
      autoExecute: true,
      jobs: [{
        id: `page-refine-${pageNo}`,
        title: `第 ${pageNo} 页精修`,
        prompt: `为宣传画册单独重做第 ${pageNo} 页，保持整本视觉体系统一。用户要求：${prompt}`,
        objective: `优化第 ${pageNo} 页的版式、主视觉和信息层级。`,
        aspectRatio: "4:3",
        size,
        resolution: "2K",
        quality,
        negativePrompt,
        count: 1,
      }],
      analysisModel: "local-agent-heuristic",
      source: "local",
    };
  }
  if (brochureKeywordScore >= 2) {
    return {
      intentType: "brochure_project",
      confidence: 0.94,
      reasoningSummary: "识别为公司宣传画册任务，建议先生成整本模板板，再进入逐页细化。",
      estimatedCostLevel: "medium",
      requiresConfirmation: true,
      autoExecute: false,
      jobs: [],
      brochureProject: buildLocalBrochureProject(prompt),
      analysisModel: "local-agent-heuristic",
      source: "local",
    };
  }

  const segments = splitPromptIntoSegments(prompt);
  const explicitImageSegments = segments
    .filter((segment) => /^([-*•]|\d+\s*[\.、\)]|第\s*[0-9一二三四五六七八九十两]+\s*(?:张|幅|图))/.test(segment))
    .map(stripSegmentMarker)
    .filter(Boolean);
  if (explicitImageSegments.length >= 2) {
    const jobs = explicitImageSegments.map((segment, index) => ({
      id: `multi-${index + 1}`,
      title: `第 ${index + 1} 张`,
      prompt: segment,
      objective: "生成一张与其他任务明显区分的独立图片。",
      aspectRatio: recommendedAgentAspectRatio(segment, aspectRatio),
      size,
      resolution: recommendedAgentResolution(segment),
      quality,
      negativePrompt,
      count: 1,
    }));
    return {
      intentType: "multi_image_batch",
      confidence: 0.92,
      reasoningSummary: `识别到 ${jobs.length} 条独立图片需求，已按每张图分别拆解。`,
      estimatedCostLevel: countAgentModeImages(jobs) >= 5 ? "high" : "medium",
      requiresConfirmation: true,
      autoExecute: false,
      jobs,
      analysisModel: "local-agent-heuristic",
      source: "local",
    };
  }

  const requestedCount = detectRequestedImageCount(prompt, 1);
  if (requestedCount > 1) {
    const jobs: AgentModeJobSpec[] = [{
      id: "multi-count-1",
      title: requestedCount > 1 ? `同主题多图 · ${requestedCount} 张` : "图片任务",
      prompt,
      objective: "按同一主题生成多张候选图，可后续继续细分每张图的差异要求。",
      aspectRatio: recommendedAgentAspectRatio(prompt, aspectRatio),
      size,
      resolution: recommendedAgentResolution(prompt),
      quality,
      negativePrompt,
      count: requestedCount,
    }];
    return {
      intentType: "multi_image_batch",
      confidence: 0.8,
      reasoningSummary: `识别到需要 ${requestedCount} 张图片，但未拆出逐张描述，先按同主题多图方案处理。`,
      estimatedCostLevel: requestedCount >= 5 ? "high" : "medium",
      requiresConfirmation: true,
      autoExecute: false,
      jobs,
      analysisModel: "local-agent-heuristic",
      source: "local",
    };
  }

  return {
    intentType: "single_image",
    confidence: 0.96,
    reasoningSummary: "识别为单张图片需求，已准备直接进入生成。",
    estimatedCostLevel: "low",
    requiresConfirmation: false,
    autoExecute: true,
    jobs: [{
      id: "single-1",
      title: "主图生成",
      prompt,
      objective: "根据提示词直接生成单张主图。",
      aspectRatio: recommendedAgentAspectRatio(prompt, aspectRatio),
      size,
      resolution: recommendedAgentResolution(prompt),
      quality,
      negativePrompt,
      count: 1,
    }],
    analysisModel: "local-agent-heuristic",
    source: "local",
  };
}

async function analyzeAgentModeWithGpt(
  baseUrl: string,
  apiKey: string,
  body: ProxyBody,
  requestId?: string,
  callbacks: AnalyzeStreamCallbacks = {},
) {
  const analysisModel = getString(body, "analysisModel");
  const prompt = getString(body, "prompt");
  if (!analysisModel) throw new Error("分析模型不能为空");
  if (!prompt) throw new Error("提示词不能为空");
  if (!apiKey) throw new Error("API Key 不能为空");

  const localFallback = buildLocalAgentModeAnalysis(body);
  const context = {
    prompt,
    protocol: getString(body, "protocol"),
    imageModel: getString(body, "imageModel"),
    aspectRatio: getString(body, "aspectRatio"),
    size: getString(body, "size"),
    resolution: getString(body, "resolution"),
    quality: getString(body, "quality"),
    outputFormat: getString(body, "outputFormat"),
    count: getNumber(body.count),
    referenceCount: getNumber(body.referenceCount) || 0,
  };
  const systemPrompt = readConfigStore().systemPrompts.agentAnalyze || DEFAULT_AGENT_ANALYZE_SYSTEM_PROMPT;

  const upstreamPayload = {
    model: analysisModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(context, null, 2) },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
    stream: true,
  };
  if (requestId) {
    updateRequestLog(requestId, {
      upstreamPayloadKeys: Object.keys(upstreamPayload),
      upstreamRequest: sanitizeForLog(upstreamPayload),
    });
  }

  const response = await fetchWithTimeout(endpoint(baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(upstreamPayload),
  }, 60_000);
  callbacks.onUpstreamConnected?.(response.status);
  if (!response.ok) {
    const bodyText = await response.text();
    const detail = detailFromUpstream(response.status, bodyText);
    if (requestId) {
      updateRequestLog(requestId, {
        responseBody: sanitizeForLog({
          ok: false,
          status: response.status,
          detail,
          rawContent: truncateText(bodyText, 4000),
        }),
      });
    }
    throw detail;
  }
  if (!response.body) {
    throw new Error("上游返回空响应体");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let firstByteReported = false;
  let finishReason: string | undefined;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!firstByteReported) {
        callbacks.onFirstByte?.();
        firstByteReported = true;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        let chunk: unknown;
        try {
          chunk = JSON.parse(dataStr);
        } catch {
          continue;
        }
        const choice = chunk && typeof chunk === "object"
          ? ((chunk as { choices?: unknown }).choices as Array<Record<string, unknown>> | undefined)?.[0]
          : undefined;
        const delta = choice && typeof choice === "object" ? (choice.delta as Record<string, unknown> | undefined) : undefined;
        const deltaContent = delta && typeof delta.content === "string" ? delta.content : "";
        if (deltaContent) {
          accumulated += deltaContent;
          callbacks.onChunk?.(deltaContent, accumulated);
        }
        if (typeof choice?.finish_reason === "string") {
          finishReason = choice.finish_reason as string;
        }
      }
    }
    if (buffer.startsWith("data:")) {
      const tail = buffer.slice(5).trim();
      if (tail && tail !== "[DONE]") {
        try {
          const chunk = JSON.parse(tail);
          const deltaContent = (chunk?.choices?.[0]?.delta?.content as string) || "";
          if (deltaContent) {
            accumulated += deltaContent;
            callbacks.onChunk?.(deltaContent, accumulated);
          }
        } catch {
          // ignore trailing partial
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (!accumulated.trim()) {
    if (requestId) {
      updateRequestLog(requestId, {
        responseBody: sanitizeForLog({ ok: false, status: response.status, error: "Agent 分析 stream 没有返回任何内容", finishReason }),
      });
    }
    throw new Error("分析模型返回空内容");
  }

  const analysis = parseMaybeJson(extractJsonObject(accumulated));
  if (!analysis || typeof analysis !== "object") {
    if (requestId) {
      updateRequestLog(requestId, {
        responseBody: sanitizeForLog({
          ok: false,
          status: response.status,
          error: "Agent 分析模型没有返回可解析的 JSON",
          finishReason,
          rawContent: truncateText(accumulated, 4000),
        }),
      });
    }
    throw new Error("Agent 分析结果不是有效 JSON");
  }
  const normalized = normalizeAgentModeAnalysisPayload(analysis, localFallback, analysisModel);
  if (requestId) {
    updateRequestLog(requestId, {
      responseBody: sanitizeForLog({
        ok: true,
        status: response.status,
        finishReason,
        rawContent: truncateText(accumulated, 4000),
        analysis: normalized,
      }),
    });
  }
  return normalized;
}

type AnalyzeStreamCallbacks = {
  onUpstreamConnected?: (status: number) => void;
  onFirstByte?: () => void;
  onChunk?: (delta: string, accumulated: string) => void;
};

async function analyzePromptWithGpt(
  baseUrl: string,
  apiKey: string,
  body: ProxyBody,
  requestId?: string,
  callbacks: AnalyzeStreamCallbacks = {},
) {
  const analysisModel = getString(body, "analysisModel");
  const prompt = getString(body, "prompt");
  if (!analysisModel) throw new Error("分析模型不能为空");
  if (!prompt) throw new Error("提示词不能为空");
  if (!apiKey) throw new Error("API Key 不能为空");

  const context = {
    prompt,
    negativePrompt: getString(body, "negativePrompt"),
    protocol: getString(body, "protocol"),
    imageModel: getString(body, "imageModel"),
    aspectRatio: getString(body, "aspectRatio"),
    size: getString(body, "size"),
    resolution: getString(body, "resolution"),
    quality: getString(body, "quality"),
    outputFormat: getString(body, "outputFormat"),
    count: getNumber(body.count),
    concurrency: getNumber(body.concurrency),
    referenceCount: getNumber(body.referenceCount) || 0,
    referenceIssues: Array.isArray(body.referenceIssues) ? body.referenceIssues : [],
    mode: getString(body, "mode") || "send",
  };
  const systemPrompt = readConfigStore().systemPrompts.promptAnalyze || DEFAULT_PROMPT_ANALYZE_SYSTEM_PROMPT;

  const upstreamPayload = {
    model: analysisModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(context, null, 2) },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    stream: true,
  };
  if (requestId) {
    updateRequestLog(requestId, {
      upstreamPayloadKeys: Object.keys(upstreamPayload),
      upstreamRequest: sanitizeForLog(upstreamPayload),
    });
  }

  const response = await fetchWithTimeout(endpoint(baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(upstreamPayload),
  }, 60_000);
  callbacks.onUpstreamConnected?.(response.status);
  if (!response.ok) {
    const errorText = await response.text();
    const detail = detailFromUpstream(response.status, errorText);
    if (requestId) {
      updateRequestLog(requestId, {
        responseBody: sanitizeForLog({ ok: false, status: response.status, detail, errorRaw: truncateText(errorText, 2500) }),
      });
    }
    throw detail;
  }
  if (!response.body) {
    throw new Error("上游返回空响应体");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let firstByteReported = false;
  let finishReason: string | undefined;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!firstByteReported) {
        callbacks.onFirstByte?.();
        firstByteReported = true;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        let chunk: unknown;
        try {
          chunk = JSON.parse(dataStr);
        } catch {
          continue;
        }
        const choice = chunk && typeof chunk === "object"
          ? ((chunk as { choices?: unknown }).choices as Array<Record<string, unknown>> | undefined)?.[0]
          : undefined;
        const delta = choice && typeof choice === "object" ? (choice.delta as Record<string, unknown> | undefined) : undefined;
        const deltaContent = delta && typeof delta.content === "string" ? delta.content : "";
        if (deltaContent) {
          accumulated += deltaContent;
          callbacks.onChunk?.(deltaContent, accumulated);
        }
        if (typeof choice?.finish_reason === "string") {
          finishReason = choice.finish_reason as string;
        }
      }
    }
    if (buffer.startsWith("data:")) {
      const tail = buffer.slice(5).trim();
      if (tail && tail !== "[DONE]") {
        try {
          const chunk = JSON.parse(tail);
          const deltaContent = (chunk?.choices?.[0]?.delta?.content as string) || "";
          if (deltaContent) {
            accumulated += deltaContent;
            callbacks.onChunk?.(deltaContent, accumulated);
          }
        } catch {
          // ignore trailing partial
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (!accumulated.trim()) {
    if (requestId) {
      updateRequestLog(requestId, {
        responseBody: sanitizeForLog({ ok: false, status: response.status, error: "上游 stream 没有返回任何内容", finishReason }),
      });
    }
    throw new Error("分析模型返回空内容");
  }

  const analysis = parseMaybeJson(extractJsonObject(accumulated));
  if (!analysis || typeof analysis !== "object") {
    if (requestId) {
      updateRequestLog(requestId, {
        responseBody: sanitizeForLog({
          ok: false,
          status: response.status,
          error: "分析模型没有返回可解析的 JSON",
          finishReason,
          rawContent: truncateText(accumulated, 4000),
          accumulatedBytes: Buffer.byteLength(accumulated, "utf8"),
        }),
      });
    }
    throw new Error("分析模型没有返回可解析的 JSON");
  }
  const normalizedAnalysis = normalizeAnalysisPayload(analysis, analysisModel);
  if (requestId) {
    updateRequestLog(requestId, {
      responseBody: sanitizeForLog({
        ok: true,
        status: response.status,
        finishReason,
        accumulatedBytes: Buffer.byteLength(accumulated, "utf8"),
        rawContent: truncateText(accumulated, 4000),
        analysis: normalizedAnalysis,
      }),
    });
  }
  return normalizedAnalysis;
}

async function readOpenAiImageResponse(response: Response, outputFormat: string): Promise<ImageResult> {
  const bodyText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      detail: detailFromUpstream(response.status, bodyText),
    };
  }

  const json = parseMaybeJson(bodyText);
  if (!json || typeof json !== "object" || !("data" in json)) {
    return {
      ok: false,
      status: response.status,
      detail: { status: response.status, error: "接口返回格式不是 images API 格式", raw: json },
    };
  }

  const mime = outputMime(outputFormat);
  const items = Array.isArray((json as { data?: unknown }).data)
    ? ((json as { data: unknown[] }).data)
    : [];

  const images = await Promise.all(
    items.map(async (item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as { b64_json?: string; url?: string; revised_prompt?: string };
      if (record.b64_json) {
        return {
          dataUrl: dataUrlFromBase64(record.b64_json, mime),
          revisedPrompt: record.revised_prompt || "",
        };
      }
      if (record.url) {
        return {
          dataUrl: await urlToDataUrl(record.url),
          revisedPrompt: record.revised_prompt || "",
        };
      }
      return null;
    }),
  );

  const usableImages = images.filter(Boolean) as Array<{ dataUrl: string; revisedPrompt?: string }>;
  if (usableImages.length === 0) {
    return {
      ok: false,
      status: response.status,
      detail: { status: response.status, error: "接口没有返回可识别的图片数据", raw: json },
    };
  }

  return {
    ok: true,
    status: response.status,
    images: usableImages,
    raw: json,
  };
}

async function readGenericJsonImageResponse(response: Response, outputFormat: string): Promise<ImageResult> {
  const bodyText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      detail: detailFromUpstream(response.status, bodyText),
    };
  }
  const json = parseMaybeJson(bodyText);
  const imageData = collectImageData(json);
  const textParts = collectText(json);
  if (imageData.length === 0) {
    return {
      ok: false,
      status: response.status,
      detail: { status: response.status, error: "接口没有返回可识别的图片数据", raw: json },
    };
  }
  return {
    ok: true,
    status: response.status,
    images: imageData.map((data) => ({
      dataUrl: dataUrlFromBase64(data, outputMime(outputFormat)),
      revisedPrompt: textParts.join("\n").trim(),
    })),
    raw: json,
  };
}

async function generateOpenAiImageEdit(baseUrl: string, apiKey: string, request: GenerateRequest, references: ReferenceImage[], requestId?: string) {
  const outputFormat = request.outputFormat || "png";
  const requestSize = imageSizeForProtocol(request, "openai-images");
  const form = new FormData();
  form.append("model", request.model || "gpt-image-2");
  form.append("prompt", fullPrompt(request));
  form.append("n", "1");
  form.append("response_format", "b64_json");
  if (requestSize && requestSize !== "auto") form.append("size", requestSize);
  if (request.quality && request.quality !== "auto") form.append("quality", request.quality);
  if (outputFormat && outputFormat !== "png") form.append("output_format", outputFormat);
  references.forEach((image, index) => {
    const { mime, data } = referenceImageToBuffer(image);
    const fileName = image.name || `reference-${index + 1}.${mime.split("/")[1] || "png"}`;
    form.append("image[]", new Blob([data], { type: mime }), fileName);
  });

  if (requestId) {
    updateRequestLog(requestId, {
      endpoint: "/v1/images/edits",
      upstreamPayloadKeys: [
        "model",
        "prompt",
        "n",
        "response_format",
        ...(requestSize && requestSize !== "auto" ? ["size"] : []),
        ...(request.quality && request.quality !== "auto" ? ["quality"] : []),
        ...(outputFormat && outputFormat !== "png" ? ["output_format"] : []),
        "image[]",
      ],
      upstreamReferenceCount: references.length,
      upstreamReferenceMode: "multipart:image[]",
      upstreamSize: requestSize && requestSize !== "auto" ? requestSize : undefined,
      upstreamRequest: sanitizeForLog({
        model: request.model || "gpt-image-2",
        prompt: fullPrompt(request),
        n: 1,
        response_format: "b64_json",
        size: requestSize && requestSize !== "auto" ? requestSize : undefined,
        quality: request.quality && request.quality !== "auto" ? request.quality : undefined,
        output_format: outputFormat && outputFormat !== "png" ? outputFormat : undefined,
        referenceImages: references,
      }),
    });
  }

  const response = await fetchWithTimeout(endpoint(baseUrl, "/v1/images/edits"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  return readOpenAiImageResponse(response, outputFormat);
}

async function generateOpenAiCompatible(baseUrl: string, apiKey: string, request: GenerateRequest, requestId?: string, publicBaseUrl = "") {
  const protocol = request.protocol || DEFAULT_PROTOCOL;
  const references = Array.isArray(request.referenceImages) ? request.referenceImages : [];
  const outputFormat = request.outputFormat || "png";
  let editFallback: Record<string, unknown> | undefined;
  if (protocol === "openai-images" && references.length > 0) {
    const editResult = await generateOpenAiImageEdit(baseUrl, apiKey, request, references, requestId);
    if (editResult.ok || !shouldFallbackReferenceEditToGeneration(editResult)) {
      return editResult;
    }
    const summary = safeErrorSummary(editResult.detail);
    editFallback = {
      from: "/v1/images/edits",
      status: editResult.status,
      reason: summary.message,
      type: summary.type,
      code: summary.code,
    };
  }
  const requestSize = imageSizeForProtocol(request, protocol);
  const payload: Record<string, unknown> = {
    model: request.model,
    prompt: fullPrompt(request),
    n: 1,
    response_format: "b64_json",
  };
  if (requestSize && requestSize !== "auto") payload.size = requestSize;
  if (request.quality && request.quality !== "auto") payload.quality = request.quality;
  if (outputFormat && outputFormat !== "png") payload.output_format = outputFormat;
  if (request.aspectRatio && protocol === "custom-openai" && !isGptImage2Model(request.model)) payload.aspect_ratio = request.aspectRatio;
  if (protocol === "custom-openai" && !isGptImage2Model(request.model) && request.resolution && request.resolution !== "1K") {
    payload.resolution = request.resolution;
  }
  if (request.seed) payload.seed = Number.isFinite(Number(request.seed)) ? Number(request.seed) : request.seed;

  const path = protocol === "gemini-openai" ? "/images/generations" : "/v1/images/generations";
  const referencePayloads = references.length > 0 && (protocol === "custom-openai" || protocol === "openai-images")
    ? compatibleReferenceImagePayloads(references, publicBaseUrl)
    : [];
  const attempts = referencePayloads.length > 0 ? referencePayloads : [undefined];
  const referenceAttemptErrors: Array<Record<string, unknown>> = [];
  let lastResult: ImageResult | undefined;

  try {
    for (const [attemptIndex, referencePayload] of attempts.entries()) {
      const attemptPayload = { ...payload };
      let referenceMode = "none";
      let referenceCount = 0;
      if (referencePayload && referencePayload.urls.length > 0) {
        attemptPayload[referencePayload.field] = referencePayload.urls;
        referenceMode = editFallback
          ? `${referencePayload.mode}:fallback_from_edits_${editFallback.status || "error"}`
          : referencePayload.mode;
        referenceCount = referencePayload.urls.length;
      }

      if (requestId) {
        updateRequestLog(requestId, {
          endpoint: path,
          upstreamPayloadKeys: Object.keys(attemptPayload),
          upstreamReferenceCount: referenceCount,
          upstreamReferenceMode: referenceMode,
          upstreamSize: typeof attemptPayload.size === "string" ? attemptPayload.size : undefined,
          referenceUploadStatus: referenceCount > 0 ? "forwarded" : undefined,
          upstreamRequest: sanitizeForLog({
            ...attemptPayload,
            ...(editFallback ? { _proxyFallback: editFallback } : {}),
            _proxyReferenceAttempt: attemptIndex + 1,
            _proxyReferenceAttemptErrors: referenceAttemptErrors,
          }),
        });
      }

      try {
        const response = await fetchWithTimeout(endpoint(baseUrl, path), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(attemptPayload),
        });
        const result = await readOpenAiImageResponse(response, outputFormat);
        if (result.ok) return result;
        lastResult = result;
        const summary = safeErrorSummary(result.detail);
        referenceAttemptErrors.push({
          attempt: attemptIndex + 1,
          field: referencePayload?.field || "none",
          mode: referenceMode,
          status: result.status,
          message: summary.message,
          type: summary.type,
          code: summary.code,
        });
        if (!referencePayload || attemptIndex >= attempts.length - 1 || !shouldTryNextReferencePayload(result)) {
          return result;
        }
      } finally {
        referencePayload?.cleanup?.();
      }
    }
  } finally {
    referencePayloads.forEach((item) => item.cleanup?.());
  }

  return lastResult || {
    ok: false,
    status: 500,
    detail: { error: "参考图请求没有得到有效响应" },
  };
}

async function generateOpenAiResponses(baseUrl: string, apiKey: string, request: GenerateRequest, requestId?: string) {
  const outputFormat = request.outputFormat || "png";
  const imageTool: Record<string, unknown> = {
    type: "image_generation",
  };
  if (request.size && request.size !== "auto") imageTool.size = request.size;
  if (request.quality && request.quality !== "auto") imageTool.quality = request.quality;
  if (outputFormat) imageTool.output_format = outputFormat;

  const upstreamPayload = {
    model: request.model,
    input: fullPrompt(request),
    tools: [imageTool],
  };
  if (requestId) {
    updateRequestLog(requestId, {
      endpoint: "/v1/responses",
      upstreamPayloadKeys: Object.keys(upstreamPayload),
      upstreamRequest: sanitizeForLog(upstreamPayload),
      upstreamSize: typeof imageTool.size === "string" ? imageTool.size : undefined,
    });
  }
  const response = await fetchWithTimeout(endpoint(baseUrl, "/v1/responses"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(upstreamPayload),
  });
  return readGenericJsonImageResponse(response, outputFormat);
}

async function generateGeminiNative(baseUrl: string, apiKey: string, request: GenerateRequest, requestId?: string) {
  const references = Array.isArray(request.referenceImages) ? request.referenceImages : [];
  const outputFormat = request.outputFormat || "png";
  const parts = [
    { text: fullPrompt(request) },
    ...references.map(dataUrlToGeminiPart),
  ];
  const imageConfig: Record<string, unknown> = {
    aspectRatio: request.aspectRatio || "1:1",
  };
  if (isGemini3ProImageModel(request.model)) {
    imageConfig.imageSize = normalizeResolution(request.resolution);
  }
  const upstreamPayload = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig,
    },
  };
  if (requestId) {
    updateRequestLog(requestId, {
      endpoint: `${GEMINI_NATIVE_API_PREFIX}/models/${modelName(request.model)}:generateContent`,
      upstreamPayloadKeys: Object.keys(upstreamPayload),
      upstreamReferenceCount: references.length,
      upstreamReferenceMode: references.length ? "gemini:parts:inline_data" : "none",
      upstreamSize: typeof imageConfig.imageSize === "string" ? imageConfig.imageSize : undefined,
      upstreamRequest: sanitizeForLog(upstreamPayload),
    });
  }
  const response = await fetchWithTimeout(endpoint(baseUrl, `${GEMINI_NATIVE_API_PREFIX}/models/${modelName(request.model)}:generateContent`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(upstreamPayload),
  });
  return readGenericJsonImageResponse(response, outputFormat);
}

async function generateImagen(baseUrl: string, apiKey: string, request: GenerateRequest, requestId?: string) {
  const outputFormat = request.outputFormat || "png";
  const parameters: Record<string, unknown> = {
    sampleCount: 1,
    aspectRatio: request.aspectRatio || "1:1",
    outputMimeType: outputMime(outputFormat),
  };
  if (request.negativePrompt) parameters.negativePrompt = request.negativePrompt;
  if (request.seed) parameters.seed = Number.isFinite(Number(request.seed)) ? Number(request.seed) : request.seed;

  const upstreamPayload = {
    instances: [{ prompt: request.prompt }],
    parameters,
  };
  if (requestId) {
    updateRequestLog(requestId, {
      endpoint: `/models/${modelName(request.model)}:predict`,
      upstreamPayloadKeys: Object.keys(upstreamPayload),
      upstreamRequest: sanitizeForLog(upstreamPayload),
    });
  }
  const response = await fetchWithTimeout(endpoint(baseUrl, `/models/${modelName(request.model)}:predict`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(upstreamPayload),
  });
  return readGenericJsonImageResponse(response, outputFormat);
}

async function generateStability(baseUrl: string, apiKey: string, request: GenerateRequest, requestId?: string) {
  const outputFormat = request.outputFormat === "jpeg" ? "jpeg" : request.outputFormat || "png";
  const form = new FormData();
  form.append("prompt", request.prompt || "");
  form.append("output_format", outputFormat);
  if (request.aspectRatio) form.append("aspect_ratio", request.aspectRatio);
  if (request.negativePrompt) form.append("negative_prompt", request.negativePrompt);
  if (request.seed) form.append("seed", String(Number.isFinite(Number(request.seed)) ? Number(request.seed) : request.seed));

  const path = String(request.model || "").includes("ultra")
    ? "/v2beta/stable-image/generate/ultra"
    : "/v2beta/stable-image/generate/core";
  if (requestId) {
    updateRequestLog(requestId, {
      endpoint: path,
      upstreamPayloadKeys: ["prompt", "output_format", ...(request.aspectRatio ? ["aspect_ratio"] : []), ...(request.negativePrompt ? ["negative_prompt"] : []), ...(request.seed ? ["seed"] : [])],
      upstreamRequest: sanitizeForLog({
        prompt: request.prompt || "",
        output_format: outputFormat,
        aspect_ratio: request.aspectRatio,
        negative_prompt: request.negativePrompt,
        seed: request.seed,
      }),
    });
  }
  const response = await fetchWithTimeout(endpoint(baseUrl, path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "image/*",
    },
    body: form,
  });

  const contentType = response.headers.get("content-type") || outputMime(outputFormat);
  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      status: response.status,
      detail: detailFromUpstream(response.status, text),
    };
  }

  if (contentType.includes("application/json")) {
    return readGenericJsonImageResponse(response, outputFormat);
  }

  const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
  return {
    ok: true,
    status: response.status,
    images: [{
      dataUrl: dataUrlFromBase64(bytes, contentType),
      revisedPrompt: "",
    }],
    raw: { contentType },
  };
}

async function loadUpstreamModels(protocol: ImageProtocol, baseUrl: string, apiKey: string) {
  if (!apiKey || protocol === "stability-core") {
    return { models: DEFAULT_MODELS[protocol], raw: { source: "preset" } };
  }

  if (protocol === "gemini-native" || protocol === "google-imagen") {
    const path = protocol === "gemini-native" ? `${GEMINI_NATIVE_API_PREFIX}/models` : "/models";
    const response = await fetchWithTimeout(endpoint(baseUrl, path), {
      headers: { "x-goog-api-key": apiKey },
    });
    const text = await response.text();
    if (!response.ok) throw detailFromUpstream(response.status, text);
    const payload = parseMaybeJson(text);
    let models = extractModelIds(payload, "models");
    if (protocol === "google-imagen") {
      models = models.filter((model) => model.toLowerCase().includes("imagen"));
    }
    return { models: [...new Set([...DEFAULT_MODELS[protocol], ...models])], raw: payload };
  }

  const path = protocol === "gemini-openai" ? "/models" : "/v1/models";
  const response = await fetchWithTimeout(endpoint(baseUrl, path), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await response.text();
  if (!response.ok) throw detailFromUpstream(response.status, text);
  const payload = parseMaybeJson(text);
  const models = extractModelIds(payload, "data");
  return { models: [...new Set([...DEFAULT_MODELS[protocol], ...models])], raw: payload };
}

async function handleSquareFeed(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  const url = new URL(req.url || "/", "http://localhost");
  const tab = normalizeSquareFeedTab(url.searchParams.get("tab"));
  const limit = Math.max(1, Math.min(readConfigStore().quotas.squareMaxFeed, Number(url.searchParams.get("limit")) || readConfigStore().quotas.squareMaxFeed));
  const offset = squareCursorOffset(url.searchParams.get("cursor"));
  const apiKey = String(req.headers["x-imagehub-api-key"] || "").trim();
  const viewerHash = apiKey ? hashApiKey(apiKey) : "";
  const store = readSquareStore();
  const sorted = sortSquareItems(squareActiveItems(store), tab);
  const items = sorted.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  sendJson(res, 200, {
    ok: true,
    tab,
    items: items.map((item) => squareFeedItem(item, store, tab, viewerHash, squareRankScoreCache.get(item))),
    nextCursor: nextOffset < sorted.length ? squareNextCursor(nextOffset) : "",
    hasMore: nextOffset < sorted.length,
  });
}

async function handleSquareQuota(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  const apiKey = String(req.headers["x-imagehub-api-key"] || "").trim();
  if (!apiKey) {
    sendJson(res, 401, { ok: false, error: "推荐和点赞需要先配置 API Key" });
    return;
  }
  const apiKeyHash = hashApiKey(apiKey);
  const store = readSquareStore();
  const quota = getSquareQuota(store, apiKeyHash);
  writeSquareStore(store);
  sendJson(res, 200, {
    ok: true,
    dailyRecommendUsed: quota.dailyRecommendUsed,
    dailyRecommendLeft: squareRemainingRecommendQuota(quota),
    dailyLikeUsed: quota.dailyLikeUsed,
    dailyLikeLeft: squareRemainingLikeQuota(quota),
    shelfCount: squareShelfCount(store, apiKeyHash),
    shelfLimit: readConfigStore().quotas.squareShelfLimit,
    dayKey: quota.dateKey,
  });
}

async function handleSquareRecommend(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  const requestId = randomUUID();
  const clientMeta = squareClientMeta(req);
  try {
    const body = await readJsonBody(req);
    const apiKey = getString(body, "apiKey");
    if (!apiKey) {
      sendJson(res, 401, { ok: false, status: "rejected", action: "rejected", error: "推荐到广场需要先配置 API Key" });
      return;
    }
    const apiKeyHash = hashApiKey(apiKey);
    const store = readSquareStore();
    const quota = getSquareQuota(store, apiKeyHash);
    const reject = (status: number, reasonCode: string, error: string, extra: Partial<SquareRecommendLog> = {}) => {
      appendSquareRecommendLog(store, {
        requestId,
        apiKeyHash,
        action: "rejected",
        result: "rejected",
        reasonCode,
        remainingDailyQuota: squareRemainingRecommendQuota(quota),
        remainingShelfSlots: Math.max(0, readConfigStore().quotas.squareShelfLimit - squareShelfCount(store, apiKeyHash)),
        ...clientMeta,
        ...extra,
      });
      writeSquareStore(store);
      sendJson(res, status, {
        ok: false,
        status: "rejected",
        action: "rejected",
        reasonCode,
        error,
        remainingDailyQuota: squareRemainingRecommendQuota(quota),
        remainingShelfSlots: Math.max(0, readConfigStore().quotas.squareShelfLimit - squareShelfCount(store, apiKeyHash)),
      });
    };

    if (quota.dailyRecommendUsed >= readConfigStore().quotas.squareDailyRecommend) {
      reject(429, "daily_recommend_quota_exceeded", "今日推荐额度已满");
      return;
    }
    quota.dailyRecommendUsed += 1;
    quota.updatedAt = Date.now();

    const sourceImageMeta = getRecord(body.sourceImageMeta);
    const params = getRecord(body.params);
    const thumbnailDataUrl = getString(body, "thumbnailDataUrl")
      || getNestedString(sourceImageMeta, "thumbnailDataUrl")
      || getNestedString(sourceImageMeta, "imageDataUrl");
    const imageId = getString(body, "imageId") || getNestedString(sourceImageMeta, "imageId") || randomUUID();
    const prompt = getString(body, "prompt");
    const caption = getString(body, "caption") || truncateText(prompt.replace(/\s+/g, " "), 140);
    const sourceType = getString(body, "sourceType") || "local_history";
    const model = getString(body, "model") || getNestedString(sourceImageMeta, "model") || "unknown";
    const width = getNumber(body.width) || getNestedNumber(sourceImageMeta, "width");
    const height = getNumber(body.height) || getNestedNumber(sourceImageMeta, "height");
    const reasonPlan = body.reasonPlan;
    const promptHash = prompt ? hashText(prompt, 32) : undefined;

    if (!thumbnailDataUrl) {
      reject(400, "missing_square_thumbnail", "缺少广场展示图", { imageId, promptHash, sourceType });
      return;
    }
    if (!/^data:image\/[a-zA-Z+.-]+;base64,/.test(thumbnailDataUrl)) {
      reject(400, "invalid_square_thumbnail", "广场展示图格式无效", { imageId, promptHash, sourceType });
      return;
    }
    const thumbnailBytes = imageBytesFromDataUrl(thumbnailDataUrl);
    if (thumbnailBytes <= 0 || thumbnailBytes > SQUARE_MAX_IMAGE_BYTES) {
      reject(413, "square_thumbnail_too_large", "广场展示图过大，请压缩后再推荐", { imageId, promptHash, sourceType });
      return;
    }
    if (!prompt) {
      reject(400, "missing_prompt", "推荐到广场需要保留提示词", { imageId, sourceType });
      return;
    }
    const moderationReason = moderationReasonForSquareText(prompt, caption);
    if (moderationReason) {
      appendSquareModerationAudit(store, {
        requestId,
        apiKeyHash,
        imageId,
        event: "recommend_rejected",
        reasonCode: moderationReason,
        severity: "high",
        ...clientMeta,
        detail: sanitizeForLog({ prompt, caption }),
      });
      reject(422, moderationReason, "内容需要人工复核，暂不进入广场", { imageId, promptHash, sourceType });
      return;
    }
    if (recentSquareRecommendCount(store, apiKeyHash, 60_000) >= 8) {
      appendSquareModerationAudit(store, {
        requestId,
        apiKeyHash,
        imageId,
        event: "recommend_backoff",
        reasonCode: "rapid_submit_backoff",
        severity: "medium",
        ...clientMeta,
      });
      reject(429, "rapid_submit_backoff", "提交过于频繁，请稍后再试", { imageId, promptHash, sourceType });
      return;
    }

    const imageHash = hashImageDataUrl(thumbnailDataUrl);
    const duplicatedBySelf = squareActiveItems(store).find((item) => item.recommenderHash === apiKeyHash && item.imageHash === imageHash);
    if (duplicatedBySelf) {
      appendSquareModerationAudit(store, {
        requestId,
        apiKeyHash,
        itemId: duplicatedBySelf.id,
        imageId,
        event: "duplicate_content",
        reasonCode: "duplicate_active_item",
        severity: "low",
        ...clientMeta,
      });
      reject(409, "duplicate_active_item", "这张图已经在你的广场展示位中", { imageId, itemId: duplicatedBySelf.id, imageHash, promptHash, sourceType });
      return;
    }

    const now = Date.now();
    const activeByKey = squareActiveItems(store)
      .filter((item) => item.recommenderHash === apiKeyHash)
      .sort((a, b) => a.createdAt - b.createdAt);
    const action: "added" | "replaced" = activeByKey.length >= readConfigStore().quotas.squareShelfLimit ? "replaced" : "added";
    const replaced = action === "replaced" ? activeByKey[0] : undefined;
    const itemId = randomUUID();
    if (replaced) {
      replaced.active = false;
      replaced.replacedById = itemId;
      replaced.updatedAt = now;
    }

    const item: SquareItem = {
      id: itemId,
      imageId,
      requestId: getNestedString(sourceImageMeta, "requestId") || undefined,
      thumbnailDataUrl,
      imageHash,
      prompt: truncateText(prompt, 4000),
      caption: truncateText(caption || prompt, 240),
      model: truncateText(model, 240),
      params: sanitizeForLog(params) as Record<string, unknown>,
      width,
      height,
      aspectRatio: getNestedString(sourceImageMeta, "aspectRatio") || (typeof params.aspectRatio === "string" ? params.aspectRatio : undefined),
      sourceType,
      reasonPlan: sanitizeForLog(reasonPlan),
      recommenderHash: apiKeyHash,
      recommenderLabel: `创作者 ${apiKeyHash.slice(0, 6)}`,
      pageLabel: getNestedString(sourceImageMeta, "pageLabel") || undefined,
      active: true,
      featured: Boolean(body.featured),
      likeCount: 0,
      qualityScore: squareQualityScore(width, height, prompt),
      trustScore: 72,
      createdAt: now,
      updatedAt: now,
    };
    store.items.unshift(item);

    const sameImageFromOthers = squareActiveItems(store).find((candidate) => candidate.id !== item.id && candidate.imageHash === imageHash);
    if (sameImageFromOthers) {
      appendSquareModerationAudit(store, {
        requestId,
        apiKeyHash,
        itemId,
        imageId,
        event: "duplicate_content_warning",
        reasonCode: "same_image_hash_seen",
        severity: "low",
        ...clientMeta,
      });
    }

    appendSquareRecommendLog(store, {
      requestId,
      apiKeyHash,
      imageId,
      itemId,
      action,
      result: "success",
      reasonCode: action === "replaced" ? "shelf_limit_replaced_oldest" : "added_to_square",
      replacedItemId: replaced?.id,
      remainingDailyQuota: squareRemainingRecommendQuota(quota),
      remainingShelfSlots: Math.max(0, readConfigStore().quotas.squareShelfLimit - squareShelfCount(store, apiKeyHash)),
      ...clientMeta,
      promptHash,
      imageHash,
      sourceType,
    });
    writeSquareStore(store);
    sendJson(res, 200, {
      ok: true,
      status: "accepted",
      action,
      item: squareFeedItem(item, store, "latest", apiKeyHash),
      remainingDailyQuota: squareRemainingRecommendQuota(quota),
      remainingShelfSlots: Math.max(0, readConfigStore().quotas.squareShelfLimit - squareShelfCount(store, apiKeyHash)),
      replacedItemId: replaced?.id,
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, requestId, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleSquareLike(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  const requestId = randomUUID();
  const clientMeta = squareClientMeta(req);
  try {
    const body = await readJsonBody(req);
    const apiKey = getString(body, "apiKey");
    const itemId = getString(body, "itemId");
    const action = getString(body, "action") === "unlike" ? "unlike" : "like";
    if (!apiKey) {
      sendJson(res, 401, { ok: false, status: "rejected", error: "点赞需要先配置 API Key" });
      return;
    }
    const apiKeyHash = hashApiKey(apiKey);
    const store = readSquareStore();
    const quota = getSquareQuota(store, apiKeyHash);
    const item = store.items.find((candidate) => candidate.id === itemId && candidate.active !== false);
    if (!item) {
      sendJson(res, 404, { ok: false, status: "rejected", error: "广场作品不存在或已被替换" });
      return;
    }
    const existing = store.likes.find((like) => like.apiKeyHash === apiKeyHash && like.itemId === itemId);
    const log = (result: SquareLikeLog["result"], reasonCode: string) => {
      appendSquareLikeLog(store, {
        requestId,
        apiKeyHash,
        itemId,
        action,
        result,
        reasonCode,
        likeCount: item.likeCount || 0,
        remainingLikeQuota: squareRemainingLikeQuota(quota),
        ...clientMeta,
      });
    };

    if (action === "like") {
      if (existing?.liked) {
        log("noop", "already_liked");
        writeSquareStore(store);
        sendJson(res, 200, {
          ok: true,
          status: "liked",
          action: "noop",
          likeCount: item.likeCount || 0,
          remainingLikeQuota: squareRemainingLikeQuota(quota),
        });
        return;
      }
      if (quota.dailyLikeUsed >= readConfigStore().quotas.squareDailyLike) {
        log("rejected", "daily_like_quota_exceeded");
        writeSquareStore(store);
        sendJson(res, 429, {
          ok: false,
          status: "rejected",
          action: "rejected",
          reasonCode: "daily_like_quota_exceeded",
          error: "今日点赞额度已满",
          likeCount: item.likeCount || 0,
          remainingLikeQuota: 0,
        });
        return;
      }
      quota.dailyLikeUsed += 1;
      quota.updatedAt = Date.now();
      if (existing) {
        existing.liked = true;
        existing.updatedAt = Date.now();
      } else {
        store.likes.unshift({
          apiKeyHash,
          itemId,
          liked: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      item.likeCount = Math.max(0, (item.likeCount || 0) + 1);
      item.updatedAt = Date.now();
      log("success", "liked");
      writeSquareStore(store);
      sendJson(res, 200, {
        ok: true,
        status: "liked",
        action: "liked",
        likeCount: item.likeCount,
        remainingLikeQuota: squareRemainingLikeQuota(quota),
      });
      return;
    }

    let didUnlike = false;
    if (existing?.liked) {
      existing.liked = false;
      existing.updatedAt = Date.now();
      item.likeCount = Math.max(0, (item.likeCount || 0) - 1);
      item.updatedAt = Date.now();
      log("success", "unliked");
      didUnlike = true;
    } else {
      if (!existing) {
        store.likes.unshift({
          apiKeyHash,
          itemId,
          liked: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      log("noop", "already_unliked");
    }
    writeSquareStore(store);
    sendJson(res, 200, {
      ok: true,
      status: "unliked",
      action: didUnlike ? "unliked" : "noop",
      likeCount: item.likeCount || 0,
      remainingLikeQuota: squareRemainingLikeQuota(quota),
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, requestId, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleSquareAdminOverview(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  const auth = getSquareAdminAuth(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error, mustChangePassword: auth.mustChangePassword });
    return;
  }
  const store = readSquareStore();
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const trend = Array.from({ length: 14 }, (_, index) => {
    const dateKey = squareDayKey(now - (13 - index) * oneDay);
    const recommendLogs = store.recommendLogs.filter((log) => squareDayKey(log.timestamp) === dateKey);
    const likeLogs = store.likeLogs.filter((log) => squareDayKey(log.timestamp) === dateKey);
    return {
      dateKey,
      recommendAttempts: recommendLogs.length,
      added: recommendLogs.filter((log) => log.action === "added").length,
      replaced: recommendLogs.filter((log) => log.action === "replaced").length,
      rejected: recommendLogs.filter((log) => log.result === "rejected").length,
      likes: likeLogs.filter((log) => log.result === "success" && log.action === "like").length,
      unlikes: likeLogs.filter((log) => log.result === "success" && log.action === "unlike").length,
    };
  });
  const rejectedReasons = store.recommendLogs
    .filter((log) => log.result === "rejected")
    .reduce<Record<string, number>>((acc, log) => {
      acc[log.reasonCode || "unknown"] = (acc[log.reasonCode || "unknown"] || 0) + 1;
      return acc;
    }, {});
  const activeItems = squareActiveItems(store);
  const totalPublished = store.recommendLogs.filter((log) => log.action === "added" || log.action === "replaced").length;
  const totalReplaced = store.recommendLogs.filter((log) => log.action === "replaced").length;
  sendJson(res, 200, {
    ok: true,
    overview: {
      activeItems: activeItems.length,
      totalItems: store.items.length,
      totalRecommendAttempts: store.recommendLogs.length,
      totalLikes: store.likeLogs.filter((log) => log.result === "success" && log.action === "like").length,
      replacementRate: totalPublished ? Math.round((totalReplaced / totalPublished) * 1000) / 10 : 0,
      likeRate: activeItems.length ? Math.round((activeItems.reduce((sum, item) => sum + (item.likeCount || 0), 0) / activeItems.length) * 10) / 10 : 0,
      trend,
      rejectedReasonTop: Object.entries(rejectedReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([reasonCode, count]) => ({ reasonCode, count })),
      riskEvents: store.moderationAudits.slice(0, 80),
    },
  });
}

async function handleSquareAdminExport(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  const auth = getSquareAdminAuth(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error, mustChangePassword: auth.mustChangePassword });
    return;
  }
  const url = new URL(req.url || "/", "http://localhost");
  const format = url.searchParams.get("format") || "json";
  const dateKey = url.searchParams.get("dateKey") || squareDayKey();
  const store = readSquareStore();
  const exportedAt = new Date().toISOString();
  const recommendLogs = store.recommendLogs.filter((log) => squareDayKey(log.timestamp) === dateKey);
  const likeLogs = store.likeLogs.filter((log) => squareDayKey(log.timestamp) === dateKey);
  const moderationAudits = store.moderationAudits.filter((audit) => squareDayKey(audit.timestamp) === dateKey);
  const relatedItemIds = new Set<string>();
  recommendLogs.forEach((log) => {
    if (log.itemId) relatedItemIds.add(log.itemId);
    if (log.replacedItemId) relatedItemIds.add(log.replacedItemId);
  });
  likeLogs.forEach((log) => relatedItemIds.add(log.itemId));
  moderationAudits.forEach((audit) => {
    if (audit.itemId) relatedItemIds.add(audit.itemId);
  });
  const items = store.items.filter((item) => squareDayKey(item.createdAt) === dateKey || relatedItemIds.has(item.id));
  if (format === "csv") {
    const rows = [
      ["type", "timestamp", "requestId", "apiKeyHash", "itemId", "imageId", "action", "result", "reasonCode", "replacedItemId", "remainingDailyQuota", "remainingShelfSlots", "likeCount", "remainingLikeQuota", "ipHash", "uaHash"],
      ...recommendLogs.map((log) => [
        "recommend",
        new Date(log.timestamp).toISOString(),
        log.requestId,
        log.apiKeyHash,
        log.itemId || "",
        log.imageId || "",
        log.action,
        log.result,
        log.reasonCode,
        log.replacedItemId || "",
        String(log.remainingDailyQuota),
        String(log.remainingShelfSlots),
        "",
        "",
        log.ipHash,
        log.uaHash,
      ]),
      ...likeLogs.map((log) => [
        "like",
        new Date(log.timestamp).toISOString(),
        log.requestId,
        log.apiKeyHash,
        log.itemId,
        "",
        log.action,
        log.result,
        log.reasonCode,
        "",
        "",
        "",
        String(log.likeCount),
        String(log.remainingLikeQuota),
        log.ipHash,
        log.uaHash,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`).join(","))
      .join("\n");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="imagehub-square-audit-${dateKey}-${exportedAt.replace(/[:.]/g, "-")}.csv"`);
    res.end(csv);
    appendAuditLog(auth.user.username, "admin_export_square_logs", `dateKey=${dateKey} format=csv count=${recommendLogs.length + likeLogs.length}`);
    return;
  }
  const payload = {
    exportedAt,
    exportedBy: auth.user.username,
    schemaVersion: 1,
    dateKey,
    items: items.map(squareItemForExport),
    recommendLogs,
    likeLogs,
    quotas: store.quotas.filter((quota) => quota.dateKey === dateKey),
    moderationAudits,
    counts: {
      items: items.length,
      activeItems: items.filter((item) => item.active !== false).length,
      recommendLogs: recommendLogs.length,
      likeLogs: likeLogs.length,
      quotas: store.quotas.filter((quota) => quota.dateKey === dateKey).length,
      moderationAudits: moderationAudits.length,
    },
  };
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="imagehub-square-audit-${dateKey}-${exportedAt.replace(/[:.]/g, "-")}.json"`);
  res.end(JSON.stringify(payload, null, 2));
  appendAuditLog(auth.user.username, "admin_export_square_logs", `dateKey=${dateKey} format=json count=${recommendLogs.length + likeLogs.length}`);
}

// ── API 路由注册：开发（Vite 中间件）与生产（server/index.ts 独立服务）共用同一份实现 ──
export type ApiApp = {
  use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) => void;
};

export function registerApiRoutes(app: ApiApp) {
      ensureAdminStore();
      ensureSquareStore();
      setInterval(cleanupOAuthExpired, 1000 * 60 * 10);
      app.use("/api/config", (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        const store = readConfigStore();
        sendJson(res, 200, {
          ok: true,
          version: store.version,
          updatedAt: store.updatedAt,
          upstreams: store.upstreams
            .filter((item) => item.enabled)
            .sort((a, b) => a.sort - b.sort)
            .map((item) => ({ id: item.id, name: item.name, baseUrl: item.baseUrl, note: item.note || "" })),
          models: store.models
            .filter((item) => item.enabled)
            .sort((a, b) => a.sort - b.sort)
            .map((item) => ({ id: item.id, displayName: item.displayName, sizing: item.sizing, tags: item.tags || [] })),
          presets: store.presets,
        });
      });

      // 近 7 日各模型的真实表现（成功率 / P50 / 好差评），用于前端模型选择时展示
      app.use("/api/model-stats", (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        try {
          const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const rows = getDb().prepare(
            "SELECT model, status, duration_ms FROM request_logs WHERE request_type = 'image_generation' AND created_at >= ?",
          ).all(since) as Array<{ model: string; status: string; duration_ms: number | null }>;
          const feedbackRows = getDb().prepare(
            "SELECT model, rating, COUNT(*) AS n FROM image_feedback GROUP BY model, rating",
          ).all() as Array<{ model: string; rating: number; n: number }>;
          const byModel = new Map<string, { success: number; error: number; durations: number[]; up: number; down: number }>();
          const bucketFor = (model: string) => {
            let bucket = byModel.get(model);
            if (!bucket) {
              bucket = { success: 0, error: 0, durations: [], up: 0, down: 0 };
              byModel.set(model, bucket);
            }
            return bucket;
          };
          for (const row of rows) {
            if (row.status !== "success" && row.status !== "error") continue;
            const bucket = bucketFor(row.model || "");
            if (row.status === "success") {
              bucket.success += 1;
              if (typeof row.duration_ms === "number") bucket.durations.push(row.duration_ms);
            } else {
              bucket.error += 1;
            }
          }
          for (const row of feedbackRows) {
            const bucket = bucketFor(row.model || "");
            if (row.rating === 1) bucket.up += row.n;
            if (row.rating === -1) bucket.down += row.n;
          }
          const models = [...byModel.entries()].map(([id, bucket]) => {
            const samples = bucket.success + bucket.error;
            const sorted = bucket.durations.sort((a, b) => a - b);
            const p50 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * 0.5))] : 0;
            return {
              id,
              samples,
              successRate: samples ? Math.round((bucket.success / samples) * 1000) / 10 : 0,
              p50DurationMs: p50,
              up: bucket.up,
              down: bucket.down,
            };
          });
          sendJson(res, 200, { ok: true, windowDays: 7, models });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      // 生成结果反馈：rating 1 好评 / -1 差评 / 0 清除
      app.use("/api/feedback", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const requestId = getString(body, "requestId");
          const rating = Number(body.rating);
          if (!requestId || ![1, -1, 0].includes(rating)) {
            sendJson(res, 400, { ok: false, error: "参数不合法" });
            return;
          }
          const log = readRequestLogRecord(requestId);
          if (!log) {
            sendJson(res, 404, { ok: false, error: "请求记录不存在" });
            return;
          }
          if (rating === 0) {
            getDb().prepare("DELETE FROM image_feedback WHERE request_id = ?").run(requestId);
          } else {
            getDb().prepare(`
              INSERT INTO image_feedback (request_id, client_id, model, rating, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(request_id) DO UPDATE SET rating = excluded.rating, created_at = excluded.created_at
            `).run(requestId, log.clientId, log.model || "", rating, Date.now());
          }
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      app.use("/api/reference-images", (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        cleanupExpiredTemporaryReferences();
        const id = decodeURIComponent((req.url || "/").split("?")[0]?.replace(/^\/+/, "") || "");
        const record = id ? temporaryReferences.get(id) : undefined;
        if (!record || record.expiresAt <= Date.now()) {
          sendJson(res, 404, { ok: false, error: "参考图已过期或不存在" });
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", record.mime);
        res.setHeader("Content-Length", String(record.bytes.length));
        res.setHeader("Cache-Control", "no-store, max-age=0");
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(record.name)}"`);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(record.bytes);
      });

      app.use("/api/images/local/", (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        const id = decodeURIComponent((req.url || "/").split("?")[0]?.replace(/^\/+/, "") || "");
        if (!LOCAL_IMAGE_PATH_PATTERN.test(id) || id.includes("..")) {
          sendJson(res, 404, { ok: false, error: "图片不存在" });
          return;
        }
        const filePath = join(LOCAL_IMAGE_DIR, id);
        if (!filePath.startsWith(LOCAL_IMAGE_DIR) || !existsSync(filePath)) {
          sendJson(res, 404, { ok: false, error: "图片不存在或已被清理" });
          return;
        }
        const ext = id.slice(id.lastIndexOf(".") + 1);
        const bytes = readFileSync(filePath);
        res.statusCode = 200;
        res.setHeader("Content-Type", IMAGE_EXT_MIME[ext] || "application/octet-stream");
        res.setHeader("Content-Length", String(bytes.length));
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        if (req.method === "HEAD") { res.end(); return; }
        res.end(bytes);
      });

      app.use("/api/square/image/", (req, res) => {
        const itemId = decodeURIComponent((req.url || "/").split("?")[0]?.replace(/^\/+/, "") || "");
        if (!itemId) { sendJson(res, 400, { ok: false, error: "missing item id" }); return; }
        const store = readSquareStore();
        const item = store.items.find((candidate) => candidate.id === itemId);
        if (!item || !item.thumbnailDataUrl) { sendJson(res, 404, { ok: false, error: "not found" }); return; }
        const match = item.thumbnailDataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.*)$/);
        if (!match) { sendJson(res, 500, { ok: false, error: "invalid data" }); return; }
        const bytes = Buffer.from(match[2], "base64");
        res.statusCode = 200;
        res.setHeader("Content-Type", match[1]);
        res.setHeader("Content-Length", String(bytes.length));
        res.setHeader("Cache-Control", "public, max-age=86400, immutable");
        if (req.method === "HEAD") { res.end(); return; }
        res.end(bytes);
      });

      app.use("/api/square/feed", (req, res) => {
        void handleSquareFeed(req, res);
      });

      app.use("/api/square/quota", (req, res) => {
        void handleSquareQuota(req, res);
      });

      app.use("/api/square/recommend", (req, res) => {
        void handleSquareRecommend(req, res);
      });

      app.use("/api/square/like", (req, res) => {
        void handleSquareLike(req, res);
      });

      app.use("/api/square/admin/overview", (req, res) => {
        void handleSquareAdminOverview(req, res);
      });

      app.use("/api/square/admin/export", (req, res) => {
        void handleSquareAdminExport(req, res);
      });

      app.use("/api/auth/oauth", async (req, res) => {
        const path = (req.url || "/").split("?")[0] || "/";
        const query = new URLSearchParams((req.url || "").split("?")[1] || "");

        try {
          if (path === "/config" && req.method === "GET") {
            sendJson(res, 200, {
              enabled: OAUTH_ENABLED,
              providerName: OAUTH_ENABLED ? "太极AI" : undefined,
              providerUrl: OAUTH_ENABLED ? OAUTH_PROVIDER_URL : undefined,
            });
            return;
          }

          if (!OAUTH_ENABLED) {
            sendJson(res, 404, { ok: false, error: "OAuth is not configured" });
            return;
          }

          if (path === "/login" && req.method === "GET") {
            const state = randomBytes(24).toString("hex");
            oauthPendingStates.set(state, { expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
            const redirectUri = OAUTH_REDIRECT_URI || `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}/api/auth/oauth/callback`;
            const params = new URLSearchParams({
              response_type: "code",
              client_id: OAUTH_CLIENT_ID,
              redirect_uri: redirectUri,
              scope: "openid profile email",
              state,
            });
            res.statusCode = 302;
            res.setHeader("Location", `${OAUTH_PROVIDER_URL}/oauth2/authorize?${params.toString()}`);
            res.end();
            return;
          }

          if (path === "/callback" && req.method === "GET") {
            const code = query.get("code") || "";
            const state = query.get("state") || "";
            const oauthError = query.get("error") || "";
            const baseRedirect = OAUTH_REDIRECT_URI ? new URL(OAUTH_REDIRECT_URI).origin : `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;

            if (oauthError || !code) {
              res.statusCode = 302;
              res.setHeader("Location", `${baseRedirect}/#oauth-error`);
              res.end();
              return;
            }

            const pending = oauthPendingStates.get(state);
            if (!pending || pending.expiresAt < Date.now()) {
              oauthPendingStates.delete(state);
              res.statusCode = 302;
              res.setHeader("Location", `${baseRedirect}/#oauth-error`);
              res.end();
              return;
            }
            oauthPendingStates.delete(state);

            const redirectUri = OAUTH_REDIRECT_URI || `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}/api/auth/oauth/callback`;

            const tokenRes = await fetchWithTimeout(`${OAUTH_PROVIDER_URL}/oauth2/token`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                client_id: OAUTH_CLIENT_ID,
                client_secret: OAUTH_CLIENT_SECRET,
              }).toString(),
            }, 30_000);

            const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
            if (!tokenData.access_token) {
              res.statusCode = 302;
              res.setHeader("Location", `${baseRedirect}/#oauth-error`);
              res.end();
              return;
            }

            const [userInfoRes, apikeyRes] = await Promise.all([
              fetchWithTimeout(`${OAUTH_PROVIDER_URL}/oauth2/userinfo`, {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
              }, 15_000),
              fetchWithTimeout(`${OAUTH_PROVIDER_URL}/oauth2/apikey`, {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
              }, 15_000).catch(() => null),
            ]);

            const userInfo = await userInfoRes.json() as {
              sub?: string; username?: string; display_name?: string;
              email?: string; role?: number; group?: string; error?: string;
            };
            if (userInfo.error || !userInfo.sub) {
              res.statusCode = 302;
              res.setHeader("Location", `${baseRedirect}/#oauth-error`);
              res.end();
              return;
            }

            let apiKey = "";
            if (apikeyRes) {
              try {
                const apikeyData = await apikeyRes.json() as Record<string, unknown>;
                console.log("[OAuth] /oauth2/apikey response:", JSON.stringify(apikeyData));
                apiKey = String(apikeyData.api_key || apikeyData.apiKey || apikeyData.key || "");
              } catch { /* ignore */ }
            }

            const sessionToken = createOAuthSession({
              sub: String(userInfo.sub),
              username: userInfo.username || "",
              displayName: userInfo.display_name || userInfo.username || "",
              email: userInfo.email || "",
              role: userInfo.role ?? 1,
              group: userInfo.group || "default",
              apiKey,
            });
            setOAuthCookie(res, sessionToken);
            res.statusCode = 302;
            res.setHeader("Location", `${baseRedirect}/#oauth-success`);
            res.end();
            return;
          }

          if (path === "/me" && req.method === "GET") {
            const session = getOAuthSession(req);
            if (!session) {
              sendJson(res, 200, { loggedIn: false });
              return;
            }
            sendJson(res, 200, {
              loggedIn: true,
              sub: session.sub,
              username: session.username,
              displayName: session.displayName,
              email: session.email,
              role: session.role,
              group: session.group,
              apiKey: session.apiKey || undefined,
            });
            return;
          }

          if (path === "/logout" && req.method === "POST") {
            const session = getOAuthSession(req);
            if (session) oauthSessions.delete(session.token);
            clearOAuthCookie(res);
            sendJson(res, 200, { ok: true });
            return;
          }

          sendJson(res, 404, { ok: false, error: "Not found" });
        } catch (err) {
          console.error("[OAuth]", err);
          sendJson(res, 500, { ok: false, error: "OAuth internal error" });
        }
      });

      app.use("/api/admin", async (req, res) => {
        const path = (req.url || "/").split("?")[0] || "/";
        const session = getAdminSession(req);
        const oauthSession = !session ? getOAuthSession(req) : null;
        const isOauthAdmin = oauthSession != null && oauthSession.role >= 10;
        const store = readAdminStore();

        try {
          if (path === "/login" && req.method === "POST") {
            const body = await readJsonBody(req);
            const username = getString(body, "username");
            const password = getString(body, "password");
            const user = store.admins.find((admin) => admin.username === username);
            if (!user || !verifyPassword(password, user)) {
              sendJson(res, 401, { ok: false, error: "账号或密码错误" });
              return;
            }
            const token = createSession(user.username);
            setSessionCookie(res, token);
            appendAuditLog(user.username, "admin_login");
            sendJson(res, 200, {
              ok: true,
              user: {
                username: user.username,
                mustChangePassword: user.mustChangePassword,
              },
            });
            return;
          }

          if (path === "/logout" && req.method === "POST") {
            if (session) adminSessions.delete(session.token);
            clearSessionCookie(res);
            sendJson(res, 200, { ok: true });
            return;
          }

          if (!session && !isOauthAdmin) {
            sendJson(res, 401, { ok: false, error: "未登录" });
            return;
          }

          const user = session
            ? store.admins.find((admin) => admin.username === session.username)
            : null;
          if (session && !user) {
            sendJson(res, 401, { ok: false, error: "管理员不存在" });
            return;
          }

          if (path === "/me" && req.method === "GET") {
            if (isOauthAdmin && !user) {
              sendJson(res, 200, {
                ok: true,
                user: {
                  username: oauthSession!.displayName || oauthSession!.username,
                  mustChangePassword: false,
                  oauthUser: true,
                },
              });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              user: {
                username: user!.username,
                mustChangePassword: user!.mustChangePassword,
              },
            });
            return;
          }

          if (path === "/change-password" && req.method === "POST") {
            if (!user) {
              sendJson(res, 400, { ok: false, error: "OAuth 用户无需修改密码" });
              return;
            }
            const body = await readJsonBody(req);
            const oldPassword = getString(body, "oldPassword");
            const newPassword = getString(body, "newPassword");
            if (!verifyPassword(oldPassword, user)) {
              sendJson(res, 400, { ok: false, error: "旧密码不正确" });
              return;
            }
            if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
              sendJson(res, 400, { ok: false, error: "新密码至少 8 位，并包含字母和数字" });
              return;
            }
            const { salt, passwordHash } = hashPassword(newPassword);
            const nextStore = readAdminStore();
            nextStore.admins = nextStore.admins.map((admin) =>
              admin.username === user.username
                ? { ...admin, salt, passwordHash, mustChangePassword: false, updatedAt: Date.now() }
                : admin,
            );
            writeAdminStore(nextStore);
            appendAuditLog(user.username, "admin_password_changed");
            sendJson(res, 200, { ok: true });
            return;
          }

          if (user?.mustChangePassword) {
            sendJson(res, 403, { ok: false, error: "首次登录必须修改密码", mustChangePassword: true });
            return;
          }

          if (path === "/stats" && req.method === "GET") {
            const rows = getDb().prepare(
              "SELECT status, model, error_key, created_at, duration_ms, image_count, request_type, ref_count, ref_status, upstream_responded, image_saved FROM request_logs",
            ).all() as Array<{
              status: string; model: string; error_key: string | null; created_at: number; duration_ms: number | null;
              image_count: number; request_type: string; ref_count: number; ref_status: string | null;
              upstream_responded: number; image_saved: number;
            }>;
            // 统一指标口径：头部指标 / 模型分布 / 常见失败均只统计生图请求；分析类请求单独计数
            const imageRows = rows.filter((r) => r.request_type === "image_generation");
            const analysisCount = rows.length - imageRows.length;
            const success = imageRows.filter((r) => r.status === "success").length;
            const error = imageRows.filter((r) => r.status === "error").length;
            const durations = imageRows.filter((r) => typeof r.duration_ms === "number").map((r) => r.duration_ms || 0);
            const avgDurationMs = durations.length
              ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length)
              : 0;
            // 成功请求的耗时分位数（P50 反映正常体验，P95 反映长尾）
            const successDurations = imageRows
              .filter((r) => r.status === "success" && typeof r.duration_ms === "number")
              .map((r) => r.duration_ms || 0)
              .sort((a, b) => a - b);
            const percentile = (sorted: number[], p: number) =>
              sorted.length ? sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))] : 0;
            const p50DurationMs = percentile(successDurations, 0.5);
            const p95DurationMs = percentile(successDurations, 0.95);
            const modelCounts = imageRows.reduce<Record<string, number>>((acc, r) => {
              acc[r.model] = (acc[r.model] || 0) + 1;
              return acc;
            }, {});
            const errorCounts = imageRows.filter((r) => r.status === "error").reduce<Record<string, number>>((acc, r) => {
              const key = r.error_key || "未知错误";
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {});

            const totalImages = imageRows.reduce((sum, r) => sum + (r.image_count || 0), 0);

            // 每日趋势读聚合表：不受 5000 条日志裁剪影响，历史永久保留
            const dailyRows = getDb().prepare(`
              SELECT date,
                     SUM(total) AS total, SUM(success) AS success, SUM(error) AS error, SUM(images) AS images,
                     SUM(duration_sum) AS duration_sum, SUM(duration_count) AS duration_count
              FROM daily_stats GROUP BY date ORDER BY date DESC LIMIT 14
            `).all() as Array<{
              date: string; total: number; success: number; error: number; images: number;
              duration_sum: number; duration_count: number;
            }>;
            const daily = dailyRows.map((bucket) => ({
              date: bucket.date,
              total: bucket.total,
              success: bucket.success,
              error: bucket.error,
              images: bucket.images,
              successRate: bucket.total ? Math.round((bucket.success / bucket.total) * 1000) / 10 : 0,
              avgDurationMs: bucket.duration_count ? Math.round(bucket.duration_sum / bucket.duration_count) : 0,
            }));

            // 生成结果反馈计数
            const feedbackRows = getDb().prepare(
              "SELECT rating, COUNT(*) AS n FROM image_feedback GROUP BY rating",
            ).all() as Array<{ rating: number; n: number }>;
            const feedback = {
              up: feedbackRows.find((r) => r.rating === 1)?.n || 0,
              down: feedbackRows.find((r) => r.rating === -1)?.n || 0,
            };

            // 流水线各环节到达/成功统计（仅生图请求）
            const withRefs = imageRows.filter((r) => (r.ref_count || 0) > 0);
            const stageStats = {
              received: imageRows.length,
              referenceForwarded: withRefs.filter((r) => r.ref_status === "succeeded").length,
              referenceTotal: withRefs.length,
              upstreamResponded: imageRows.filter((r) => r.upstream_responded === 1).length,
              upstreamSuccess: success,
              imageSaved: imageRows.filter((r) => r.image_saved === 1).length,
            };

            sendJson(res, 200, {
              ok: true,
              stats: {
                total: imageRows.length,
                success,
                error,
                running: imageRows.filter((r) => r.status === "running").length,
                successRate: imageRows.length ? Math.round((success / imageRows.length) * 1000) / 10 : 0,
                avgDurationMs,
                p50DurationMs,
                p95DurationMs,
                analysisCount,
                totalImages,
                feedback,
                modelCounts,
                errorCounts,
                daily,
                stageStats,
              },
            });
            return;
          }

          if (path === "/requests" && req.method === "GET") {
            const url = new URL(req.url || "/", "http://localhost");
            const query = (url.searchParams.get("q") || "").toLowerCase().trim();
            const status = url.searchParams.get("status") || "";
            const model = url.searchParams.get("model") || "";
            const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0);
            const limit = Math.min(1000, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50));
            const where: string[] = [];
            const params: unknown[] = [];
            if (status) { where.push("status = ?"); params.push(status); }
            if (model) { where.push("model = ?"); params.push(model); }
            if (query) { where.push("search LIKE ?"); params.push(`%${query}%`); }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
            const total = (getDb().prepare(`SELECT COUNT(*) AS n FROM request_logs ${whereSql}`).get(...params) as { n: number }).n;
            const rows = getDb().prepare(
              `SELECT data FROM request_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            ).all(...params, limit, offset) as Array<{ data: string }>;
            const logs = rows.map((row) => { try { return JSON.parse(row.data); } catch { return null; } }).filter(Boolean);
            sendJson(res, 200, { ok: true, logs, total, offset, limit });
            return;
          }

          if (path.startsWith("/requests/") && req.method === "GET") {
            const requestId = decodeURIComponent(path.replace("/requests/", ""));
            const log = readRequestLogRecord(requestId);
            if (!log) {
              sendJson(res, 404, { ok: false, error: "日志不存在" });
              return;
            }
            sendJson(res, 200, { ok: true, log });
            return;
          }

          if (path === "/logs/export" && req.method === "GET") {
            const exportedAt = new Date().toISOString();
            const filename = `image-studio-logs-${exportedAt.replace(/[:.]/g, "-")}.json`;
            const requestLogs = (getDb().prepare("SELECT data FROM request_logs ORDER BY created_at DESC").all() as Array<{ data: string }>)
              .map((row) => { try { return JSON.parse(row.data); } catch { return null; } })
              .filter(Boolean);
            const payload = {
              exportedAt,
              exportedBy: user?.username || oauthSession?.username || "unknown",
              schemaVersion: 2,
              admins: store.admins.map((admin) => ({
                username: admin.username,
                createdAt: admin.createdAt,
                updatedAt: admin.updatedAt,
                mustChangePassword: admin.mustChangePassword,
              })),
              auditLogs: store.auditLogs,
              requestLogs,
              counts: {
                requestLogs: requestLogs.length,
                auditLogs: store.auditLogs.length,
                admins: store.admins.length,
              },
            };
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.end(JSON.stringify(payload, null, 2));
            appendAuditLog(user?.username || oauthSession?.username || "oauth_admin", "admin_export_logs", `count=${requestLogs.length}`);
            return;
          }

          const adminName = user?.username || oauthSession?.username || "oauth_admin";

          if (path === "/config" && req.method === "GET") {
            sendJson(res, 200, { ok: true, config: readConfigStore() });
            return;
          }

          if (path === "/config/upstreams" && req.method === "PUT") {
            const body = await readJsonBody(req);
            const rawList = Array.isArray(body.upstreams) ? body.upstreams : [];
            const upstreams: ConfigUpstream[] = rawList.map((raw, index) => {
              const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
              const name = String(item.name || "").trim();
              if (!name) throw new Error(`第 ${index + 1} 个站点名称不能为空`);
              if (name.length > 50) throw new Error(`站点名称过长（${name}）`);
              const baseUrl = validateUpstreamBaseUrl(String(item.baseUrl || ""));
              return {
                id: typeof item.id === "string" && item.id ? item.id : `site-${randomUUID().slice(0, 8)}`,
                name,
                baseUrl,
                enabled: item.enabled !== false,
                note: typeof item.note === "string" ? item.note.slice(0, 200) : "",
                sort: typeof item.sort === "number" ? item.sort : index + 1,
              };
            });
            if (upstreams.filter((item) => item.enabled).length === 0) {
              throw new Error("至少需要保留一个启用的站点");
            }
            const configStore = readConfigStore();
            configStore.upstreams = upstreams;
            writeConfigStore(configStore);
            appendAuditLog(adminName, "config_update_upstreams", `count=${upstreams.length}`);
            sendJson(res, 200, { ok: true, config: readConfigStore() });
            return;
          }

          if (path === "/config/models" && req.method === "PUT") {
            const body = await readJsonBody(req);
            const rawList = Array.isArray(body.models) ? body.models : [];
            const seen = new Set<string>();
            const models: ConfigModel[] = rawList.map((raw, index) => {
              const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
              const id = String(item.id || "").trim();
              if (!id) throw new Error(`第 ${index + 1} 个模型 ID 不能为空`);
              if (seen.has(id.toLowerCase())) throw new Error(`模型 ID 重复：${id}`);
              seen.add(id.toLowerCase());
              const sizing = item.sizing === "official-1k" ? "official-1k" : "explicit-2k4k";
              return {
                id,
                displayName: String(item.displayName || id).trim().slice(0, 80),
                sizing,
                enabled: item.enabled !== false,
                sort: typeof item.sort === "number" ? item.sort : index + 1,
                tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t)).slice(0, 6) : [],
              };
            });
            if (models.filter((item) => item.enabled).length === 0) {
              throw new Error("至少需要保留一个启用的模型");
            }
            const configStore = readConfigStore();
            configStore.models = models;
            writeConfigStore(configStore);
            appendAuditLog(adminName, "config_update_models", `count=${models.length}`);
            sendJson(res, 200, { ok: true, config: readConfigStore() });
            return;
          }

          if (path === "/config/presets" && req.method === "PUT") {
            const body = await readJsonBody(req);
            const presetsBody = body.presets && typeof body.presets === "object" ? body.presets as Record<string, unknown> : {};
            const configStore = readConfigStore();
            configStore.presets = {
              promptStarters: Array.isArray(presetsBody.promptStarters) ? presetsBody.promptStarters : null,
              stylePresets: Array.isArray(presetsBody.stylePresets) ? presetsBody.stylePresets : null,
              industryAgents: Array.isArray(presetsBody.industryAgents) ? presetsBody.industryAgents : null,
              negativePrompt: typeof presetsBody.negativePrompt === "string" ? presetsBody.negativePrompt : null,
            };
            writeConfigStore(configStore);
            appendAuditLog(adminName, "config_update_presets", "presets updated");
            sendJson(res, 200, { ok: true, config: readConfigStore() });
            return;
          }

          if (path === "/config/system-prompts" && req.method === "PUT") {
            const body = await readJsonBody(req);
            const sp = body.systemPrompts && typeof body.systemPrompts === "object" ? body.systemPrompts as Record<string, unknown> : {};
            const configStore = readConfigStore();
            configStore.systemPrompts = {
              agentAnalyze: typeof sp.agentAnalyze === "string" && sp.agentAnalyze.trim() ? sp.agentAnalyze : DEFAULT_AGENT_ANALYZE_SYSTEM_PROMPT,
              promptAnalyze: typeof sp.promptAnalyze === "string" && sp.promptAnalyze.trim() ? sp.promptAnalyze : DEFAULT_PROMPT_ANALYZE_SYSTEM_PROMPT,
            };
            writeConfigStore(configStore);
            appendAuditLog(adminName, "config_update_system_prompts", "system prompts updated");
            sendJson(res, 200, { ok: true, config: readConfigStore() });
            return;
          }

          if (path === "/config/quotas" && req.method === "PUT") {
            const body = await readJsonBody(req);
            const q = body.quotas && typeof body.quotas === "object" ? body.quotas as Record<string, unknown> : {};
            const clamp = (value: unknown, min: number, max: number, fallback: number) => {
              const num = Math.round(Number(value));
              return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback;
            };
            const configStore = readConfigStore();
            configStore.quotas = {
              squareShelfLimit: clamp(q.squareShelfLimit, 1, 50, configStore.quotas.squareShelfLimit),
              squareDailyRecommend: clamp(q.squareDailyRecommend, 0, 1000, configStore.quotas.squareDailyRecommend),
              squareDailyLike: clamp(q.squareDailyLike, 0, 1000, configStore.quotas.squareDailyLike),
              squareMaxFeed: clamp(q.squareMaxFeed, 1, 100, configStore.quotas.squareMaxFeed),
              generationDailyLimit: clamp(q.generationDailyLimit, 0, 100000, configStore.quotas.generationDailyLimit ?? 0),
              userDiskLimitMB: clamp(q.userDiskLimitMB, 0, 1024 * 1024, configStore.quotas.userDiskLimitMB ?? 0),
            };
            writeConfigStore(configStore);
            appendAuditLog(adminName, "config_update_quotas", "quotas updated");
            sendJson(res, 200, { ok: true, config: readConfigStore() });
            return;
          }

          if (path === "/config/reset" && req.method === "POST") {
            const body = await readJsonBody(req);
            const section = String(body.section || "");
            const defaults = defaultConfigStore();
            const configStore = readConfigStore();
            if (section === "upstreams") configStore.upstreams = defaults.upstreams;
            else if (section === "models") configStore.models = defaults.models;
            else if (section === "presets") configStore.presets = defaults.presets;
            else if (section === "systemPrompts") configStore.systemPrompts = defaults.systemPrompts;
            else if (section === "quotas") configStore.quotas = defaults.quotas;
            else throw new Error("未知的配置分组");
            writeConfigStore(configStore);
            appendAuditLog(adminName, "config_reset", section);
            sendJson(res, 200, { ok: true, config: readConfigStore() });
            return;
          }

          sendJson(res, 404, { ok: false, error: "Not found" });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      app.use("/api/models", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const protocol = getProtocol(body.protocol);
          const baseUrl = normalizeAllowedApiBaseUrl(getString(body, "baseUrl"));
          const apiKey = getString(body, "apiKey");
          if (!apiKey) {
            sendJson(res, 400, { ok: false, detail: { status: 400, error: "API Key 不能为空" } });
            return;
          }
          const { models, raw } = await loadUpstreamModels(protocol, baseUrl, apiKey);
          sendJson(res, 200, { ok: true, models: [...new Set(models)].sort(), raw });
        } catch (error) {
          const upstreamStatus = httpStatusFromDetail(error);
          const summary = safeErrorSummary(error);
          const status = isAllowedApiBaseUrlError(error) ? 400 : upstreamStatus || 500;
          const isAuthError = status === 401 || status === 403;
          sendJson(res, status, {
            ok: false,
            detail: {
              status,
              error: isAuthError ? "API Key 错误或无权限，请检查后重试" : summary.message,
              type: summary.type,
              code: summary.code,
              raw: summary.raw,
            },
          });
        }
      });

      app.use("/api/prompt/analyze", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        const requestId = randomUUID();
        const startedAt = Date.now();
        let logCreated = false;

        // SSE 框架。一旦第一行写出去 res.statusCode 就锁死了，所以异常路径
        // 在 send/end 都用 SSE 帧（status: 200，错误塞 event: error）。
        let sseStarted = false;
        let chunkCount = 0;
        let lastChunkAt = 0;
        const sse = (event: string, data: unknown) => {
          if (!sseStarted) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders?.();
            sseStarted = true;
          }
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        try {
          const body = await readJsonBody(req);
          const baseUrl = normalizeAllowedApiBaseUrl(getString(body, "baseUrl"));
          const apiKey = getString(body, "apiKey");
          const protocol = getProtocol(body.protocol);
          const clientId = getString(body, "clientId") || "anonymous";
          const analysisModel = getString(body, "analysisModel");
          const prompt = getString(body, "prompt");

          createRequestLog({
            requestId,
            requestType: "prompt_analysis",
            clientId: truncateText(clientId, 120),
            clientUserAgent: truncateText(req.headers["user-agent"] || "", 500),
            clientIpHash: hashClientIp(req),
            protocol,
            apiBaseUrl: baseUrl.replace(/\/+$/, ""),
            ...apiKeyLogMeta(apiKey),
            endpoint: "/v1/chat/completions",
            model: truncateText(analysisModel || "", 240),
            prompt: truncateText(prompt || "", 4000),
            negativePrompt: getString(body, "negativePrompt") ? truncateText(getString(body, "negativePrompt"), 2400) : undefined,
            aspectRatio: getString(body, "aspectRatio") || undefined,
            size: getString(body, "size") || undefined,
            resolution: getString(body, "resolution") || undefined,
            quality: getString(body, "quality") || undefined,
            outputFormat: getString(body, "outputFormat") || undefined,
            agentId: getString(body, "agentId") || undefined,
            agentName: getString(body, "agentName") ? truncateText(getString(body, "agentName"), 120) : undefined,
            agentScenario: getString(body, "agentScenario") ? truncateText(getString(body, "agentScenario"), 240) : undefined,
            promptVariant: getString(body, "promptVariant") || undefined,
            referenceCount: getNumber(body.referenceCount) || 0,
            requestParams: sanitizeForLog({
              ...body,
              baseUrl,
              apiKey: undefined,
              credential: apiKeyLogMeta(apiKey),
            }),
            status: "running",
            createdAt: startedAt,
            startedAt,
            imageSaved: false,
          });
          logCreated = true;

          sse("started", { requestId, model: analysisModel, startedAt });

          const analysis = await analyzePromptWithGpt(baseUrl, apiKey, body, requestId, {
            onUpstreamConnected: (status) => {
              sse("upstream_connected", { status, elapsedMs: Date.now() - startedAt });
            },
            onFirstByte: () => {
              sse("receiving", { elapsedMs: Date.now() - startedAt });
              if (logCreated) {
                updateRequestLog(requestId, {
                  upstreamRequest: undefined as never,  // 留空，避免覆盖之前 sanitizeForLog 写入的内容
                });
              }
            },
            onChunk: (delta, accumulated) => {
              chunkCount += 1;
              lastChunkAt = Date.now();
              sse("chunk", {
                delta,
                totalLength: accumulated.length,
                preview: truncateText(accumulated, 420),
              });
            },
          });

          const finishedAt = Date.now();
          updateRequestLog(requestId, {
            status: "success",
            httpStatus: 200,
            finishedAt,
            durationMs: finishedAt - startedAt,
          });
          sse("done", { requestId, analysis, durationMs: finishedAt - startedAt, chunkCount });
          res.end();
        } catch (error) {
          const detail = error && typeof error === "object" && "error" in error
            ? error
            : { error: error instanceof Error ? error.message : String(error) };
          const status = isAllowedApiBaseUrlError(error) ? 400 : httpStatusFromDetail(detail) || httpStatusFromDetail(error) || 500;
          if (logCreated) {
            const summary = safeErrorSummary(detail);
            const finishedAt = Date.now();
            updateRequestLog(requestId, {
              status: "error",
              httpStatus: status,
              errorMessage: summary.message,
              errorType: summary.type || "prompt_analysis_error",
              errorCode: summary.code,
              errorRaw: summary.raw,
              responseBody: sanitizeForLog({
                ok: false,
                status,
                detail,
                chunkCount,
                lastChunkAt: lastChunkAt ? lastChunkAt - startedAt : null,
              }),
              finishedAt,
              durationMs: finishedAt - startedAt,
            });
          }
          if (sseStarted) {
            sse("error", { requestId, status, detail, chunkCount });
            res.end();
          } else {
            sendJson(res, status, { ok: false, requestId, detail });
          }
        }
      });

      app.use("/api/agent/analyze", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        const requestId = randomUUID();
        const startedAt = Date.now();
        let logCreated = false;
        let sseStarted = false;
        let chunkCount = 0;
        let lastChunkAt = 0;
        const sse = (event: string, data: unknown) => {
          if (!sseStarted) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders?.();
            sseStarted = true;
          }
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        try {
          const body = await readJsonBody(req);
          const baseUrl = normalizeAllowedApiBaseUrl(getString(body, "baseUrl") || ALLOWED_API_BASE_URLS[0]);
          const apiKey = getString(body, "apiKey");
          const protocol = getProtocol(body.protocol);
          const clientId = getString(body, "clientId") || "anonymous";
          const analysisModel = getString(body, "analysisModel");
          const prompt = getString(body, "prompt");

          if (!prompt) {
            sendJson(res, 400, {
              ok: false,
              requestId,
              detail: { status: 400, error: "提示词不能为空" },
            });
            return;
          }

          createRequestLog({
            requestId,
            requestType: "agent_analysis",
            clientId: truncateText(clientId, 120),
            clientUserAgent: truncateText(req.headers["user-agent"] || "", 500),
            clientIpHash: hashClientIp(req),
            protocol,
            apiBaseUrl: baseUrl.replace(/\/+$/, ""),
            ...apiKeyLogMeta(apiKey),
            endpoint: "/api/agent/analyze",
            model: truncateText(analysisModel || "local-agent-heuristic", 240),
            prompt: truncateText(prompt, 4000),
            negativePrompt: getString(body, "negativePrompt") ? truncateText(getString(body, "negativePrompt"), 2400) : undefined,
            aspectRatio: getString(body, "aspectRatio") || undefined,
            size: getString(body, "size") || undefined,
            resolution: getString(body, "resolution") || undefined,
            quality: getString(body, "quality") || undefined,
            outputFormat: getString(body, "outputFormat") || undefined,
            referenceCount: getNumber(body.referenceCount) || 0,
            requestParams: sanitizeForLog({
              ...body,
              baseUrl,
              apiKey: undefined,
              credential: apiKeyLogMeta(apiKey),
            }),
            status: "running",
            createdAt: startedAt,
            startedAt,
            imageSaved: false,
          });
          logCreated = true;

          sse("started", { requestId, model: analysisModel || "local-agent-heuristic", startedAt });

          const localAnalysis = buildLocalAgentModeAnalysis(body);
          let analysis = localAnalysis;
          let fallbackReason = "";

          if (analysisModel && apiKey) {
            try {
              analysis = await analyzeAgentModeWithGpt(baseUrl, apiKey, body, requestId, {
                onUpstreamConnected: (status) => {
                  sse("upstream_connected", { status, elapsedMs: Date.now() - startedAt });
                },
                onFirstByte: () => {
                  sse("receiving", { elapsedMs: Date.now() - startedAt });
                },
                onChunk: (_delta, accumulated) => {
                  chunkCount += 1;
                  lastChunkAt = Date.now();
                  sse("chunk", {
                    totalLength: accumulated.length,
                    preview: truncateText(accumulated, 420),
                  });
                },
              });
            } catch (error) {
              fallbackReason = truncateText(
                error instanceof Error ? error.message : JSON.stringify(sanitizeForLog(error)),
                1000,
              );
              analysis = {
                ...localAnalysis,
                reasoningSummary: `${localAnalysis.reasoningSummary} AI 分析暂不可用，已回退到本地规则拆解。`,
              };
            }
          }

          const finishedAt = Date.now();
          if (logCreated) {
            updateRequestLog(requestId, {
              status: "success",
              httpStatus: 200,
              finishedAt,
              durationMs: finishedAt - startedAt,
              responseBody: sanitizeForLog({
                ok: true,
                requestId,
                usedModel: analysisModel || "local-agent-heuristic",
                fallbackReason: fallbackReason || undefined,
                analysis,
                chunkCount,
              }),
            });
          }

          sse("done", {
            requestId,
            analysis,
            durationMs: finishedAt - startedAt,
            chunkCount,
            fallbackReason: fallbackReason || undefined,
          });
          res.end();
        } catch (error) {
          const status = isAllowedApiBaseUrlError(error) ? 400 : httpStatusFromDetail(error) || 500;
          if (logCreated) {
            const summary = safeErrorSummary(error);
            const finishedAt = Date.now();
            updateRequestLog(requestId, {
              status: "error",
              httpStatus: status,
              errorMessage: summary.message,
              errorType: summary.type || "agent_analysis_error",
              errorCode: summary.code,
              errorRaw: summary.raw,
              responseBody: sanitizeForLog({
                ok: false,
                requestId,
                status,
                detail: error,
                chunkCount,
                lastChunkAt: lastChunkAt ? lastChunkAt - startedAt : null,
              }),
              finishedAt,
              durationMs: finishedAt - startedAt,
            });
          }
          const detail = error && typeof error === "object" && "error" in (error as Record<string, unknown>)
            ? error
            : { status, error: error instanceof Error ? error.message : String(error) };
          if (sseStarted) {
            sse("error", { requestId, status, detail, chunkCount });
            res.end();
          } else {
            sendJson(res, status, { ok: false, requestId, detail });
          }
        }
      });

      app.use("/api/images/generate", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        const requestId = randomUUID();
        const startedAt = Date.now();
        let logCreated = false;
        try {
          const body = await readJsonBody(req);
          const baseUrl = normalizeAllowedApiBaseUrl(getString(body, "baseUrl"));
          const apiKey = getString(body, "apiKey");
          const publicBaseUrl = publicBaseUrlFromRequest(req);
          const request = (body.request && typeof body.request === "object" ? body.request : {}) as GenerateRequest;
          const protocol = getProtocol(request.protocol);
          request.protocol = protocol;
          const requestMeta = body.request && typeof body.request === "object"
            ? body.request as Record<string, unknown>
            : {};
          const clientId = getString(body, "clientId") || "anonymous";
          // 图片按用户分目录存储：优先 OAuth 用户名，否则用 clientId
          const generateOauthSession = getOAuthSession(req);
          const imageUserDir = generateOauthSession?.username || clientId;

          const incomingRefs = Array.isArray(request.referenceImages) ? request.referenceImages : [];
          const referenceTotalBytes = incomingRefs.reduce((sum, image) => {
            if (!image || typeof image !== "object") return sum;
            const dataUrl = (image as { dataUrl?: unknown }).dataUrl;
            if (typeof dataUrl !== "string") return sum;
            const match = dataUrl.match(/^data:[^;]+;base64,(.*)$/);
            const base64 = (match?.[1] ?? dataUrl).replace(/\s+/g, "");
            return sum + Math.round((base64.length * 3) / 4);
          }, 0);
          const initialUploadStatus: NonNullable<RequestLog["referenceUploadStatus"]> =
            incomingRefs.length === 0 ? "none" : "received";

          createRequestLog({
            requestId,
            requestType: "image_generation",
            batchId: typeof requestMeta.batchId === "string" ? requestMeta.batchId : undefined,
            batchIndex: getNumber(requestMeta.index),
            batchTotal: getNumber(requestMeta.total),
            clientId: truncateText(clientId, 120),
            clientUserAgent: truncateText(req.headers["user-agent"] || "", 500),
            clientIpHash: hashClientIp(req),
            protocol,
            apiBaseUrl: baseUrl.replace(/\/+$/, ""),
            ...apiKeyLogMeta(apiKey),
            endpoint: generationEndpointLabel(
              protocol,
              request.model,
              incomingRefs.length,
            ),
            model: truncateText(request.model || "", 240),
            prompt: truncateText(request.prompt || "", 4000),
            negativePrompt: request.negativePrompt ? truncateText(request.negativePrompt, 2400) : undefined,
            aspectRatio: request.aspectRatio,
            size: request.size,
            resolution: request.resolution,
            quality: request.quality,
            outputFormat: request.outputFormat,
            seed: request.seed,
            agentId: typeof requestMeta.agentId === "string" ? requestMeta.agentId : undefined,
            agentName: typeof requestMeta.agentName === "string" ? truncateText(requestMeta.agentName, 120) : undefined,
            agentScenario: typeof requestMeta.agentScenario === "string" ? truncateText(requestMeta.agentScenario, 240) : undefined,
            promptVariant: typeof requestMeta.promptVariant === "string" ? requestMeta.promptVariant : undefined,
            referenceCount: incomingRefs.length,
            referenceTotalBytes,
            referenceUploadStatus: initialUploadStatus,
            requestParams: sanitizeForLog({
              ...body,
              baseUrl,
              apiKey: undefined,
              credential: apiKeyLogMeta(apiKey),
            }),
            status: "running",
            createdAt: startedAt,
            startedAt,
            imageSaved: false,
          });
          logCreated = true;

          const failFast = (status: number, message: string) => {
            const finishedAt = Date.now();
            updateRequestLog(requestId, {
              status: "error",
              httpStatus: status,
              errorMessage: message,
              errorType: "validation_error",
              responseBody: sanitizeForLog({ ok: false, requestId, detail: { error: message } }),
              finishedAt,
              durationMs: finishedAt - startedAt,
            });
            sendJson(res, status, { ok: false, requestId, detail: { error: message } });
          };

          if (!request.model || !request.prompt) {
            failFast(400, "模型和提示词不能为空");
            return;
          }

          const allowedModels = enabledModelIds();
          if (allowedModels.length > 0 && !allowedModels.includes(normalizedModelId(request.model))) {
            failFast(400, "所选模型不在允许列表中");
            return;
          }

          if (!apiKey) {
            failFast(400, "API Key 不能为空");
            return;
          }

          // 配额校验：每日生成次数（按 clientId、上海时区自然日）与每用户磁盘占用，0 = 不限
          const quotaConfig = readConfigStore().quotas;
          if ((quotaConfig.generationDailyLimit || 0) > 0) {
            const dayStart = new Date(`${squareDayKey()}T00:00:00+08:00`).getTime();
            const usedToday = (getDb().prepare(
              "SELECT COUNT(*) AS n FROM request_logs WHERE request_type = 'image_generation' AND client_id = ? AND created_at >= ? AND request_id != ?",
            ).get(truncateText(clientId, 120), dayStart, requestId) as { n: number }).n;
            if (usedToday >= quotaConfig.generationDailyLimit) {
              failFast(429, `今日生成次数已达上限（${quotaConfig.generationDailyLimit} 次），请明天再试或联系管理员调整配额`);
              return;
            }
          }
          if ((quotaConfig.userDiskLimitMB || 0) > 0) {
            const userDirPath = join(LOCAL_IMAGE_DIR, sanitizeUserDir(imageUserDir));
            let usedBytes = 0;
            try {
              if (existsSync(userDirPath)) {
                for (const file of readdirSync(userDirPath)) {
                  try { usedBytes += statSync(join(userDirPath, file)).size; } catch { /* 忽略单个文件 */ }
                }
              }
            } catch { /* 目录不可读时不拦截 */ }
            if (usedBytes >= quotaConfig.userDiskLimitMB * 1024 * 1024) {
              failFast(429, `图片存储空间已达上限（${quotaConfig.userDiskLimitMB} MB），请联系管理员清理或调整配额`);
              return;
            }
          }

          const upstreamRequestedAt = Date.now();
          const result = protocol === "openai-responses"
            ? await generateOpenAiResponses(baseUrl, apiKey, request, requestId)
            : protocol === "gemini-native"
              ? await generateGeminiNative(baseUrl, apiKey, request, requestId)
              : protocol === "google-imagen"
                ? await generateImagen(baseUrl, apiKey, request, requestId)
                : protocol === "stability-core"
                  ? await generateStability(baseUrl, apiKey, request, requestId)
                  : await generateOpenAiCompatible(baseUrl, apiKey, request, requestId, publicBaseUrl);

          const upstreamRespondedAt = Date.now();
          const finishedAt = upstreamRespondedAt;
          const durationMs = finishedAt - startedAt;
          if (result.ok) {
            const { saved, publicImages } = persistGeneratedImages(result.images ?? [], { userDir: imageUserDir, requestId });
            const imageSavedAt = Date.now();
            const responsePayload = {
              ok: true,
              status: result.status,
              images: publicImages,
              raw: sanitizeForLog(result.raw),
              requestId,
            };
            const returnedAt = Date.now();
            updateRequestLog(requestId, {
              status: "success",
              httpStatus: result.status || 200,
              responseBody: sanitizeForLog(responsePayload),
              referenceUploadStatus: incomingRefs.length === 0 ? "none" : "succeeded",
              finishedAt: returnedAt,
              durationMs: returnedAt - startedAt,
              imageSaved: saved.length > 0,
              savedImages: saved,
              stages: { receivedAt: startedAt, upstreamRequestedAt, upstreamRespondedAt, imageSavedAt, returnedAt },
            });
            sendJson(res, 200, responsePayload);
            return;
          }

          const summary = safeErrorSummary(result.detail);
          updateRequestLog(requestId, {
            status: "error",
            httpStatus: result.status || 500,
            errorMessage: summary.message,
            errorType: summary.type,
            errorCode: summary.code,
            errorRaw: summary.raw,
            errorFull: summary.full,
            responseBody: sanitizeForLog(result),
            referenceUploadStatus: incomingRefs.length === 0 ? "none" : "failed",
            finishedAt,
            durationMs,
            stages: { receivedAt: startedAt, upstreamRequestedAt, upstreamRespondedAt },
          });

          sendJson(res, result.status || 500, { ...result, requestId });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // undici 的 "terminated" 等错误真正原因在 cause 里，拼进摘要方便一眼看懂
          const causeError = (error as { cause?: unknown })?.cause;
          const causeMessage = causeError instanceof Error ? causeError.message : "";
          const summaryMessage = causeMessage && causeMessage !== message ? `${message}（${causeMessage}）` : message;
          if (logCreated) {
            const finishedAt = Date.now();
            updateRequestLog(requestId, {
              status: "error",
              httpStatus: 500,
              errorMessage: truncateText(summaryMessage, 800),
              errorType: "proxy_error",
              errorRaw: redactImageText(summaryMessage, 2500),
              errorFull: redactImageText(describeError(error), 60000),
              responseBody: sanitizeForLog({ ok: false, detail: { error: summaryMessage } }),
              referenceUploadStatus: "failed",
              finishedAt,
              durationMs: finishedAt - startedAt,
            });
          }
          sendJson(res, isAllowedApiBaseUrlError(error) ? 400 : 500, { ok: false, requestId, detail: { error: summaryMessage } });
        }
      });
}

function imageProxyPlugin(): PluginOption {
  return {
    name: "image-api-proxy",
    configureServer(server: ViteDevServer) {
      registerApiRoutes(server.middlewares as unknown as ApiApp);
    },
  };
}

function frontendVersionPlugin(): PluginOption {
  return {
    name: "frontend-build-version",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/build-version.json", (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
        res.end(JSON.stringify(FRONTEND_BUILD_INFO));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-version.json",
        source: JSON.stringify(FRONTEND_BUILD_INFO, null, 2),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), imageProxyPlugin(), frontendVersionPlugin()],
  define: {
    __FRONTEND_BUILD_VERSION__: JSON.stringify(FRONTEND_BUILD_VERSION),
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/v${FRONTEND_BUILD_VERSION}-[name]-[hash].js`,
        chunkFileNames: `assets/v${FRONTEND_BUILD_VERSION}-[name]-[hash].js`,
        assetFileNames: `assets/v${FRONTEND_BUILD_VERSION}-[name]-[hash][extname]`,
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8877,
    strictPort: true,
    allowedHosts: ["imagehub.taijiai.online"],
  },
  preview: {
    host: "0.0.0.0",
    port: 8877,
    strictPort: true,
    allowedHosts: ["image.taijiai.online"],
  },
});
