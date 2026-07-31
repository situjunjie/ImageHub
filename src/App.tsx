import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  ChevronRight,
  Copy,
  Database,
  Download,
  DownloadCloud,
  ExternalLink,
  Flame,
  Frame,
  Heart,
  ImagePlus,
  Loader2,
  LogOut,
  Maximize2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Ban,
  Save,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Star,
  Square,
  CheckSquare,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UploadCloud,
  User,
  WandSparkles,
  Wifi,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  Fragment,
  type FormEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import imageStudioLogo from "./assets/image-studio-logo.svg";
import { AppNav, type AppNavTarget } from "./shared/AppNav";
import { CanvasPage } from "./canvas/CanvasPage";
import { API_KEY_MIN_LENGTH, COMMON_AGENT_NEGATIVE_PROMPT, INDUSTRY_AGENTS, PROMPT_STARTERS, STYLE_ENHANCEMENT_PRESETS, fetchAppConfig, normalizeApiBaseUrl, runtimeEndpoints, runtimeIndustryAgents, runtimeModelConfig, runtimeModelDisplayName, runtimeModelIds, runtimePromptStarters, runtimeStylePresets, runtimeTokenGuide } from "./shared/appConfig";
import { RECIPES_LIMIT, RECIPES_STORE, REFERENCE_LIBRARY_LIMIT, REFERENCE_LIBRARY_STORE, STORE_NAME, idbDelete, listRecipes, listReferenceLibrary, openDb, saveRecipe, saveReferenceLibraryItem } from "./shared/db";
import { FullImageError, blobToDataUrl, createListThumbnail, createSquareThumbnail, generatedImageToBlob, getImageSize } from "./shared/imageUtils";
import { ASPECT_RATIOS, DEFAULT_IMAGE_RESOLUTION, GEMINI_3_PRO_IMAGE_MODEL, GPT_IMAGE_2_MODEL, GPT_IMAGE_2_PRO_MODEL, GPT_IMAGE_2_FAMILY_MODEL, IMAGE_RESOLUTIONS, PROTOCOLS, SIZE_BY_RATIO, aspectRatioNumber, explicitSizeOptionsForModel, getProtocolDefinition, getSupportedAspectRatios, gptImage2SizeOptionForSize, imageModelLaneLabel, isGemini3ProImageModel, isGptImage2Model, isGptImage2ProModel, isImageResolution, normalizedImageModelId, resolveRequestSize, safeImageResolution, scaleSize, supportsGptImage2ExplicitSizes, usesOfficialGptImageSizing } from "./shared/modelSizing";
import { GenerationSubmissionError, fetchGenerationTasks, reportGenerationClientEvent, submitGenerationTask } from "./shared/generationTasks";
import type { ApiConfig, CanvasImportPayload, GenerationLifecycleEvent, GenerationSubmissionBody, ImageParams, ImageProtocol, ImageResolution, IndustryAgent, JobStages, ModelLoadState, PromptVariant, Recipe, ReferenceLibraryItem, ServerGenerationTask, SquareFeedItem, SquareRecommendResponse, StyleEnhancement, SubmittedReference, UploadedReference } from "./shared/types";
import { clampNumber, formatBytes, formatDuration, getClientId, readApiJson, truncateForLog, uid } from "./shared/utils";


type JobStatus = "submitting" | "queued" | "running" | "success" | "error";

type ErrorDetail = unknown;


type Job = {
  id: string;
  requestId?: string;
  batchId: string;
  index: number;
  total: number;
  protocol: ImageProtocol;
  prompt: string;
  model: string;
  params: ImageParams;
  referenceImages: UploadedReference[];
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  stages?: JobStages;
  imageBlob?: Blob;
  imageUrl?: string;
  // 列表渲染用；imageUrl 始终指向原图，供预览/下载使用
  thumbUrl?: string;
  width?: number;
  height?: number;
  revisedPrompt?: string;
  errorDetail?: ErrorDetail;
  agentId?: string;
  agentName?: string;
  agentScenario?: string;
  promptVariant?: PromptVariant;
  attempt?: number;
  maxAttempts?: number;
  submittedReferenceImages?: SubmittedReference[];
  // 首个任务可能在用户点击时已提前记录 intent，真正入前端队列时不要重复写“用户点击”日志。
  submissionIntentLogged?: boolean;
};


type StoredHistoryRecord = {
  id: string;
  requestId?: string;
  batchId?: string;
  index?: number;
  total?: number;
  protocol?: ImageProtocol;
  prompt: string;
  model: string;
  params: ImageParams;
  referenceImages?: UploadedReference[];
  submittedReferenceImages?: SubmittedReference[];
  // 异步生成：submitting/queued/running 也要落库，否则关掉页面就失去了找回任务的凭据
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  stages?: JobStages;
  imageBlob?: Blob;
  // 列表用缩略图（512px WebP）。用存储换时间：省的是位图解码内存，不是磁盘。
  thumbBlob?: Blob;
  thumbWidth?: number;
  thumbHeight?: number;
  width?: number;
  height?: number;
  revisedPrompt?: string;
  errorDetail?: ErrorDetail;
  agentId?: string;
  agentName?: string;
  agentScenario?: string;
  promptVariant?: PromptVariant;
};

type HistoryRecord = Omit<StoredHistoryRecord, "referenceImages"> & {
  referenceImages: UploadedReference[];
  objectUrl?: string;
  thumbUrl?: string;
};


type LocalLogLevel = "info" | "success" | "warning" | "error";
type LocalLogType = "model_load" | "api_health" | "prompt_analysis" | "image_generation" | "agent_analysis";

type ReferenceUploadStatus =
  | "none"
  | "prepared"
  | "sent_ok"
  | "sent_failed"
  | "skipped_unsupported";

type ReferenceSummary = {
  hasReferences: boolean;
  count: number;
  totalBytes: number;
  status: ReferenceUploadStatus;
  unsupportedReason?: string;
  items?: Array<{
    name: string;
    type: string;
    originalBytes: number;
    requestBytes: number;
    compressed: boolean;
  }>;
};

type LocalLogEntry = {
  id: string;
  createdAt: number;
  type: LocalLogType;
  level: LocalLogLevel;
  title: string;
  message: string;
  endpoint?: string;
  requestId?: string;
  durationMs?: number;
  referenceSummary?: ReferenceSummary;
  params?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: unknown;
};


type AnalysisMode = "send" | "optimize" | "params" | "risk" | "style";
type RiskLevel = "low" | "medium" | "high";

type SuggestedParams = {
  aspectRatio?: string;
  size?: string;
  resolution?: ImageResolution;
  count?: number;
  quality?: string;
  styleStrength?: "low" | "medium" | "high";
  referenceWeight?: "low" | "medium" | "high";
};

type PromptRisk = {
  level: RiskLevel;
  title: string;
  description: string;
  fix?: string;
};


type PromptAnalysisResult = {
  safe: boolean;
  score: number;
  riskLevel: RiskLevel;
  summary: string;
  optimizedPrompt: string;
  suggestedNegativePrompt?: string;
  suggestedParams: SuggestedParams;
  risks: PromptRisk[];
  styleEnhancements: StyleEnhancement[];
  analysisModel?: string;
  source?: "ai" | "local";
};

type PromptAnalysisState = {
  status: "idle" | "analyzing" | "receiving" | "ready" | "error";
  mode: AnalysisMode;
  message: string;
  result?: PromptAnalysisResult;
  error?: string;
  streamPreview?: string;
  streamCharacters?: number;
  streamChunks?: number;
};

type AgentRunPhase = "collecting" | "planning" | "prompting" | "prechecking" | "countdown" | "generating" | "reviewing" | "done";



type AgentPlan = {
  agentId: string;
  agentName: string;
  scenario: string;
  brief: string;
  promptVariants: Record<PromptVariant, string>;
  recommendedParams: Partial<ImageParams>;
  negativePrompt: string;
  risks: PromptRisk[];
  notes: string[];
};

type AgentContext = {
  plan: AgentPlan;
  variant: PromptVariant;
};

type GenerationIntent = {
  requestId: string;
  submittedAt: number;
};

type AnalysisCountdown = {
  runId: string;
  secondsLeft: number;
  prompt: string;
  params: ImageParams;
  referenceImages: UploadedReference[];
  result?: PromptAnalysisResult;
  agentContext?: AgentContext;
  label: string;
};

type AgentModeIntentType = "single_image" | "multi_image_batch" | "brochure_project" | "page_refine" | "unknown";
type AgentModeCostLevel = "low" | "medium" | "high";
type AgentModeStatus = "idle" | "analyzing" | "receiving" | "needs_confirmation" | "planned" | "executing" | "error";

type AgentModeJobSpec = {
  id: string;
  title: string;
  prompt: string;
  objective?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  size?: string;
  resolution?: ImageResolution;
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

type AgentModeState = {
  status: AgentModeStatus;
  message: string;
  requestId?: string;
  error?: string;
  result?: AgentModeAnalysisResult;
  streamPreview?: string;
  streamCharacters?: number;
  streamChunks?: number;
  requestPrompt?: string;
};

type PreviewItem = {
  id: string;
  requestId?: string;
  // url 永远是原图。thumbUrl 只用于加载过渡期的占位，绝不作为最终画质呈现。
  url?: string;
  thumbUrl?: string;
  protocol?: ImageProtocol;
  prompt: string;
  model: string;
  status: "success" | "error";
  params: ImageParams;
  width?: number;
  height?: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  errorDetail?: ErrorDetail;
  agentId?: string;
  agentName?: string;
  agentScenario?: string;
  promptVariant?: PromptVariant;
  submittedReferenceImages?: SubmittedReference[];
};

type AppPage = "home" | "studio" | "square" | "admin" | "canvas";

type SquareFeedTab = "latest" | "hot" | "top_day" | "top_week" | "top_month";


type SquareFeedResponse = {
  ok: boolean;
  tab: SquareFeedTab;
  items: SquareFeedItem[];
  nextCursor: string;
  hasMore: boolean;
  error?: string;
};

type SquareQuotaResponse = {
  ok: boolean;
  dailyRecommendUsed: number;
  dailyRecommendLeft: number;
  dailyLikeUsed: number;
  dailyLikeLeft: number;
  shelfCount: number;
  shelfLimit: number;
  dayKey?: string;
  error?: string;
};


type SquareLikeResponse = {
  ok: boolean;
  status?: "liked" | "unliked" | "rejected";
  action?: "liked" | "unliked" | "noop" | "rejected";
  likeCount?: number;
  remainingLikeQuota?: number;
  reasonCode?: string;
  error?: string;
};

type SquareRecommendStatus = {
  status: "submitting" | "success" | "error";
  message: string;
  itemId?: string;
};

type SquareAdminTrend = {
  dateKey: string;
  recommendAttempts: number;
  added: number;
  replaced: number;
  rejected: number;
  likes: number;
  unlikes: number;
};

type SquareAdminReason = {
  reasonCode: string;
  count: number;
};

type SquareAdminRiskEvent = {
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

type SquareAdminOverview = {
  activeItems: number;
  totalItems: number;
  totalRecommendAttempts: number;
  totalLikes: number;
  replacementRate: number;
  likeRate: number;
  trend: SquareAdminTrend[];
  rejectedReasonTop: SquareAdminReason[];
  riskEvents: SquareAdminRiskEvent[];
};

type AdminUserView = {
  username: string;
  mustChangePassword: boolean;
  oauthUser?: boolean;
};

type AdminRequestLog = {
  requestId: string;
  requestType?: "image_generation" | "prompt_analysis" | "agent_analysis";
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
  upstreamPayloadKeys?: string[];
  upstreamReferenceCount?: number;
  upstreamReferenceMode?: string;
  upstreamSize?: string;
  requestParams?: unknown;
  upstreamRequest?: unknown;
  responseBody?: unknown;
  status: "submitting" | "queued" | "running" | "success" | "error";
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
  imageSaved?: boolean;
  savedImages?: Array<{ id: string; mime: string; bytes: number; thumbId?: string; thumbBytes?: number }>;
  stages?: {
    clientSubmittedAt?: number;
    clientPersistedAt?: number;
    clientRequestStartedAt?: number;
    receivedAt?: number;
    requestParsedAt?: number;
    validatedAt?: number;
    validationFailedAt?: number;
    idempotencyClaimedAt?: number;
    enqueuedAt?: number;
    acceptedResponseAt?: number;
    clientAcceptedAt?: number;
    dispatchedAt?: number;
    upstreamRequestedAt?: number;
    upstreamRespondedAt?: number;
    imageSavedAt?: number;
    returnedAt?: number;
    taskCompletedAt?: number;
    lastReconcileAt?: number;
    lastIdempotentRetryAt?: number;
    clientResultReceivedAt?: number;
    clientErrorReceivedAt?: number;
  };
  lifecycleEvents?: GenerationLifecycleEvent[];
  sourceSurface?: "studio" | "canvas";
  localRecordId?: string;
  idempotentReplayCount?: number;
  lastIdempotentReplayAt?: number;
};

type AdminDailyStat = {
  date: string;
  total: number;
  success: number;
  error: number;
  images: number;
  successRate: number;
  avgDurationMs: number;
};

type AdminStageStats = {
  received: number;
  referenceForwarded: number;
  referenceTotal: number;
  upstreamResponded: number;
  upstreamSuccess: number;
  imageSaved: number;
};

type AdminStats = {
  total: number;
  success: number;
  error: number;
  running: number;
  successRate: number;
  avgDurationMs: number;
  p50DurationMs?: number;
  p95DurationMs?: number;
  analysisCount?: number;
  totalImages?: number;
  feedback?: { up: number; down: number };
  modelCounts: Record<string, number>;
  errorCounts: Record<string, number>;
  daily?: AdminDailyStat[];
  stageStats?: AdminStageStats;
};

type ModelStat = {
  id: string;
  samples: number;
  successRate: number;
  p50DurationMs: number;
  up: number;
  down: number;
};


const HISTORY_PAGE_SIZE = 20;
const SQUARE_PAGE_SIZE = 20;
const REFERENCE_LIMIT = 6;
const MAX_REFERENCE_SIZE = 10 * 1024 * 1024;
const MAX_REFERENCE_REQUEST_BYTES = 512 * 1024;
const REFERENCE_REQUEST_MAX_EDGE = 1536;
const MIN_REFERENCE_EDGE = 128;
const LARGE_REFERENCE_EDGE = 4096;
const PROMPT_TEXTAREA_MAX_HEIGHT = 220;
const FRONTEND_VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
// 短于这个长度的 Key 在任何日志/诊断文件里都不回显字符：
// 4 位前缀对一把 12 位的 Key 就是三分之一，对短 Key 而言前缀本身即泄漏。
const API_KEY_MASK_MIN_LENGTH = 20;
const AGENT_MODE_STORAGE_KEY = "imageStudioAgentModeEnabled";
const AGENT_MODE_NAME = "Agent 模式 A";


const SQUARE_FEED_TABS: Array<{ value: SquareFeedTab; label: string; icon: typeof Clock3 }> = [
  { value: "latest", label: "最新", icon: Clock3 },
  { value: "hot", label: "热门", icon: Flame },
  { value: "top_day", label: "精选", icon: Star },
  { value: "top_week", label: "本周", icon: BarChart3 },
  { value: "top_month", label: "本月", icon: BarChart3 },
];
const CURRENT_FRONTEND_VERSION = typeof __FRONTEND_BUILD_VERSION__ === "string"
  ? __FRONTEND_BUILD_VERSION__
  : "dev";
const DEFAULT_PROTOCOL: ImageProtocol = "custom-openai";
const PRIMARY_IMAGE_MODELS = [GPT_IMAGE_2_MODEL, GEMINI_3_PRO_IMAGE_MODEL] as const;
const SUPPORTED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);



const ANALYSIS_STEPS = [
  "正在理解画面主体",
  "正在检查生图兼容性",
  "正在预判失败风险",
  "正在推荐比例与参数",
  "正在增强风格表达",
];

const PROMPT_VARIANT_LABELS: Record<PromptVariant, string> = {
  stable: "稳定版",
  creative: "创意版",
  commercial: "商业版",
};


function createAgentDefaults(agent: IndustryAgent) {
  return agent.fields.reduce<Record<string, string>>((values, field) => {
    values[field.id] = agent.defaultValues[field.id] || field.defaultValue || "";
    return values;
  }, {});
}

function compactAgentValues(agent: IndustryAgent, values: Record<string, string>) {
  return agent.fields
    .map((field) => {
      const value = (values[field.id] || agent.defaultValues[field.id] || field.defaultValue || "").trim();
      return value ? `${field.label}：${value}` : "";
    })
    .filter(Boolean);
}

function hasAgentUserOverrides(agent: IndustryAgent, values: Record<string, string>) {
  return agent.fields.some((field) => {
    const value = (values[field.id] || "").trim();
    const defaultValue = (agent.defaultValues[field.id] || field.defaultValue || "").trim();
    return value.length > 0 && value !== defaultValue;
  });
}

function buildAgentPrompt(agent: IndustryAgent, values: Record<string, string>, variant: PromptVariant) {
  const details = compactAgentValues(agent, values);
  return [
    `行业类型：${agent.name}，${agent.scenario}`,
    `业务目标：${agent.defaultGoal}`,
    `主体：${agent.defaultSubject}`,
    `使用场景：${agent.defaultScene}`,
    `目标受众：${agent.defaultAudience}`,
    `业务信息：${details.join("；")}。`,
    `平台/比例约束：${agent.recommendedRatio}，画面可直接用于${agent.scenario}。`,
    `构图：主体清晰，视觉中心明确，保留必要文案区或平台安全区。`,
    `光线：真实自然，符合${agent.name}的专业摄影语言。`,
    `背景：干净、有层次，不干扰主体。`,
    `镜头/材质/细节：${agent.supplements.join("，")}。`,
    `提示词蓝图：${agent.promptBlueprint}`,
    `版本策略：${agent.promptStructures[variant]}`,
    `负面控制：${agent.negativePrompt}`,
    `交付标准：${agent.qualityChecklist.join("；")}。高细节，真实光影，专业商业视觉，可交付成片。`,
  ].join("\n");
}

function buildAgentPlan(agent: IndustryAgent, values: Record<string, string>): AgentPlan {
  const filledValues = compactAgentValues(agent, values);
  const hasOverrides = hasAgentUserOverrides(agent, values);
  const brief = [
    `画面目标：${agent.defaultGoal}`,
    `默认主体：${agent.defaultSubject}。`,
    `默认场景：${agent.defaultScene}`,
    filledValues.length ? `业务信息：${filledValues.join("；")}。` : "业务信息：用户未填写，系统按行业默认值补全。",
    `构图方案：推荐 ${agent.recommendedRatio}，主体明确，保留必要文案或平台安全区。`,
    `风格关键词：${agent.supplements.join("，")}。`,
    `质量检查：${agent.qualityChecklist.join("；")}。`,
  ].join("\n");

  return {
    agentId: agent.id,
    agentName: agent.name,
    scenario: agent.scenario,
    brief,
    promptVariants: {
      stable: buildAgentPrompt(agent, values, "stable"),
      creative: buildAgentPrompt(agent, values, "creative"),
      commercial: buildAgentPrompt(agent, values, "commercial"),
    },
    recommendedParams: {
      aspectRatio: agent.recommendedRatio,
      size: resolveSize(agent.recommendedRatio),
      batchCount: agent.defaultCount,
      quality: agent.defaultQuality,
      negativePrompt: agent.negativePrompt,
    },
    negativePrompt: agent.negativePrompt,
    risks: [
      {
        level: "low",
        title: "文字渲染需后期确认",
        description: "如果画面中需要精确标题或品牌字样，建议生成后用设计工具补字。",
        fix: "把模型负责的内容聚焦到画面、留白和视觉层级。",
      },
    ],
    notes: [
      hasOverrides ? "已根据你的补充重新规划。" : agent.emptyStateHint,
      `已按「${agent.name}」补全行业摄影语言、比例、负面提示词和质量检查项。`,
      "选择 variant 后系统会把提示词填入输入框，你可以继续编辑再点生成。",
    ],
  };
}

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const fullDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const LOCAL_LOG_STORAGE_KEY = "imageStudioLocalRequestLogs";
const LOCAL_LOG_LIMIT = 200;



// 本项目是 hash 路由，但 /admin、/studio 这类 path 直链是所有人都会先试的写法
// （服务端 SPA fallback 会返回 index.html，hash 为空就落回首页，看起来像"打不开"）。
// 在 React 挂载前把 path 规范化成 hash，之后全程仍只走 hash 一套逻辑。
(function normalizePathToHash() {
  if (typeof window === "undefined" || window.location.hash) return;
  const path = window.location.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (path === "studio" || path === "canvas" || path === "square" || path === "admin" || path === "login") {
    window.history.replaceState(null, "", `/#${path}`);
  }
})();

function pageFromHash(): AppPage {
  if (window.location.hash === "#studio") return "studio";
  if (window.location.hash === "#square") return "square";
  if (window.location.hash === "#canvas") return "canvas";
  if (window.location.hash.startsWith("#admin")) return "admin";
  return "home";
}



function formatDate(value?: number) {
  if (!value) return "-";
  return dateTimeFormatter.format(new Date(value));
}

function formatFullDate(value?: number) {
  if (!value) return "-";
  return fullDateTimeFormatter.format(new Date(value));
}

function formatFileDate(value = Date.now()) {
  const date = new Date(value);
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}


// 错误分类可能是上游直接吐回来的 HTML（如 nginx 404 页），做成可读短标签再展示
function formatErrorKeyLabel(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "未知错误";
  if (/<html|<head|<body/i.test(raw)) {
    const title = raw.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    const server = raw.match(/<center>([a-z0-9_.-]+)<\/center>\s*<\/body>/i)?.[1]?.trim();
    const label = title || raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    return server ? `${label}（${server}）` : label;
  }
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
}

function formatCompactDuration(ms = 0) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

const ADMIN_LIFECYCLE_LABELS: Record<string, string> = {
  client_submitted: "用户点击提交",
  client_persisted: "前端任务快照落盘",
  client_request_started: "前端发送生成请求",
  server_received: "服务端收到请求",
  request_parsed: "请求体解析完成",
  request_validated: "参数与配额校验通过",
  request_rejected: "服务端拒绝请求",
  idempotency_claimed: "requestId 幂等占位",
  idempotent_replay: "幂等重投命中已有任务",
  queued: "任务进入服务端队列",
  accepted_response_sent: "服务端返回 202 接单",
  client_accepted: "前端收到接单结果",
  dispatched: "任务出队开始执行",
  upstream_requested: "请求上游图片模型",
  upstream_responded: "收到上游响应",
  image_saved: "生成图片已落盘",
  task_completed: "服务端任务完成",
  task_failed: "服务端任务失败",
  queue_timeout: "服务端排队超时",
  server_restart_abort: "服务重启中断任务",
  client_transport_ambiguous: "前端网络响应不确定",
  client_reconcile_started: "前端开始按 requestId 对账",
  client_reconcile_found: "前端对账找到任务",
  client_reconcile_miss: "前端本轮对账未找到任务",
  client_idempotent_retry: "前端使用同一 ID 幂等重投",
  client_submission_rejected: "前端收到提交拒绝",
  client_submission_unconfirmed: "前端暂无法确认接单",
  client_result_received: "前端已取回并保存图片",
  client_error_received: "前端已收到失败结果",
};

const ADMIN_STATUS_LABELS: Record<AdminRequestLog["status"], string> = {
  submitting: "提交中",
  queued: "排队中",
  running: "生成中",
  success: "成功",
  error: "失败",
};

function adminLifecycleEvents(log: AdminRequestLog): GenerationLifecycleEvent[] {
  const actual = Array.isArray(log.lifecycleEvents) ? [...log.lifecycleEvents] : [];
  const stages = log.stages;
  const derived: Array<{ phase: string; at?: number; source: GenerationLifecycleEvent["source"] }> = [
    { phase: "client_submitted", at: stages?.clientSubmittedAt, source: "client" },
    { phase: "client_persisted", at: stages?.clientPersistedAt, source: "client" },
    { phase: "client_request_started", at: stages?.clientRequestStartedAt, source: "client" },
    { phase: "server_received", at: stages?.receivedAt || log.startedAt || log.createdAt, source: "server" },
    { phase: "request_parsed", at: stages?.requestParsedAt, source: "server" },
    { phase: "request_validated", at: stages?.validatedAt, source: "server" },
    { phase: "request_rejected", at: stages?.validationFailedAt, source: "server" },
    { phase: "idempotency_claimed", at: stages?.idempotencyClaimedAt, source: "server" },
    { phase: "queued", at: stages?.enqueuedAt, source: "server" },
    { phase: "accepted_response_sent", at: stages?.acceptedResponseAt, source: "server" },
    { phase: "client_accepted", at: stages?.clientAcceptedAt, source: "client" },
    { phase: "dispatched", at: stages?.dispatchedAt, source: "server" },
    { phase: "upstream_requested", at: stages?.upstreamRequestedAt, source: "upstream" },
    { phase: "upstream_responded", at: stages?.upstreamRespondedAt, source: "upstream" },
    { phase: "image_saved", at: stages?.imageSavedAt, source: "server" },
    { phase: "task_completed", at: stages?.taskCompletedAt || (log.status === "success" ? log.finishedAt : undefined), source: "server" },
    { phase: "task_failed", at: log.status === "error" ? log.finishedAt : undefined, source: "server" },
    { phase: "client_idempotent_retry", at: stages?.lastIdempotentRetryAt, source: "client" },
    { phase: "client_result_received", at: stages?.clientResultReceivedAt, source: "client" },
    { phase: "client_error_received", at: stages?.clientErrorReceivedAt, source: "client" },
  ];
  for (const item of derived) {
    if (typeof item.at !== "number" || actual.some((event) => event.phase === item.phase)) continue;
    actual.push({
      id: `derived-${item.phase}-${item.at}`,
      phase: item.phase,
      source: item.source,
      at: item.at,
    });
  }
  return actual
    .filter((event) => event && typeof event.at === "number" && Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at || (a.recordedAt || a.at) - (b.recordedAt || b.at));
}

function adminLifecycleLatestLabel(log: AdminRequestLog) {
  const events = adminLifecycleEvents(log);
  const latest = events[events.length - 1];
  return latest ? (ADMIN_LIFECYCLE_LABELS[latest.phase] || latest.phase) : "等待链路事件";
}

function adminLifecycleDuration(log: AdminRequestLog) {
  if (typeof log.durationMs === "number" && (log.status === "success" || log.status === "error")) {
    return log.durationMs;
  }
  const startedAt = log.stages?.clientSubmittedAt || log.startedAt || log.createdAt;
  return Math.max(0, Date.now() - startedAt);
}

function normalizeImageType(file: File) {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (type) return type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function formatReferenceType(type: string) {
  if (type === "image/jpeg") return "JPEG";
  if (type === "image/png") return "PNG";
  if (type === "image/webp") return "WebP";
  return type.replace(/^image\//, "").toUpperCase() || "文件";
}

function referenceDimensionLabel(image: UploadedReference) {
  return image.width && image.height ? `${image.width} x ${image.height}` : "尺寸未知";
}

function isReferenceUsable(image: UploadedReference) {
  return Boolean(image.dataUrl) && image.status !== "error";
}

function normalizeStoredReferenceImages(value: unknown): UploadedReference[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<UploadedReference[]>((images, item, index) => {
    if (!item || typeof item !== "object") return images;
    const record = item as Partial<UploadedReference>;
    const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
    if (!dataUrl) return images;
    const status = record.status === "error" || record.status === "warning" || record.status === "ready"
      ? record.status
      : "ready";
    images.push({
      id: typeof record.id === "string" ? record.id : `reference-${index + 1}`,
      name: typeof record.name === "string" && record.name ? record.name : `参考图 ${index + 1}`,
      type: typeof record.type === "string" && record.type ? record.type : "image/png",
      size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0,
      dataUrl,
      thumbnailDataUrl: typeof record.thumbnailDataUrl === "string" && record.thumbnailDataUrl
        ? record.thumbnailDataUrl
        : dataUrl,
      width: typeof record.width === "number" ? record.width : undefined,
      height: typeof record.height === "number" ? record.height : undefined,
      status,
      message: typeof record.message === "string" ? record.message : undefined,
    });
    return images;
  }, []);
}

function referenceImagesForHistory(images: UploadedReference[]) {
  return normalizeStoredReferenceImages(images).map((image) => ({ ...image }));
}

function dataUrlByteLength(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.round((base64.length * 3) / 4);
}

function mimeFromDataUrl(dataUrl: string, fallback = "image/png") {
  return dataUrl.match(/^data:([^;]+);base64,/)?.[1] || fallback;
}

function withImageExtension(name: string, mime: string) {
  const ext = mime === "image/jpeg" ? "jpg" : mime.replace(/^image\//, "") || "png";
  const base = name.replace(/\.(png|jpe?g|webp)$/i, "") || "reference";
  return `${base}.${ext}`;
}

function renderReferenceForRequest(imageDataUrl: string, maxEdge: number, mime: string, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = longestEdge > 0 ? Math.min(1, maxEdge / longestEdge) : 1;
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        reject(new Error("无法压缩参考图"));
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL(mime, quality));
    };
    image.onerror = () => reject(new Error("无法读取参考图"));
    image.src = imageDataUrl;
  });
}

async function prepareReferenceForRequest(image: UploadedReference) {
  const originalBytes = dataUrlByteLength(image.dataUrl);
  const longestEdge = Math.max(image.width || 0, image.height || 0);
  if (originalBytes <= MAX_REFERENCE_REQUEST_BYTES && longestEdge <= REFERENCE_REQUEST_MAX_EDGE) {
    return {
      name: image.name,
      type: image.type,
      dataUrl: image.dataUrl,
      originalBytes,
      requestBytes: originalBytes,
      compressed: false,
    };
  }

  let best = image.dataUrl;
  const edges = [REFERENCE_REQUEST_MAX_EDGE, 1280, 1024];
  const qualities = [0.82, 0.72, 0.62];
  for (const edge of edges) {
    for (const quality of qualities) {
      try {
        const next = await renderReferenceForRequest(image.dataUrl, edge, "image/webp", quality);
        if (dataUrlByteLength(next) < dataUrlByteLength(best)) best = next;
        if (dataUrlByteLength(next) <= MAX_REFERENCE_REQUEST_BYTES) {
          const type = mimeFromDataUrl(next, "image/webp");
          return {
            name: withImageExtension(image.name, type),
            type,
            dataUrl: next,
            originalBytes,
            requestBytes: dataUrlByteLength(next),
            compressed: true,
          };
        }
      } catch {
        // Try the next compression setting.
      }
    }
  }

  const type = mimeFromDataUrl(best, image.type);
  return {
    name: withImageExtension(image.name, type),
    type,
    dataUrl: best,
    originalBytes,
    requestBytes: dataUrlByteLength(best),
    compressed: best !== image.dataUrl,
  };
}

async function referenceImagesForRequest(images: UploadedReference[]) {
  const prepared = await Promise.all(images.map(prepareReferenceForRequest));
  return prepared.map((image) => ({
    name: image.name,
    type: image.type,
    dataUrl: image.dataUrl,
  }));
}

function preparedReferenceMetaForLog(images: Array<{ name: string; type: string; dataUrl: string }>) {
  return images.map((image, index) => ({
    index,
    name: image.name,
    type: image.type,
    requestBytes: dataUrlByteLength(image.dataUrl),
  }));
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "image";
}

function recordFilename(record: Job) {
  const size = record.width && record.height ? `${record.width}x${record.height}` : record.params.size || "image";
  return `${formatFileDate(record.createdAt)}-${String(record.index).padStart(2, "0")}-${sanitizeFilename(record.model)}-${size}.${record.params.outputFormat}`;
}


function isImageProtocol(value: string | null): value is ImageProtocol {
  return PROTOCOLS.some((protocol) => protocol.value === value);
}


function getAspectDefinition(value: string) {
  return ASPECT_RATIOS.find((ratio) => ratio.value === value) || ASPECT_RATIOS[0];
}


function protocolForImageModel(model: string, fallback: ImageProtocol = DEFAULT_PROTOCOL): ImageProtocol {
  if (isGemini3ProImageModel(model)) return "gemini-native";
  if (isGptImage2Model(model)) {
    return fallback === "openai-images" ? "openai-images" : "custom-openai";
  }
  return fallback;
}

function protocolMatchesImageModel(protocol: ImageProtocol, model = "") {
  if (!model) return true;
  if (isGemini3ProImageModel(model)) return protocol === "gemini-native";
  if (isGptImage2Model(model)) return protocol === "custom-openai" || protocol === "openai-images";
  return true;
}


function isAspectRatioSupported(
  protocol: ImageProtocol,
  aspectRatio: string,
  model = "",
  resolution: ImageResolution = DEFAULT_IMAGE_RESOLUTION,
) {
  return getSupportedAspectRatios(protocol, model, resolution).includes(aspectRatio);
}


function resolveSize(aspectRatio: string, resolution: ImageResolution = DEFAULT_IMAGE_RESOLUTION) {
  const baseSize = SIZE_BY_RATIO[aspectRatio] || SIZE_BY_RATIO["1:1"];
  return scaleSize(baseSize, safeImageResolution(resolution));
}


function normalizeResolutionForRequest(
  resolution: ImageResolution,
  protocol: ImageProtocol,
  model = "",
) {
  return usesOfficialGptImageSizing(protocol, model) ? DEFAULT_IMAGE_RESOLUTION : safeImageResolution(resolution);
}

function normalizeImageParams(params: Partial<ImageParams> = {}): ImageParams {
  const aspectRatio = typeof params.aspectRatio === "string" ? params.aspectRatio : "1:1";
  const resolution = safeImageResolution(params.resolution);
  return {
    aspectRatio,
    resolution,
    size: typeof params.size === "string" && params.size.trim()
      ? params.size.trim()
      : resolveSize(aspectRatio, resolution),
    quality: typeof params.quality === "string" ? params.quality : "auto",
    outputFormat: params.outputFormat === "jpeg" || params.outputFormat === "webp" ? params.outputFormat : "png",
    batchCount: clampNumber(Number(params.batchCount || 4), 1, 20),
    concurrency: clampNumber(Number(params.concurrency || 2), 1, 6),
    retryLimit: Number.isFinite(Number(params.retryLimit)) ? clampNumber(Number(params.retryLimit), 0, 5) : 2,
    seed: typeof params.seed === "string" ? params.seed : "",
    negativePrompt: typeof params.negativePrompt === "string" ? params.negativePrompt : "",
  };
}


function aspectRatioCss(width?: number, height?: number, fallbackAspectRatio = "1:1") {
  if (width && height && width > 0 && height > 0) return `${width} / ${height}`;
  const [fallbackWidth = 1, fallbackHeight = 1] = fallbackAspectRatio.split(":").map(Number);
  if (!Number.isFinite(fallbackWidth) || !Number.isFinite(fallbackHeight) || fallbackWidth <= 0 || fallbackHeight <= 0) {
    return "1 / 1";
  }
  return `${fallbackWidth} / ${fallbackHeight}`;
}

function aspectClass(width?: number, height?: number, fallbackAspectRatio = "1:1") {
  const ratio = width && height && width > 0 && height > 0
    ? width / height
    : aspectRatioNumber(fallbackAspectRatio);
  if (ratio >= 4) return "is-extreme-wide";
  if (ratio >= 2.1) return "is-wide";
  if (ratio <= 0.25) return "is-extreme-tall";
  if (ratio <= 0.55) return "is-tall";
  if (ratio > 1.15) return "is-landscape";
  if (ratio < 0.87) return "is-portrait";
  return "is-square";
}

function previewStyle(width?: number, height?: number, fallbackAspectRatio = "1:1"): CSSProperties {
  return {
    aspectRatio: aspectRatioCss(width, height, fallbackAspectRatio),
  };
}

function formatProtocolCapability(protocol: ImageProtocol) {
  const definition = getProtocolDefinition(protocol);
  const capabilities = [
    definition.supportsReferenceImages ? "支持参考图" : "不支持参考图",
    definition.supportsQuality ? "支持质量" : "不支持质量",
    definition.supportsOutputFormat ? "支持格式" : "不支持格式",
  ];
  return capabilities.join(" · ");
}

function apiConnectionKey(config: ApiConfig) {
  return `${config.protocol}|${normalizeApiBaseUrl(config.baseUrl)}|${config.apiKey.trim()}`;
}

function errorStatus(detail: ErrorDetail) {
  if (!detail || typeof detail !== "object") return undefined;
  const record = detail as Record<string, unknown>;
  if (typeof record.status === "number") return record.status;
  const error = record.error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).status === "number") {
    return (error as Record<string, unknown>).status as number;
  }
  return undefined;
}

function isApiKeyAuthError(detail: ErrorDetail) {
  const status = errorStatus(detail);
  if (status === 401 || status === 403) return true;
  const text = typeof detail === "string" ? detail : JSON.stringify(detail ?? "");
  return /api key|apikey|unauthorized|forbidden|invalid key|invalid api|无权限|认证|鉴权/i.test(text);
}

function modelValidationErrorMessage(detail: ErrorDetail) {
  return isApiKeyAuthError(detail)
    ? "API Key 错误或无权限，请检查后重试"
    : formatError(detail);
}

function formatError(detail: ErrorDetail) {
  if (!detail) return "未知错误";
  if (typeof detail === "string") return detail;
  if (detail instanceof Error) return detail.message;
  if (typeof detail !== "object") return String(detail);

  const record = detail as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.status === "number") parts.push(`HTTP ${record.status}`);

  const error = record.error;
  if (typeof error === "string") {
    parts.push(error);
  } else if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    if (typeof errorRecord.message === "string") parts.push(errorRecord.message);
    if (typeof errorRecord.type === "string") parts.push(errorRecord.type);
    if (typeof errorRecord.code === "string") parts.push(errorRecord.code);
  }

  if (parts.length > 0) return parts.join(" · ");
  try {
    return JSON.stringify(detail, null, 2).slice(0, 1200);
  } catch {
    return String(detail);
  }
}

type HistoryPage = {
  records: HistoryRecord[];
  nextCursor?: number;
  hasMore: boolean;
};

type PendingQueueItem = {
  job: Job;
  config: ApiConfig;
};

function historyRecordToJob(record: HistoryRecord): Job {
  return {
    id: record.id,
    requestId: record.requestId,
    batchId: record.batchId || record.id,
    index: record.index || 1,
    total: record.total || 1,
    protocol: record.protocol || DEFAULT_PROTOCOL,
    prompt: record.prompt,
    model: record.model,
    params: normalizeImageParams(record.params),
    referenceImages: normalizeStoredReferenceImages(record.referenceImages),
    submittedReferenceImages: record.submittedReferenceImages,
    status: record.status,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
    stages: record.stages,
    imageBlob: record.imageBlob,
    imageUrl: record.objectUrl,
    // 漏了这行会让主画廊对所有从 IndexedDB 读回的记录退回原图（缩略图只对本次会话生成的图生效）
    thumbUrl: record.thumbUrl,
    width: record.width,
    height: record.height,
    revisedPrompt: record.revisedPrompt,
    errorDetail: record.errorDetail,
    agentId: record.agentId,
    agentName: record.agentName,
    agentScenario: record.agentScenario,
    promptVariant: record.promptVariant,
  };
}

function sortGenerationRecords(records: Job[]) {
  return [...records].sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    if (a.index !== b.index) return a.index - b.index;
    return b.id.localeCompare(a.id);
  });
}

function sortHistoryRecords(records: HistoryRecord[]) {
  return [...records].sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return b.id.localeCompare(a.id);
  });
}

function generationStatusRank(status: JobStatus) {
  if (status === "submitting") return 0;
  if (status === "queued") return 1;
  if (status === "running") return 2;
  return 3;
}

function mergeHistoryRecords(current: HistoryRecord[], incoming: HistoryRecord[]) {
  const next = [...current];
  const positions = new Map(next.map((record, index) => [record.id, index]));
  incoming.forEach((record) => {
    const position = positions.get(record.id);
    if (position !== undefined) {
      const existing = next[position];
      if (generationStatusRank(record.status) < generationStatusRank(existing.status)) {
        if (record.objectUrl && record.objectUrl !== existing.objectUrl) URL.revokeObjectURL(record.objectUrl);
        if (record.thumbUrl && record.thumbUrl !== existing.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
        return;
      }
      if (existing.objectUrl && record.objectUrl && record.objectUrl !== existing.objectUrl) {
        URL.revokeObjectURL(existing.objectUrl);
      }
      if (existing.thumbUrl && record.thumbUrl && record.thumbUrl !== existing.thumbUrl) {
        URL.revokeObjectURL(existing.thumbUrl);
      }
      next[position] = {
        ...existing,
        ...record,
        objectUrl: record.objectUrl ?? existing.objectUrl,
        thumbUrl: record.thumbUrl ?? existing.thumbUrl,
      };
      return;
    }
    positions.set(record.id, next.length);
    next.push(record);
  });
  return sortHistoryRecords(next);
}

function mergeHistoricalJobs(current: Job[], incoming: Job[]) {
  const next = [...current];
  const positions = new Map(next.map((record, index) => [record.id, index]));
  incoming.forEach((record) => {
    const position = positions.get(record.id);
    if (position !== undefined) {
      const existing = next[position];
      if (generationStatusRank(record.status) < generationStatusRank(existing.status)) {
        if (record.imageUrl && record.imageUrl !== existing.imageUrl) URL.revokeObjectURL(record.imageUrl);
        if (record.thumbUrl && record.thumbUrl !== existing.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
        return;
      }
      if (existing.imageUrl && record.imageUrl && record.imageUrl !== existing.imageUrl) {
        URL.revokeObjectURL(existing.imageUrl);
      }
      if (existing.thumbUrl && record.thumbUrl && record.thumbUrl !== existing.thumbUrl) {
        URL.revokeObjectURL(existing.thumbUrl);
      }
      next[position] = {
        ...existing,
        ...record,
        imageUrl: record.imageUrl ?? existing.imageUrl,
        thumbUrl: record.thumbUrl ?? existing.thumbUrl,
      };
      return;
    }
    positions.set(record.id, next.length);
    next.push(record);
  });
  return sortGenerationRecords(next);
}


async function getHistoryRecordsPage({
  limit = HISTORY_PAGE_SIZE,
  beforeCreatedAt,
}: {
  limit?: number;
  beforeCreatedAt?: number;
} = {}): Promise<HistoryPage> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const toHistoryRecord = (record: StoredHistoryRecord): HistoryRecord => ({
      ...record,
      params: normalizeImageParams(record.params),
      referenceImages: normalizeStoredReferenceImages(record.referenceImages),
      objectUrl: record.imageBlob ? URL.createObjectURL(record.imageBlob) : undefined,
      thumbUrl: record.thumbBlob ? URL.createObjectURL(record.thumbBlob) : undefined,
    });
    const finish = (records: StoredHistoryRecord[]) => {
      const page = records.slice(0, limit).map(toHistoryRecord);
      resolve({
        records: page,
        nextCursor: page.at(-1)?.createdAt,
        hasMore: records.length > limit,
      });
    };

    if (!store.indexNames.contains("createdAt")) {
      const request = store.getAll();
      request.onsuccess = () => {
        const records = (request.result as StoredHistoryRecord[])
          .filter((record) => beforeCreatedAt === undefined || record.createdAt < beforeCreatedAt)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit + 1);
        finish(records);
      };
      request.onerror = () => reject(request.error);
      return;
    }

    const range = beforeCreatedAt === undefined ? null : IDBKeyRange.upperBound(beforeCreatedAt, true);
    const request = store.index("createdAt").openCursor(range, "prev");
    const records: StoredHistoryRecord[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= limit + 1) {
        finish(records);
        return;
      }
      records.push(cursor.value as StoredHistoryRecord);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveHistoryRecord(record: StoredHistoryRecord) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getRecentHistoryRecovery(since: number) {
  const db = await openDb();
  return new Promise<{
    requestIds: Set<string>;
    pendingRecords: StoredHistoryRecord[];
  }>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const requestIds = new Set<string>();
    const pendingRecords: StoredHistoryRecord[] = [];
    const collect = (record: StoredHistoryRecord) => {
      if (record.createdAt < since) return;
      if (record.requestId) requestIds.add(record.requestId);
      if (record.status === "submitting" || record.status === "queued" || record.status === "running") {
        pendingRecords.push(record);
      }
    };
    if (!store.indexNames.contains("createdAt")) {
      const request = store.getAll();
      request.onsuccess = () => {
        (request.result as StoredHistoryRecord[]).forEach(collect);
        resolve({ requestIds, pendingRecords });
      };
      request.onerror = () => reject(request.error);
      return;
    }
    const request = store.index("createdAt").openCursor(IDBKeyRange.lowerBound(since));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ requestIds, pendingRecords });
        return;
      }
      collect(cursor.value as StoredHistoryRecord);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function recoveredTaskRecord(task: ServerGenerationTask): StoredHistoryRecord {
  const outputFormat = task.params?.outputFormat;
  const promptVariant = task.promptVariant === "creative" || task.promptVariant === "commercial"
    ? task.promptVariant
    : task.promptVariant === "stable"
      ? "stable"
      : undefined;
  return {
    id: `server-${task.requestId}`,
    requestId: task.requestId,
    batchId: task.batchId || task.requestId,
    index: task.batchIndex || 1,
    total: task.batchTotal || 1,
    protocol: task.protocol || DEFAULT_PROTOCOL,
    prompt: task.prompt,
    model: task.model,
    params: normalizeImageParams({
      aspectRatio: task.params?.aspectRatio,
      size: task.params?.size,
      resolution: isImageResolution(task.params?.resolution) ? task.params.resolution : DEFAULT_IMAGE_RESOLUTION,
      quality: task.params?.quality,
      outputFormat: outputFormat === "jpeg" || outputFormat === "webp" ? outputFormat : "png",
      batchCount: task.batchTotal || 1,
      concurrency: 1,
      retryLimit: 0,
      seed: task.params?.seed || "",
      negativePrompt: task.negativePrompt || "",
    }),
    referenceImages: [],
    status: task.status === "queued" || task.status === "running" ? task.status : "submitting",
    createdAt: task.createdAt,
    startedAt: task.stages?.receivedAt || task.createdAt,
    durationMs: task.durationMs,
    stages: task.stages,
    agentId: task.agentId,
    agentName: task.agentName,
    agentScenario: task.agentScenario,
    promptVariant,
  };
}

function storedRecordForJob(
  job: Job,
  overrides: Partial<StoredHistoryRecord> = {},
): StoredHistoryRecord {
  return {
    id: job.id,
    requestId: job.requestId,
    batchId: job.batchId,
    index: job.index,
    total: job.total,
    protocol: job.protocol,
    prompt: job.prompt,
    model: job.model,
    params: job.params,
    referenceImages: referenceImagesForHistory(job.referenceImages),
    submittedReferenceImages: job.submittedReferenceImages,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    stages: job.stages,
    imageBlob: job.imageBlob,
    width: job.width,
    height: job.height,
    revisedPrompt: job.revisedPrompt,
    errorDetail: job.errorDetail,
    agentId: job.agentId,
    agentName: job.agentName,
    agentScenario: job.agentScenario,
    promptVariant: job.promptVariant,
    ...overrides,
  };
}

async function deleteHistoryRecord(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteFailedHistoryRecords() {
  const db = await openDb();
  return new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const deletedIds: string[] = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as StoredHistoryRecord;
      if (record.status === "error") {
        deletedIds.push(record.id);
        cursor.delete();
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(deletedIds);
    tx.onerror = () => reject(tx.error);
    request.onerror = () => reject(request.error);
  });
}

async function clearHistoryRecords() {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as StoredHistoryRecord;
      // 未终态任务的 requestId 是断线恢复凭据，“清空历史”不能把它一并删掉。
      if (record.status === "success" || record.status === "error") cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    request.onerror = () => reject(request.error);
  });
}







function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}


function createReferenceThumbnail(dataUrl: string, maxEdge = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = longestEdge > 0 ? Math.min(1, maxEdge / longestEdge) : 1;
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        reject(new Error("无法创建缩略图"));
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "medium";
      context.drawImage(image, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL("image/webp", 0.72));
      } catch {
        resolve(canvas.toDataURL("image/png"));
      }
    };
    image.onerror = () => reject(new Error("无法读取参考图缩略图"));
    image.src = dataUrl;
  });
}




async function fileToReference(file: File): Promise<UploadedReference> {
  const type = normalizeImageType(file);
  const baseReference = {
    id: uid(),
    name: file.name,
    type,
    size: file.size,
  };

  if (!type.startsWith("image/")) {
    return {
      ...baseReference,
      dataUrl: "",
      status: "error",
      message: "不是图片文件",
    };
  }

  let dataUrl = "";
  try {
    dataUrl = await readFileAsDataUrl(file);
  } catch {
    return {
      ...baseReference,
      dataUrl: "",
      status: "error",
      message: "读取失败",
    };
  }

  let dimensions: { width?: number; height?: number } = {};
  try {
    dimensions = await getImageSize(dataUrl);
  } catch {
    dimensions = {};
  }

  if (!SUPPORTED_REFERENCE_TYPES.has(type)) {
    return {
      ...baseReference,
      ...dimensions,
      dataUrl,
      status: "error",
      message: `暂不支持 ${formatReferenceType(type)}`,
    };
  }

  if (file.size > MAX_REFERENCE_SIZE) {
    return {
      ...baseReference,
      ...dimensions,
      dataUrl,
      status: "error",
      message: `超过 ${formatBytes(MAX_REFERENCE_SIZE)}`,
    };
  }

  if (!dimensions.width || !dimensions.height) {
    return {
      ...baseReference,
      dataUrl,
      status: "error",
      message: "无法读取尺寸",
    };
  }

  let thumbnailDataUrl = dataUrl;
  try {
    thumbnailDataUrl = await createReferenceThumbnail(dataUrl);
  } catch {
    thumbnailDataUrl = dataUrl;
  }

  const shortestEdge = Math.min(dimensions.width, dimensions.height);
  const longestEdge = Math.max(dimensions.width, dimensions.height);
  if (shortestEdge < MIN_REFERENCE_EDGE) {
    return {
      ...baseReference,
      ...dimensions,
      dataUrl,
      thumbnailDataUrl,
      status: "error",
      message: `短边小于 ${MIN_REFERENCE_EDGE}px`,
    };
  }

  if (longestEdge > LARGE_REFERENCE_EDGE) {
    return {
      ...baseReference,
      ...dimensions,
      dataUrl,
      thumbnailDataUrl,
      status: "warning",
      message: "尺寸较大",
    };
  }

  return {
    ...baseReference,
    ...dimensions,
    dataUrl,
    thumbnailDataUrl,
    status: "ready",
    message: "可用",
  };
}



function describeFullImageError(error: unknown): { title: string; hint: string; canRetry: boolean } {
  const reason = error instanceof FullImageError ? error.reason : "network";
  if (reason === "purged") {
    return {
      title: "原图已被服务器清理",
      hint: "请求日志超过 5000 条时会自动清理最早的图片文件。",
      canRetry: false,
    };
  }
  if (reason === "lost") {
    return {
      title: "本地图片数据已丢失",
      hint: "可能是浏览器清理了存储空间。",
      canRetry: true,
    };
  }
  const status = error instanceof FullImageError ? error.status : undefined;
  return {
    title: status ? `原图加载失败（HTTP ${status}）` : "原图加载失败",
    hint: "可能是网络问题或服务暂时不可用。",
    canRetry: true,
  };
}



function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

const zipTextEncoder = new TextEncoder();
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(value = Date.now()) {
  const date = new Date(value);
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = Math.max(1, date.getDate());
  const month = date.getMonth() + 1;
  const year = Math.max(1980, date.getFullYear()) - 1980;
  return { date: (year << 9) | (month << 5) | day, time };
}

async function createZipBlob(files: Array<{ name: string; blob: Blob; date?: number }>) {
  const fileParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let centralSize = 0;
  let offset = 0;

  for (const file of files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const nameBytes = zipTextEncoder.encode(file.name);
    const checksum = crc32(bytes);
    const { date, time } = dosDateTime(file.date);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    const byteCopy = new Uint8Array(bytes.byteLength);
    byteCopy.set(bytes);
    fileParts.push(localHeader.buffer, byteCopy.buffer);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader.buffer);
    centralSize += centralHeader.byteLength;

    offset += localHeader.length + bytes.length;
  }

  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...fileParts, ...centralParts, endHeader.buffer], { type: "application/zip" });
}

function serializeError(detail: ErrorDetail) {
  try {
    return JSON.stringify(sanitizeClientLogValue(detail), null, 2);
  } catch {
    return String(detail);
  }
}

async function fetchFrontendBuildVersion(signal?: AbortSignal) {
  const response = await fetch(`/build-version.json?t=${Date.now()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`版本检查失败：HTTP ${response.status}`);
  const payload = await response.json() as { version?: unknown };
  return typeof payload.version === "string" ? payload.version : "";
}

function reloadWithFrontendVersion(version: string) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("app_v", version);
  window.location.assign(nextUrl.toString());
}

function loadBooleanSetting(key: string, fallback: boolean) {
  const raw = localStorage.getItem(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}


function describeReferenceForLog(summary: ReferenceSummary, model: string) {
  if (summary.status === "none") return `模型 ${model}，无参考图。`;
  if (summary.status === "skipped_unsupported") {
    return `模型 ${model}，用户上传 ${summary.count} 张参考图，但${summary.unsupportedReason || "当前协议不支持参考图"}，已跳过。`;
  }
  const sizeLabel = summary.totalBytes > 0 ? `（压缩后 ${formatBytes(summary.totalBytes)}）` : "";
  if (summary.status === "prepared") return `模型 ${model}，参考图 ${summary.count} 张${sizeLabel}已准备发送。`;
  if (summary.status === "sent_ok") return `模型 ${model}，参考图 ${summary.count} 张${sizeLabel}已上传到上游。`;
  if (summary.status === "sent_failed") return `模型 ${model}，参考图 ${summary.count} 张${sizeLabel}发送失败。`;
  return `模型 ${model}，参考图 ${summary.count} 张${sizeLabel}。`;
}

function clientImageOmittedPlaceholder(value: string) {
  const match = value.match(/^data:([^;]+);base64,(.*)$/);
  const mime = match?.[1] || "application/octet-stream";
  const base64Body = match?.[2] ?? value;
  const cleaned = base64Body.replace(/\s+/g, "");
  const bytes = Math.round((cleaned.length * 3) / 4);
  return {
    __omitted: "image" as const,
    mime,
    bytes,
  };
}

function sanitizeClientLogValue(value: unknown, key = "", depth = 0): unknown {
  const lowerKey = key.toLowerCase();
  if (depth > 8) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (lowerKey === "apikey" || lowerKey === "api_key" || lowerKey === "authorization" || lowerKey === "password" || lowerKey === "token") {
    return "[redacted]";
  }
  if (typeof value === "string") {
    if (
      value.startsWith("data:image/")
      || lowerKey === "dataurl"
      || lowerKey === "thumbnaildataurl"
      || lowerKey === "b64_json"
      || (lowerKey === "data" && value.length > 180 && /^[A-Za-z0-9+/=\r\n]+$/.test(value))
    ) {
      return clientImageOmittedPlaceholder(value);
    }
    return truncateForLog(value, 4000);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizeClientLogValue(item, key, depth + 1));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeClientLogValue(entryValue, entryKey, depth + 1),
      ]),
    );
  }
  return String(value);
}

function safeLogError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (!error || typeof error !== "object") return error;
  try {
    return sanitizeClientLogValue(JSON.parse(JSON.stringify(error)));
  } catch {
    return String(error);
  }
}

function isRetryableError(errorDetail: unknown): boolean {
  if (!errorDetail) return true;
  if (typeof errorDetail !== "object") return false;
  const record = errorDetail as Record<string, unknown>;
  const status = typeof record.status === "number"
    ? record.status
    : typeof record.httpStatus === "number"
      ? record.httpStatus
      : null;
  if (status !== null) {
    if (status >= 500 && status < 600) return true;
    if (status === 429) return true;
    return false;
  }
  const errorField = record.error;
  let messageRaw = "";
  if (errorField && typeof errorField === "object") {
    const inner = (errorField as Record<string, unknown>).message;
    if (typeof inner === "string") messageRaw = inner;
  } else if (typeof errorField === "string") {
    messageRaw = errorField;
  } else if (typeof record.errorMessage === "string") {
    messageRaw = record.errorMessage;
  }
  return /timeout|network|connection|abort|fetch failed|failed to fetch|load failed|econnreset|etimedout|enotfound/.test(messageRaw.toLowerCase());
}


function maskApiKeyForLog(apiKey: string, _rememberKey: boolean) {
  const trimmed = apiKey.trim();
  return {
    present: trimmed.length > 0,
    length: trimmed.length,
    // 只留前缀，且短 Key 一律不回显：诊断文件是用户会直接发给客服的，
    // 前缀+后缀+精确长度合起来足以显著缩小暴力猜测空间。
    // 也不再输出 source（Key 存在哪个 storage）——那等于附赠一份取用说明。
    prefix: trimmed.length >= API_KEY_MASK_MIN_LENGTH ? trimmed.slice(0, 4) : "",
  };
}

function referenceMetaForLog(images: UploadedReference[]) {
  return images.map((image) => ({
    id: image.id,
    name: image.name,
    type: image.type,
    size: image.size,
    width: image.width,
    height: image.height,
    status: image.status || "ready",
    hasDataUrl: Boolean(image.dataUrl),
  }));
}

function loadLocalLogs(): LocalLogEntry[] {
  const raw = localStorage.getItem(LOCAL_LOG_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, LOCAL_LOG_LIMIT) as LocalLogEntry[] : [];
  } catch {
    return [];
  }
}

function saveLocalLogs(logs: LocalLogEntry[]) {
  try {
    localStorage.setItem(LOCAL_LOG_STORAGE_KEY, JSON.stringify(logs.slice(0, LOCAL_LOG_LIMIT)));
  } catch {
    // Local request logs are diagnostic only. Ignore quota failures.
  }
}

function loadInitialApiConfig(): ApiConfig {
  const rememberKey = localStorage.getItem("imageStudioRememberKey") === "true";
  const storedProtocol = localStorage.getItem("imageStudioProtocol");
  const protocol = isImageProtocol(storedProtocol) ? storedProtocol : DEFAULT_PROTOCOL;
  return {
    protocol,
    baseUrl: normalizeApiBaseUrl(localStorage.getItem("imageStudioBaseUrl")),
    apiKey: rememberKey
      ? localStorage.getItem("imageStudioApiKey") || ""
      : sessionStorage.getItem("imageStudioApiKey") || "",
    rememberKey,
  };
}

function loadInitialParams(): ImageParams {
  const raw = localStorage.getItem("imageStudioParams");
  if (!raw) {
    return normalizeImageParams({
      aspectRatio: "1:1",
      resolution: DEFAULT_IMAGE_RESOLUTION,
      quality: "auto",
      outputFormat: "png",
      batchCount: 4,
      concurrency: 2,
      seed: "",
      negativePrompt: "",
    });
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ImageParams>;
    return normalizeImageParams(parsed);
  } catch {
    return normalizeImageParams({
      aspectRatio: "1:1",
      resolution: DEFAULT_IMAGE_RESOLUTION,
      quality: "auto",
      outputFormat: "png",
      batchCount: 4,
      concurrency: 2,
      seed: "",
      negativePrompt: "",
    });
  }
}

function isAllowedImageModel(model: string) {
  const configured = runtimeModelIds();
  if (configured.size > 0) {
    return configured.has(model.replace(/^models\//, "").trim().toLowerCase());
  }
  return isGptImage2Model(model) || isGemini3ProImageModel(model);
}

function imageModelPriority(model: string) {
  const normalized = normalizedImageModelId(model);
  if (runtimeModelConfig.length > 0) {
    const index = runtimeModelConfig.findIndex((m) => m.id.replace(/^models\//, "").trim().toLowerCase() === normalized);
    return index >= 0 ? index : 100;
  }
  if (normalized === GPT_IMAGE_2_MODEL) return 0;
  if (normalized === GPT_IMAGE_2_PRO_MODEL) return 1;
  if (normalized === GPT_IMAGE_2_FAMILY_MODEL) return 2;
  if (normalized === GEMINI_3_PRO_IMAGE_MODEL) return 3;
  return 10;
}

function filterAllowedImageModels(models: string[]) {
  return [...new Set(models)]
    .filter(isAllowedImageModel)
    .sort((a, b) => {
      const priority = imageModelPriority(a) - imageModelPriority(b);
      return priority || a.localeCompare(b);
    });
}

function preferModel(models: string[], current: string) {
  const allowedModels = filterAllowedImageModels(models);
  if (current && allowedModels.includes(current) && isAllowedImageModel(current)) return current;
  return (
    allowedModels.find((model) => normalizedImageModelId(model) === GPT_IMAGE_2_MODEL) ||
    allowedModels.find((model) => normalizedImageModelId(model) === GPT_IMAGE_2_FAMILY_MODEL) ||
    allowedModels.find((model) => normalizedImageModelId(model) === GEMINI_3_PRO_IMAGE_MODEL) ||
    allowedModels[0] ||
    ""
  );
}

// 只取上游真实返回、且在白名单内、且与当前协议匹配的生图模型。
// 这是「用户这把 Key 到底能不能生图」的唯一判据。
function upstreamImageModels(protocol: ImageProtocol, upstreamModels: string[] = []) {
  return filterAllowedImageModels(upstreamModels)
    .filter((model) => protocolMatchesImageModel(protocol, model));
}

// 含协议默认模型的列表，仅用于「尚未验证 Key」时的界面预览。
// 注意：绝不能拿它当作可生成的依据——默认模型是本地常量，
// 用户的 Key 未必有权限，混进去会让按钮可点、点了却在上游失败。
function imageModelsForProtocol(protocol: ImageProtocol, upstreamModels: string[] = []) {
  return filterAllowedImageModels([
    ...upstreamModels,
    ...getProtocolDefinition(protocol).defaultModels,
  ]).filter((model) => protocolMatchesImageModel(protocol, model));
}

function normalizedModelId(model: string) {
  return model.replace(/^models\//, "").trim().toLowerCase();
}

function isAnalysisModel(model: string) {
  const normalized = normalizedModelId(model);
  return normalized.includes("gpt") && !normalized.includes("image");
}

function analysisModelPriority(model: string) {
  const normalized = normalizedModelId(model);
  if (normalized === "gpt-5.4") return 0;
  if (normalized.includes("gpt-5.4")) return 1;
  if (normalized === "gpt-5.5") return 2;
  if (normalized.includes("gpt-5.5")) return 3;
  if (normalized === "gpt-5.2") return 4;
  if (normalized.includes("gpt-5.2")) return 5;
  if (normalized.includes("gpt-5")) return 6;
  if (normalized.includes("gpt-4.1")) return 7;
  if (normalized.includes("gpt-4")) return 8;
  return 20;
}

function filterAnalysisModels(models: string[]) {
  return [...new Set(models)]
    .filter(isAnalysisModel)
    .sort((a, b) => {
      const priority = analysisModelPriority(a) - analysisModelPriority(b);
      return priority || a.localeCompare(b);
    });
}

function preferAnalysisModel(models: string[], current: string) {
  if (current && models.includes(current)) return current;
  return models[0] || "";
}

function analysisModeLabel(mode: AnalysisMode) {
  if (mode === "optimize") return "提示词优化";
  if (mode === "params") return "参数推荐";
  if (mode === "risk") return "失败预判";
  if (mode === "style") return "风格增强";
  return "发送前检查";
}

function riskScore(level: RiskLevel) {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function getOverallRiskLevel(risks: PromptRisk[]): RiskLevel {
  if (risks.some((risk) => risk.level === "high")) return "high";
  if (risks.some((risk) => risk.level === "medium")) return "medium";
  return "low";
}

function recommendAspectRatioForPrompt(promptText: string, currentAspectRatio: string) {
  const text = promptText.toLowerCase();
  if (/头像|avatar|portrait|肖像|近景人像|商品主图/.test(text)) return "1:1";
  if (/小红书|封面|海报|竖版|手机|story|reels|tiktok|shorts/.test(text)) return "3:4";
  if (/壁纸|短视频|9:16|竖屏|全身/.test(text)) return "9:16";
  if (/banner|横幅|头图|网页|视频封面|宽屏|youtube|16:9/.test(text)) return "16:9";
  if (/建筑|蓝图|住宅|室内|空间|剖面/.test(text)) return "4:3";
  if (/信息图|知识卡片|公众号|长图|排版/.test(text)) return "4:5";
  return currentAspectRatio;
}

function pickStyleEnhancements(promptText: string, mode: AnalysisMode) {
  const text = promptText.toLowerCase();
  const matched = runtimeStylePresets.filter((preset) => {
    if (/电影|海报|故事|场景|氛围/.test(text) && preset.name === "电影感") return true;
    if (/商品|产品|人像|写真|摄影|头像/.test(text) && preset.name === "商业摄影") return true;
    if (/小红书|封面|公众号|社媒|标题/.test(text) && preset.name === "社媒封面") return true;
    if (/信息图|结构|图解|文字|知识/.test(text) && preset.name === "极简信息图") return true;
    if (/水墨|国风|东方|禅|龙/.test(text) && preset.name === "东方水墨") return true;
    if (/手办|玩具|公仔|chibi|q版|3d/.test(text) && preset.name === "3D 手办") return true;
    return false;
  });
  const base = matched.length > 0 ? matched : STYLE_ENHANCEMENT_PRESETS.slice(0, mode === "style" ? 4 : 2);
  return base.slice(0, 4);
}

function createOptimizedPrompt(promptText: string, mode: AnalysisMode) {
  const trimmed = promptText.trim();
  if (!trimmed) return "";
  const styleFragments = pickStyleEnhancements(trimmed, mode).slice(0, mode === "style" ? 2 : 1).map((item) => item.promptFragment);
  const structure = [
    trimmed,
    "主体清晰，构图干净，画面重点明确。",
    "补充镜头语言、光影方向、材质细节、背景层次和最终用途。",
    ...styleFragments,
  ];
  return [...new Set(structure)].join("\n");
}

function buildLocalPromptAnalysis({
  promptText,
  params,
  protocol,
  selectedModel,
  referenceImages,
  usableReferenceImages,
  mode,
}: {
  promptText: string;
  params: ImageParams;
  protocol: ImageProtocol;
  selectedModel: string;
  referenceImages: UploadedReference[];
  usableReferenceImages: UploadedReference[];
  mode: AnalysisMode;
}): PromptAnalysisResult {
  const trimmed = promptText.trim();
  const risks: PromptRisk[] = [];
  const definition = getProtocolDefinition(protocol);

  if (trimmed.length < 10) {
    risks.push({
      level: "medium",
      title: "提示词偏短",
      description: "主体、场景、光影和用途不够明确，结果随机性会更高。",
      fix: "补充主体、环境、风格、镜头和用途。",
    });
  }
  if (trimmed.length > 2800) {
    risks.push({
      level: "medium",
      title: "提示词过长",
      description: "过长的提示词容易稀释重点，也可能触发接口长度限制。",
      fix: "压缩为主体、风格、构图、约束四段。",
    });
  }
  if (/100%|完全一致|一模一样|高度一致|same face|identical/i.test(trimmed) && usableReferenceImages.length === 0) {
    risks.push({
      level: "high",
      title: "缺少参考图",
      description: "提示词要求高度一致，但当前没有可用参考图，生成结果很难稳定符合。",
      fix: "上传清晰参考图，或降低“一致性”要求。",
    });
  }
  if (/文字|标题|排版|字体|logo|标语|slogan|海报/i.test(trimmed)) {
    risks.push({
      level: "low",
      title: "文字渲染存在不确定性",
      description: "图片模型对精准文字仍可能出错，建议减少文字数量并强调可读性。",
      fix: "把文字控制在 1-2 个短句，后期可用设计工具补字。",
    });
  }
  if (referenceImages.some((image) => image.status === "error")) {
    risks.push({
      level: "high",
      title: "参考图不可用",
      description: "存在格式、尺寸或读取失败的参考图，发送时会被过滤。",
      fix: "移除失败参考图，重新上传 PNG、JPEG 或 WebP。",
    });
  }
  if (referenceImages.some((image) => image.status === "warning")) {
    risks.push({
      level: "medium",
      title: "参考图尺寸较大",
      description: "大图可能增加请求体积和等待时间。",
      fix: "优先压缩到 4096px 以下再上传。",
    });
  }
  if (referenceImages.length > 0 && !definition.supportsReferenceImages) {
    risks.push({
      level: "medium",
      title: "当前协议不发送参考图",
      description: `${definition.shortLabel} 暂不支持参考图，本次生成会按纯文本执行。`,
      fix: "切换到兼容协议或 Gemini Native。",
    });
  }
  const analysisResolution = normalizeResolutionForRequest(
    safeImageResolution(params.resolution),
    protocol,
    selectedModel,
  );
  if (!isAspectRatioSupported(protocol, params.aspectRatio, selectedModel, analysisResolution)) {
    risks.push({
      level: "high",
      title: "宽高比不兼容",
      description: "当前协议不支持所选宽高比，请换成协议支持的比例。",
      fix: "应用系统推荐比例。",
    });
  }
  if (params.batchCount > 8 && params.concurrency > 3) {
    risks.push({
      level: "low",
      title: "批量并发较高",
      description: "大批量高并发可能遇到限流，排队等待时间也会更长。",
      fix: "建议并发保持 2-3。",
    });
  }

  const suggestedAspectRatio = recommendAspectRatioForPrompt(trimmed, params.aspectRatio);
  const fallbackAspectRatio = getSupportedAspectRatios(protocol, selectedModel, analysisResolution)[0] || "1:1";
  const nextSuggestedAspectRatio = isAspectRatioSupported(protocol, suggestedAspectRatio, selectedModel, analysisResolution)
    ? suggestedAspectRatio
    : fallbackAspectRatio;
  const suggestedParams: SuggestedParams = {
    aspectRatio: nextSuggestedAspectRatio,
    size: resolveRequestSize(
      nextSuggestedAspectRatio,
      analysisResolution,
      protocol,
      selectedModel,
      params.size,
    ),
    resolution: normalizeResolutionForRequest(
      safeImageResolution(params.resolution),
      protocol,
      selectedModel,
    ),
    count: /海报|封面|logo|文字|信息图/.test(trimmed) ? 2 : Math.min(Math.max(params.batchCount, 2), 4),
    quality: selectedModel ? params.quality : "auto",
    styleStrength: mode === "style" ? "high" : "medium",
    referenceWeight: usableReferenceImages.length > 0 ? "medium" : "low",
  };
  const riskLevel = getOverallRiskLevel(risks);
  const score = clampNumber(94 - risks.reduce((sum, risk) => sum + riskScore(risk.level) * 10, 0), 35, 98);
  const styleEnhancements = pickStyleEnhancements(trimmed, mode);
  return {
    safe: riskLevel !== "high",
    score,
    riskLevel,
    summary: riskLevel === "low"
      ? "提示词可以直接生成，建议可作为增强参考。"
      : riskLevel === "medium"
        ? "可以生成，但有几处会影响稳定性和效果。"
        : "存在较高失败或偏离风险，建议先修复再生成。",
    optimizedPrompt: createOptimizedPrompt(trimmed, mode),
    suggestedNegativePrompt: params.negativePrompt || "低清晰度，畸形结构，错误文字，重复肢体，低质量，过度锐化",
    suggestedParams,
    risks,
    styleEnhancements,
    source: "local",
  };
}

function safeRiskLevel(value: unknown): RiskLevel {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizePromptRisk(value: unknown): PromptRisk | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const description = typeof record.description === "string" ? record.description : "";
  if (!title && !description) return null;
  return {
    level: safeRiskLevel(record.level),
    title: title || "生成风险",
    description: description || "需要进一步检查。",
    fix: typeof record.fix === "string" ? record.fix : undefined,
  };
}

function normalizeStyleEnhancement(value: unknown): StyleEnhancement | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const description = typeof record.description === "string" ? record.description : "";
  const promptFragment = typeof record.promptFragment === "string" ? record.promptFragment : "";
  if (!name || !promptFragment) return null;
  return { name, description, promptFragment };
}

function normalizeSuggestedParams(value: unknown, fallback: SuggestedParams): SuggestedParams {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    aspectRatio: typeof record.aspectRatio === "string" ? record.aspectRatio : fallback.aspectRatio,
    size: typeof record.size === "string" ? record.size : fallback.size,
    resolution: isImageResolution(record.resolution) ? record.resolution : fallback.resolution,
    count: typeof record.count === "number" ? record.count : fallback.count,
    quality: typeof record.quality === "string" ? record.quality : fallback.quality,
    styleStrength: record.styleStrength === "low" || record.styleStrength === "medium" || record.styleStrength === "high"
      ? record.styleStrength
      : fallback.styleStrength,
    referenceWeight: record.referenceWeight === "low" || record.referenceWeight === "medium" || record.referenceWeight === "high"
      ? record.referenceWeight
      : fallback.referenceWeight,
  };
}

function normalizePromptAnalysisResult(value: unknown, fallback: PromptAnalysisResult): PromptAnalysisResult {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const risks = Array.isArray(record.risks)
    ? record.risks.map(normalizePromptRisk).filter((item): item is PromptRisk => Boolean(item))
    : fallback.risks;
  const styleEnhancements = Array.isArray(record.styleEnhancements)
    ? record.styleEnhancements.map(normalizeStyleEnhancement).filter((item): item is StyleEnhancement => Boolean(item))
    : fallback.styleEnhancements;
  const riskLevel = safeRiskLevel(record.riskLevel || getOverallRiskLevel(risks));
  return {
    safe: typeof record.safe === "boolean" ? record.safe : riskLevel !== "high",
    score: typeof record.score === "number" ? clampNumber(record.score, 0, 100) : fallback.score,
    riskLevel,
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary : fallback.summary,
    optimizedPrompt: typeof record.optimizedPrompt === "string" && record.optimizedPrompt.trim()
      ? record.optimizedPrompt
      : fallback.optimizedPrompt,
    suggestedNegativePrompt: typeof record.suggestedNegativePrompt === "string"
      ? record.suggestedNegativePrompt
      : fallback.suggestedNegativePrompt,
    suggestedParams: normalizeSuggestedParams(record.suggestedParams, fallback.suggestedParams),
    risks,
    styleEnhancements: styleEnhancements.length > 0 ? styleEnhancements : fallback.styleEnhancements,
    analysisModel: typeof record.analysisModel === "string" ? record.analysisModel : fallback.analysisModel,
    source: record.source === "ai" || record.source === "local" ? record.source : fallback.source,
  };
}

function safeAgentModeIntentType(value: unknown): AgentModeIntentType {
  return value === "single_image"
    || value === "multi_image_batch"
    || value === "brochure_project"
    || value === "page_refine"
    || value === "unknown"
    ? value
    : "unknown";
}

function safeAgentModeCostLevel(value: unknown): AgentModeCostLevel {
  return value === "low" || value === "medium" || value === "high" ? value : "low";
}

function normalizeAgentModeJobSpec(value: unknown, index: number): AgentModeJobSpec | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : `任务 ${index + 1}`;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt) return null;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : `agent-job-${index + 1}`,
    title,
    prompt,
    objective: typeof record.objective === "string" ? record.objective.trim() : "",
    negativePrompt: typeof record.negativePrompt === "string" ? record.negativePrompt.trim() : "",
    aspectRatio: typeof record.aspectRatio === "string" ? record.aspectRatio.trim() : "",
    size: typeof record.size === "string" ? record.size.trim() : "",
    resolution: isImageResolution(record.resolution) ? record.resolution : undefined,
    quality: typeof record.quality === "string" ? record.quality.trim() : "",
    count: typeof record.count === "number" ? clampNumber(record.count, 1, 8) : 1,
  };
}

function normalizeAgentModeBrochurePage(value: unknown, index: number): AgentModeBrochurePage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : `第 ${index + 1} 页`;
  return {
    pageNo: typeof record.pageNo === "number" ? clampNumber(record.pageNo, 1, 64) : index + 1,
    role: typeof record.role === "string" && record.role.trim() ? record.role.trim() : "content",
    title,
    objective: typeof record.objective === "string" && record.objective.trim()
      ? record.objective.trim()
      : `${title} 页面主视觉`,
  };
}

function normalizeAgentModeBrochureProject(value: unknown, promptText: string): AgentModeBrochureProject | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : "宣传画册项目";
  const outline = Array.isArray(record.outline)
    ? record.outline
      .map(normalizeAgentModeBrochurePage)
      .filter(Boolean) as AgentModeBrochurePage[]
    : [];
  const styleDirections = Array.isArray(record.styleDirections)
    ? record.styleDirections
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 6)
    : [];
  return {
    title,
    companyName: typeof record.companyName === "string" ? record.companyName.trim() : "",
    industry: typeof record.industry === "string" ? record.industry.trim() : "",
    purpose: typeof record.purpose === "string" ? record.purpose.trim() : "",
    pageCount: typeof record.pageCount === "number" ? clampNumber(record.pageCount, 4, 32) : Math.max(outline.length, 4),
    summary: typeof record.summary === "string" && record.summary.trim()
      ? record.summary.trim()
      : "已识别为宣传画册任务，建议先选择整本模板方向，再展开单页生成。",
    outline,
    styleDirections,
    requestPrompt: promptText,
  };
}

function normalizeAgentModeAnalysisResult(value: unknown, promptText: string): AgentModeAnalysisResult {
  const fallback: AgentModeAnalysisResult = {
    intentType: "single_image",
    confidence: 0.6,
    reasoningSummary: "未拿到完整解析结果，已按单图任务处理。",
    estimatedCostLevel: "low",
    requiresConfirmation: false,
    autoExecute: true,
    jobs: [{
      id: "agent-job-1",
      title: "图片生成",
      prompt: promptText.trim(),
      count: 1,
    }],
    source: "local",
  };
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const jobs = Array.isArray(record.jobs)
    ? record.jobs
      .map(normalizeAgentModeJobSpec)
      .filter(Boolean) as AgentModeJobSpec[]
    : [];
  const brochureProject = normalizeAgentModeBrochureProject(record.brochureProject, promptText);
  const intentType = safeAgentModeIntentType(record.intentType);
  return {
    intentType,
    confidence: typeof record.confidence === "number" ? clampNumber(record.confidence, 0, 1) : fallback.confidence,
    reasoningSummary: typeof record.reasoningSummary === "string" && record.reasoningSummary.trim()
      ? record.reasoningSummary.trim()
      : fallback.reasoningSummary,
    estimatedCostLevel: safeAgentModeCostLevel(record.estimatedCostLevel),
    requiresConfirmation: typeof record.requiresConfirmation === "boolean"
      ? record.requiresConfirmation
      : intentType !== "single_image",
    autoExecute: typeof record.autoExecute === "boolean"
      ? record.autoExecute
      : intentType === "single_image" && jobs.length > 0,
    jobs: jobs.length > 0 ? jobs : fallback.jobs,
    brochureProject,
    analysisModel: typeof record.analysisModel === "string" ? record.analysisModel : undefined,
    source: record.source === "ai" || record.source === "local" ? record.source : fallback.source,
  };
}

function createJob(
  index: number,
  total: number,
  batchId: string,
  protocol: ImageProtocol,
  prompt: string,
  model: string,
  params: ImageParams,
  referenceImages: UploadedReference[],
  createdAt = Date.now(),
  agentContext?: AgentContext,
): Job {
  return {
    id: uid(),
    // 用户点击时即分配 requestId；后续前端排队、落盘、POST、对账都沿用这一 ID。
    requestId: uid(),
    batchId,
    index,
    total,
    protocol,
    prompt,
    model,
    params: { ...params },
    referenceImages: [...referenceImages],
    status: "queued",
    createdAt,
    agentId: agentContext?.plan.agentId,
    agentName: agentContext?.plan.agentName,
    agentScenario: agentContext?.plan.scenario,
    promptVariant: agentContext?.variant,
    attempt: 1,
    maxAttempts: 1 + clampNumber(Number(params.retryLimit ?? 2), 0, 5),
  };
}

export default function App() {
  const [apiConfig, setApiConfig] = useState<ApiConfig>(loadInitialApiConfig);
  const [params, setParams] = useState<ImageParams>(loadInitialParams);
  const [prompt, setPrompt] = useState("");
  const [homePrompt, setHomePrompt] = useState("");
  // 首页提交后落进 studio 的待办（时间戳 + 提示词快照），等 canRequestGenerate 就绪后自动发车
  const homeSubmitPendingRef = useRef<{ at: number; prompt: string } | null>(null);
  // 工作台记录 → 画布的待导入载荷；画布挂载并加载完成后消费一次即清空
  const [canvasImport, setCanvasImport] = useState<CanvasImportPayload | null>(null);
  // 推荐到广场时隐藏提示词（roadmap PRD B1，本机偏好）
  const [hidePromptOnShare, setHidePromptOnShare] = useState(() => {
    try { return localStorage.getItem("imageStudioHidePromptOnShare") === "true"; } catch { return false; }
  });
  // 配方快照 + 参考图库（roadmap PRD B2/B3，本机 IndexedDB）
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [referenceLibrary, setReferenceLibrary] = useState<ReferenceLibraryItem[]>([]);
  const [isRefLibraryOpen, setIsRefLibraryOpen] = useState(false);
  // 需求反馈弹窗（2026-07-27）
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  // 侧栏历史筛选（roadmap PRD B4）
  const [sidebarFilterStatus, setSidebarFilterStatus] = useState<"all" | "success" | "error">("all");
  const [sidebarSearch, setSidebarSearch] = useState("");

  useEffect(() => {
    void refreshRecipes();
    void refreshReferenceLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 跨页轻提示（任务完成、未知链接等），4 秒自动消失
  const [appNotice, setAppNotice] = useState("");
  const appNoticeTimerRef = useRef(0);
  function showAppNotice(message: string) {
    setAppNotice(message);
    window.clearTimeout(appNoticeTimerRef.current);
    appNoticeTimerRef.current = window.setTimeout(() => setAppNotice(""), 4000);
  }
  // 人在别的页面时任务全部跑完 → 提醒一句（roadmap PRD N2 跨页任务感知）。
  // 只在「有→无」的沿上触发一次，studio 页内已有自己的完成反馈，不重复打扰。
  const prevActiveJobsRef = useRef(0);
  const [activePage, setActivePage] = useState<AppPage>(pageFromHash);
  const [configVersion, setConfigVersion] = useState(0);
  const [modelStats, setModelStats] = useState<Record<string, ModelStat>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 1 | -1>>({});
  const [referenceImages, setReferenceImages] = useState<UploadedReference[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [analysisModels, setAnalysisModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => {
    const storedModel = localStorage.getItem("imageStudioSelectedModel") || "";
    return isAllowedImageModel(storedModel) ? storedModel : "";
  });
  const [selectedAnalysisModel, setSelectedAnalysisModel] = useState(() =>
    localStorage.getItem("imageStudioSelectedAnalysisModel") || "",
  );
  const [modelFilter, setModelFilter] = useState("");
  const [modelState, setModelState] = useState<ModelLoadState>({
    status: "idle",
    message: "未读取",
  });
  const [verifiedModelKey, setVerifiedModelKey] = useState("");
  const [verifiedModelAt, setVerifiedModelAt] = useState(0);
  const [visibleRecords, setVisibleRecords] = useState<Job[]>([]);
  const [sidebarRecords, setSidebarRecords] = useState<HistoryRecord[]>([]);
  const filteredSidebarRecords = useMemo(() => {
    const query = sidebarSearch.trim().toLowerCase();
    return sidebarRecords.filter((record) => {
      if (sidebarFilterStatus === "success" && record.status !== "success") return false;
      if (sidebarFilterStatus === "error" && record.status !== "error") return false;
      if (query && !record.prompt.toLowerCase().includes(query) && !record.model.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [sidebarRecords, sidebarFilterStatus, sidebarSearch]);
  const [highlightedRecordId, setHighlightedRecordId] = useState<string>("");
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null);
  const [squareRecommendState, setSquareRecommendState] = useState<Record<string, SquareRecommendStatus>>({});
  const [isLoadingMainRecords, setIsLoadingMainRecords] = useState(false);
  const [isLoadingSidebarRecords, setIsLoadingSidebarRecords] = useState(false);
  const [hasMoreMainRecords, setHasMoreMainRecords] = useState(true);
  const [hasMoreSidebarRecords, setHasMoreSidebarRecords] = useState(true);
  const [queueStats, setQueueStats] = useState({ running: 0, queued: 0 });
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(() =>
    loadBooleanSetting("imageStudioLeftSidebarOpen", window.innerWidth > 780),
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(() =>
    loadBooleanSetting("imageStudioSettingsOpen", window.innerWidth > 1180),
  );
  const [isAutoPromptAnalysisEnabled, setIsAutoPromptAnalysisEnabled] = useState(() =>
    loadBooleanSetting("imageStudioAutoPromptAnalysisEnabled", true),
  );
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(() => new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() =>
    localStorage.getItem("imageStudioOnboardingComplete") !== "true",
  );
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [isAutoLoadingModels, setIsAutoLoadingModels] = useState(false);
  const [showPromptPresets, setShowPromptPresets] = useState(false);
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
  const [isAgentHintSeen, setIsAgentHintSeen] = useState(() =>
    localStorage.getItem("imageStudioAgentHintSeen") === "true",
  );
  const [isAgentHintVisible, setIsAgentHintVisible] = useState(false);
  const [isAgentQuickbarExpanded, setIsAgentQuickbarExpanded] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [agentValues, setAgentValues] = useState<Record<string, string>>({});
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentRunPhase>("collecting");
  const [lastAppliedAgent, setLastAppliedAgent] = useState<AgentContext | null>(null);
  const [localLogs, setLocalLogs] = useState<LocalLogEntry[]>(loadLocalLogs);
  const [isLocalLogOpen, setIsLocalLogOpen] = useState(false);
  const [isAgentModeEnabled, setIsAgentModeEnabled] = useState(() =>
    loadBooleanSetting(AGENT_MODE_STORAGE_KEY, false),
  );
  const [agentModeState, setAgentModeState] = useState<AgentModeState>({
    status: "idle",
    message: "",
  });
  const [agentModePendingPlan, setAgentModePendingPlan] = useState<AgentModeAnalysisResult | null>(null);
  const [agentModeBrochureDraft, setAgentModeBrochureDraft] = useState<AgentModeBrochureProject | null>(null);
  const [analysisCountdown, setAnalysisCountdown] = useState<AnalysisCountdown | null>(null);
  const [isComposerCollapsed, setIsComposerCollapsed] = useState(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [isSendLaunching, setIsSendLaunching] = useState(false);
  const [analysisState, setAnalysisState] = useState<PromptAnalysisState>({
    status: "idle",
    mode: "send",
    message: "",
  });
  const [analysisStepIndex, setAnalysisStepIndex] = useState(0);
  const [availableFrontendVersion, setAvailableFrontendVersion] = useState("");
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthUser, setOauthUser] = useState<{ sub: string; username: string; displayName: string; email: string; role: number; group: string } | null>(null);
  const [oauthChecked, setOauthChecked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const sidebarListRef = useRef<HTMLDivElement | null>(null);
  const mainLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const sidebarLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const mainCursorRef = useRef<number | undefined>(undefined);
  const sidebarCursorRef = useRef<number | undefined>(undefined);
  const hasMoreMainRef = useRef(true);
  const hasMoreSidebarRef = useRef(true);
  const isLoadingMainRef = useRef(false);
  const isLoadingSidebarRef = useRef(false);
  const pendingQueueRef = useRef<PendingQueueItem[]>([]);
  const runningCountRef = useRef(0);
  const paramsRef = useRef(params);
  const recordElementRefs = useRef(new Map<string, HTMLElement>());
  const startIntentRef = useRef(0);
  const pendingGenerationIntentRef = useRef<GenerationIntent | null>(null);
  const sendLaunchFrameRef = useRef<number | undefined>(undefined);
  const sendLaunchTimerRef = useRef<number | undefined>(undefined);
  const modelLoadRequestRef = useRef(0);
  const lastAutoModelLoadKeyRef = useRef("");
  const analysisCountdownTimerRef = useRef<number | undefined>(undefined);
  const composerCollapseTimerRef = useRef<number | undefined>(undefined);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const protocolDefinition = getProtocolDefinition(apiConfig.protocol);
  const currentApiConnectionKey = apiConnectionKey(apiConfig);
  const isModelConnectionVerified = modelState.status === "ready" && verifiedModelKey === currentApiConnectionKey;
  const isOfficialGptImageSizeMode = usesOfficialGptImageSizing(apiConfig.protocol, selectedModel);
  const selectedResolution = normalizeResolutionForRequest(
    safeImageResolution(params.resolution),
    apiConfig.protocol,
    selectedModel,
  );
  const supportedAspectRatios = getSupportedAspectRatios(apiConfig.protocol, selectedModel, selectedResolution);
  const supportedAspectOptions = ASPECT_RATIOS.filter((ratio) => supportedAspectRatios.includes(ratio.value));
  const selectedAspectRatio = getAspectDefinition(params.aspectRatio);
  const selectedResolutionDefinition = IMAGE_RESOLUTIONS.find((item) => item.value === selectedResolution) || IMAGE_RESOLUTIONS[0];
  const resolvedRequestSize = resolveRequestSize(
    params.aspectRatio,
    selectedResolution,
    apiConfig.protocol,
    selectedModel,
    params.size,
  );
  const explicitSizeOptions = explicitSizeOptionsForModel(selectedModel, selectedResolution);
  const selectedExplicitSizeOption = explicitSizeOptions.find((option) => option.size === resolvedRequestSize);
  const aspectRatioSupported = isAspectRatioSupported(apiConfig.protocol, params.aspectRatio, selectedModel, selectedResolution);
  const selectedAspectHint = isGemini3ProImageModel(selectedModel)
    ? "Gemini 3 Pro 官方支持比例"
    : selectedExplicitSizeOption
      ? selectedExplicitSizeOption.label
    : selectedAspectRatio.hint;
  const composerConfigSummary = `${params.batchCount}张 · ${params.aspectRatio} · ${selectedResolution}`;
  const composerConfigDetail = `${resolvedRequestSize} · ${params.quality} · ${params.outputFormat.toUpperCase()} · 并发 ${params.concurrency}`;

  const selectableImageModels = useMemo(
    () => {
      // Key 已验证：只列出「后台白名单 ∩ 这把 Key 实际可用」的模型。
      // 列白名单全量会让用户选到自己没权限的模型，点了才在上游失败。
      if (isModelConnectionVerified && models.length > 0) {
        if (runtimeModelConfig.length > 0) {
          const owned = new Set(models.map((m) => normalizedModelId(m)));
          return runtimeModelConfig.map((m) => m.id).filter((id) => owned.has(normalizedModelId(id)));
        }
        return models;
      }
      // 未验证时展示白名单全量，仅供预览（此时 canGenerate 本就为 false）
      if (runtimeModelConfig.length > 0) {
        return runtimeModelConfig.map((m) => m.id);
      }
      return filterAllowedImageModels([...models, ...PRIMARY_IMAGE_MODELS]);
    },
    // configVersion 参与依赖：配置拉取完成后重新计算，剔除非白名单模型
    [models, configVersion, isModelConnectionVerified],
  );
  const filteredModels = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    return selectableImageModels
      .filter((model) => model.toLowerCase().includes(query))
      .slice(0, 80);
  }, [modelFilter, selectableImageModels]);
  const preferredAnalysisModel = useMemo(
    () => preferAnalysisModel(analysisModels, selectedAnalysisModel),
    [analysisModels, selectedAnalysisModel],
  );

  const visibleStats = useMemo(() => {
    return visibleRecords.reduce(
      (stats, record) => {
        stats[record.status] += 1;
        return stats;
      },
      { submitting: 0, queued: 0, running: 0, success: 0, error: 0 } as Record<JobStatus, number>,
    );
  }, [visibleRecords]);
  const successfulVisibleRecords = visibleRecords.filter((record) => record.status === "success" && record.imageUrl);
  const selectableVisibleRecords = visibleRecords.filter(
    (record) => record.status === "success" || record.status === "error",
  );
  const selectedRecords = useMemo(
    () => visibleRecords.filter((record) => selectedRecordIds.has(record.id)),
    [selectedRecordIds, visibleRecords],
  );
  const downloadableSelectedRecords = selectedRecords.filter((record) => record.status === "success" && record.imageBlob);
  const pendingDeleteRecords = useMemo(
    () => visibleRecords.filter((record) => pendingDeleteIds?.includes(record.id)),
    [pendingDeleteIds, visibleRecords],
  );
  const usableReferenceImages = useMemo(
    () => referenceImages.filter(isReferenceUsable),
    [referenceImages],
  );
  const referenceIssueCount = referenceImages.filter((image) => image.status === "error").length;
  const referenceWarningCount = referenceImages.filter((image) => image.status === "warning").length;
  const referenceMetaLabel = referenceImages.length > 0
    ? protocolDefinition.supportsReferenceImages
      ? `将发送参考图 ${usableReferenceImages.length}/${referenceImages.length}`
      : `参考图不会发送 · 当前协议不支持`
    : `${protocolDefinition.shortLabel} · ${resolvedRequestSize}`;
  const failedVisibleRecordCount = visibleStats.error;
  const isPromptAnalyzing = analysisState.status === "analyzing" || analysisState.status === "receiving";
  const selectedAgent = useMemo(
    () => runtimeIndustryAgents.find((agent) => agent.id === selectedAgentId) || null,
    [selectedAgentId],
  );
  const isAgentEnabled = Boolean(selectedAgent);
  const latestLocalLogLevel = localLogs[0]?.level;
  const isAgentModeBusy = isAgentModeEnabled && (
    agentModeState.status === "analyzing"
    || agentModeState.status === "receiving"
  );
  const modelStatusMessage = isAutoLoadingModels
    ? "正在自动验证 API Key 并读取图片模型..."
    : isModelConnectionVerified && verifiedModelAt
      ? `${modelState.message} · ${formatDate(verifiedModelAt)}`
      : modelState.message;
  const currentAnalysisMessage = ANALYSIS_STEPS[analysisStepIndex % ANALYSIS_STEPS.length];
  const canGenerate =
    prompt.trim().length > 0 &&
    selectedModel.length > 0 &&
    isAllowedImageModel(selectedModel) &&
    models.includes(selectedModel) &&
    protocolMatchesImageModel(apiConfig.protocol, selectedModel) &&
    isModelConnectionVerified &&
    aspectRatioSupported;
  const canRequestGenerate = canGenerate && !isPromptAnalyzing && !analysisCountdown && !isAgentModeBusy;
  // 按钮变灰必须说得出原因，否则用户只会反复点击然后困惑
  const blockedReason = (() => {
    if (canGenerate) return "";
    if (apiConfig.apiKey.trim().length < API_KEY_MIN_LENGTH) return "请先填写 API Key";
    if (modelState.status === "loading" || isAutoLoadingModels) return "正在验证 API Key 并读取模型";
    if (modelState.status === "error") return modelState.message || "API Key 验证失败";
    if (!isModelConnectionVerified) return "等待 API Key 验证通过";
    if (models.length === 0 || selectableImageModels.length === 0) {
      return "该 API Key 下没有可用的生图模型，请更换 Key 或联系服务商开通";
    }
    if (!selectedModel) return "请选择一个生图模型";
    if (!models.includes(selectedModel)) return `当前 Key 没有 ${selectedModel} 的权限，请换一个模型`;
    if (!aspectRatioSupported) return "当前宽高比不被该模型支持";
    if (!prompt.trim()) return "请输入提示词";
    return "暂时无法生成";
  })();
  const canUseSquareIdentity = apiConfig.apiKey.trim().length >= API_KEY_MIN_LENGTH;

  useEffect(() => {
    void loadMainRecordsPage();
    void loadSidebarRecordsPage();
    void importServerOrphanTasks();
  }, []);

  // 老记录回填缩略图：分批小步跑，避免一次解码大量原图把主线程顶住。
  // 失败或没跑到的记录，渲染点一律 `thumbUrl ?? objectUrl` 回退原图，不影响使用。
  // 注意：本 effect 内部会 setSidebarRecords（即它自己的依赖），所以不能用 cleanup 里的 cancelled 标志
  // 来中断循环——那会导致每写回 1 条就自我取消，"每批 6 条"永远不成立，还白算一次解码。
  // 改为：running ref 防重入 + 卸载标志只在真正卸载时置位。
  const backfillRunningRef = useRef(false);
  const backfillDoneRef = useRef(new Set<string>());
  const isUnmountedRef = useRef(false);
  const sidebarRecordsRef = useRef<HistoryRecord[]>([]);
  sidebarRecordsRef.current = sidebarRecords;
  useEffect(() => () => { isUnmountedRef.current = true; }, []);

  useEffect(() => {
    if (backfillRunningRef.current) return;
    const timer = window.setTimeout(async () => {
      if (backfillRunningRef.current || isUnmountedRef.current) return;
      const pending = sidebarRecordsRef.current
        .filter((record) => record.imageBlob && !record.thumbBlob && !backfillDoneRef.current.has(record.id))
        .slice(0, 6);
      if (pending.length === 0) return;
      backfillRunningRef.current = true;
      try {
        for (const record of pending) {
          if (isUnmountedRef.current) return;
          backfillDoneRef.current.add(record.id);
          const thumb = await createListThumbnail(record.imageBlob as Blob);
          if (!thumb) continue;
          const { objectUrl: _o, thumbUrl: _t, ...stored } = record;
          try {
            await saveHistoryRecord({ ...stored, thumbBlob: thumb.blob, thumbWidth: thumb.width, thumbHeight: thumb.height });
          } catch {
            continue;
          }
          if (isUnmountedRef.current) return;
          const thumbUrl = URL.createObjectURL(thumb.blob);
          const patch = { thumbBlob: thumb.blob, thumbWidth: thumb.width, thumbHeight: thumb.height, thumbUrl };
          setSidebarRecords((current) => current.map((r) => (r.id === record.id ? { ...r, ...patch } : r)));
          setVisibleRecords((current) => current.map((j) => (j.id === record.id ? { ...j, thumbUrl } : j)));
        }
      } finally {
        backfillRunningRef.current = false;
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [sidebarRecords]);

  useEffect(() => {
    void fetchAppConfig().then(() => {
      setConfigVersion((current) => current + 1);
      setApiConfig((current) => ({ ...current, baseUrl: normalizeApiBaseUrl(current.baseUrl) }));
    });
    // 拉取近 7 日各模型真实表现，用于模型选择时展示成功率与 P50
    const loadModelStats = () => {
      void fetch("/api/model-stats")
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (payload && payload.ok && Array.isArray(payload.models)) {
            const map: Record<string, ModelStat> = {};
            for (const item of payload.models as ModelStat[]) {
              map[normalizedModelId(item.id)] = item;
            }
            setModelStats(map);
          }
        })
        .catch(() => {
          // 统计拉取失败不影响使用
        });
    };
    loadModelStats();
    // 回到页面时静默刷新（60s 节流）——批量跑完切回来能看到最新成功率
    let lastStatsAt = Date.now();
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastStatsAt > 60_000) {
        lastStatsAt = Date.now();
        loadModelStats();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function sendImageFeedback(requestId: string | undefined, rating: 1 | -1) {
    if (!requestId) return;
    const next = feedbackMap[requestId] === rating ? 0 : rating;
    setFeedbackMap((current) => {
      const copy = { ...current };
      if (next === 0) delete copy[requestId];
      else copy[requestId] = next as 1 | -1;
      return copy;
    });
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, rating: next, clientId: getClientId() }),
      });
    } catch {
      // 反馈失败静默忽略
    }
  }

  useEffect(() => {
    const onHashChange = () => {
      setActivePage(pageFromHash());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const active = queueStats.running + queueStats.queued;
    const prev = prevActiveJobsRef.current;
    prevActiveJobsRef.current = active;
    if (prev > 0 && active === 0 && activePage !== "studio") {
      showAppNotice("生成任务已全部完成，可回工作台查看");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueStats, activePage]);

  useEffect(() => {
    let cancelled = false;
    const hash = window.location.hash;
    const isOauthReturn = hash === "#oauth-success" || hash === "#oauth-error";
    if (isOauthReturn) {
      window.history.replaceState(null, "", window.location.pathname);
      setActivePage("home");
    } else if (hash === "#login") {
      // /login 直链（roadmap PRD N3）：直接进 OAuth 流程，分享登录入口的真实场景
      window.history.replaceState(null, "", window.location.pathname);
      window.location.href = "/api/auth/oauth/login";
      return;
    } else if (hash && !["#studio", "#square", "#canvas"].includes(hash) && !hash.startsWith("#admin")) {
      // 未知 hash：pageFromHash 已静默落回首页，这里补一句提示，别让用户以为链接坏了
      window.history.replaceState(null, "", window.location.pathname);
      showAppNotice("页面不存在，已回到首页");
    }

    (async () => {
      try {
        const cfgRes = await fetch("/api/auth/oauth/config");
        const cfg = await cfgRes.json() as { enabled?: boolean; providerUrl?: string };
        if (cancelled) return;
        if (!cfg.enabled) { setOauthChecked(true); return; }
        setOauthEnabled(true);
        if (cfg.providerUrl) {
          const normalized = cfg.providerUrl.replace(/\/+$/, "");
          if (!runtimeEndpoints.some((ep) => ep.value.replace(/\/+$/, "") === normalized)) {
            runtimeEndpoints.push({ value: normalized, label: "太极 AI (OAuth)", description: "OAuth 登录服务地址" });
          }
        }

        const meRes = await fetch("/api/auth/oauth/me", { credentials: "same-origin" });
        const me = await meRes.json() as { loggedIn?: boolean; sub?: string; username?: string; displayName?: string; email?: string; role?: number; group?: string; apiKey?: string };
        if (cancelled) return;
        if (me.loggedIn) {
          setOauthUser({ sub: me.sub || "", username: me.username || "", displayName: me.displayName || "", email: me.email || "", role: me.role ?? 1, group: me.group || "" });
          if (me.apiKey) {
            const baseUrl = cfg.providerUrl || "";
            setApiConfig((prev) => ({
              ...prev,
              apiKey: me.apiKey!,
              baseUrl: normalizeApiBaseUrl(baseUrl) || prev.baseUrl,
              // 不强制 rememberKey：这是提供方下发的真实上游 Key，
              // 用户若刻意取消了「记住 API Key」，登录不应替他改回长期存储。
              // 未勾选时它仍在 sessionStorage 中，本次会话照常可用。
            }));
          }
        } else if (hash === "#oauth-error") {
          window.alert("登录失败，请重试");
        }
      } catch { /* oauth config unavailable — disable silently */ }
      if (!cancelled) setOauthChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (activePage !== "studio" || !showOnboarding) return;
    setIsSettingsOpen(true);
    if (onboardingStep < 2) {
      setIsLeftSidebarOpen(false);
    }
  }, [activePage, showOnboarding, onboardingStep]);

  useEffect(() => {
    if (activePage !== "studio" || isAgentHintSeen || isAgentPanelOpen || isComposerCollapsed) {
      setIsAgentHintVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setIsAgentHintVisible(true), 1200);
    return () => window.clearTimeout(timer);
  }, [activePage, isAgentHintSeen, isAgentPanelOpen, isComposerCollapsed]);

  useEffect(() => {
    paramsRef.current = params;
    pumpQueue();
  }, [params]);

  useEffect(() => {
    localStorage.setItem("imageStudioProtocol", apiConfig.protocol);
    localStorage.setItem("imageStudioBaseUrl", normalizeApiBaseUrl(apiConfig.baseUrl));
    localStorage.setItem("imageStudioRememberKey", String(apiConfig.rememberKey));
    sessionStorage.setItem("imageStudioApiKey", apiConfig.apiKey);
    if (apiConfig.rememberKey) {
      localStorage.setItem("imageStudioApiKey", apiConfig.apiKey);
    } else {
      localStorage.removeItem("imageStudioApiKey");
    }
  }, [apiConfig]);

  useEffect(() => {
    localStorage.setItem("imageStudioParams", JSON.stringify(params));
  }, [params]);

  useEffect(() => {
    localStorage.setItem("imageStudioSelectedModel", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem("imageStudioSelectedAnalysisModel", selectedAnalysisModel);
  }, [selectedAnalysisModel]);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    const checkVersion = async () => {
      try {
        const latestVersion = await fetchFrontendBuildVersion(controller.signal);
        if (!stopped && latestVersion && latestVersion !== CURRENT_FRONTEND_VERSION) {
          setAvailableFrontendVersion(latestVersion);
        }
      } catch {
        // Version checks are best-effort and should never interrupt creation.
      }
    };
    void checkVersion();
    const interval = window.setInterval(() => void checkVersion(), FRONTEND_VERSION_CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    window.addEventListener("focus", checkVersion);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", checkVersion);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useLayoutEffect(() => {
    resizePromptTextarea();
  }, [prompt]);

  useEffect(() => {
    localStorage.setItem("imageStudioLeftSidebarOpen", String(isLeftSidebarOpen));
  }, [isLeftSidebarOpen]);

  useEffect(() => {
    localStorage.setItem("imageStudioSettingsOpen", String(isSettingsOpen));
  }, [isSettingsOpen]);

  useEffect(() => {
    localStorage.setItem("imageStudioAutoPromptAnalysisEnabled", String(isAutoPromptAnalysisEnabled));
    if (!isAutoPromptAnalysisEnabled && analysisState.mode === "send") {
      cancelAnalysisCountdown();
      setAnalysisState({ status: "idle", mode: "send", message: "" });
    }
  }, [isAutoPromptAnalysisEnabled, analysisState.mode]);

  useEffect(() => {
    localStorage.setItem(AGENT_MODE_STORAGE_KEY, String(isAgentModeEnabled));
  }, [isAgentModeEnabled]);

  useEffect(() => {
    if (!isAgentModeEnabled) {
      setAgentModeState({ status: "idle", message: "" });
      setAgentModePendingPlan(null);
      setAgentModeBrochureDraft(null);
      return;
    }
    cancelAnalysisCountdown();
    setAnalysisState({ status: "idle", mode: "send", message: "" });
    setShowPromptPresets(false);
    setIsAgentPanelOpen(false);
    setAgentModeState({
      status: "idle",
      message: "告诉我你想做一张图、一组不同图片，或者一本宣传画册。",
    });
    setAgentModePendingPlan(null);
    setAgentModeBrochureDraft(null);
  }, [isAgentModeEnabled]);

  useEffect(() => {
    const normalizedResolution = normalizeResolutionForRequest(
      safeImageResolution(params.resolution),
      apiConfig.protocol,
      selectedModel,
    );
    const fallbackRatio = getSupportedAspectRatios(apiConfig.protocol, selectedModel, normalizedResolution)[0] || "1:1";
    const nextAspectRatio = isAspectRatioSupported(apiConfig.protocol, params.aspectRatio, selectedModel, normalizedResolution)
      ? params.aspectRatio
      : fallbackRatio;
    if (nextAspectRatio === params.aspectRatio && normalizedResolution === params.resolution) return;
    updateParams({
      aspectRatio: nextAspectRatio,
      resolution: normalizedResolution,
      size: resolveRequestSize(nextAspectRatio, normalizedResolution, apiConfig.protocol, selectedModel, params.size),
    });
  }, [apiConfig.protocol, selectedModel, params.aspectRatio, params.resolution]);

  useEffect(() => {
    if (!isPromptAnalyzing) {
      setAnalysisStepIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setAnalysisStepIndex((current) => current + 1);
    }, 860);
    return () => window.clearInterval(timer);
  }, [isPromptAnalyzing]);

  useEffect(() => {
    return () => {
      if (sendLaunchFrameRef.current) {
        window.cancelAnimationFrame(sendLaunchFrameRef.current);
      }
      if (sendLaunchTimerRef.current) {
        window.clearTimeout(sendLaunchTimerRef.current);
      }
      if (analysisCountdownTimerRef.current) {
        window.clearInterval(analysisCountdownTimerRef.current);
      }
      if (composerCollapseTimerRef.current) {
        window.clearTimeout(composerCollapseTimerRef.current);
      }
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // 首页也要参与静默验证：首页输入框依赖 canGenerate，否则提交按钮永远不可用
    if (activePage !== "studio" && activePage !== "home") return;
    const apiKey = apiConfig.apiKey.trim();
    if (apiKey.length < API_KEY_MIN_LENGTH) {
      lastAutoModelLoadKeyRef.current = "";
      setVerifiedModelKey("");
      setVerifiedModelAt(0);
      setModels([]);
      setSelectedModel((current) => protocolMatchesImageModel(apiConfig.protocol, current) ? current : "");
      setAnalysisModels([]);
      setSelectedAnalysisModel("");
      setModelState({ status: "idle", message: "填写 API Key 后自动验证" });
      return;
    }
    const normalizedBaseUrl = normalizeApiBaseUrl(apiConfig.baseUrl);
    const autoLoadKey = `${apiConfig.protocol}|${normalizedBaseUrl}|${apiKey}`;
    if (verifiedModelKey !== autoLoadKey) {
      setVerifiedModelKey("");
      setVerifiedModelAt(0);
      setModels([]);
      setSelectedModel((current) => protocolMatchesImageModel(apiConfig.protocol, current) ? current : "");
      setAnalysisModels([]);
      setSelectedAnalysisModel("");
      setModelState({ status: "idle", message: "API Key 已变化，等待自动验证" });
    }
    if (lastAutoModelLoadKeyRef.current === autoLoadKey && verifiedModelKey === autoLoadKey) return;

    const timer = window.setTimeout(() => {
      if (lastAutoModelLoadKeyRef.current === autoLoadKey && verifiedModelKey === autoLoadKey) return;
      lastAutoModelLoadKeyRef.current = autoLoadKey;
      void loadModels({
        silent: true,
        config: {
          ...apiConfig,
          baseUrl: normalizedBaseUrl,
          apiKey,
        },
      });
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [activePage, apiConfig.apiKey, apiConfig.baseUrl, apiConfig.protocol, verifiedModelKey]);

  // 首页提交的待办：落进 studio 后一旦具备生成条件就自动发车；15 秒内没就绪则交还给用户手动点
  useEffect(() => {
    const pending = homeSubmitPendingRef.current;
    if (!pending || activePage !== "studio") return;
    if (Date.now() - pending.at > 15000) {
      homeSubmitPendingRef.current = null;
      return;
    }
    // 提示词已被用户改动 → 放弃自动发车，交还控制权，避免用半截提示词消耗额度
    if (prompt !== pending.prompt) {
      homeSubmitPendingRef.current = null;
      return;
    }
    if (!canRequestGenerate) return;
    homeSubmitPendingRef.current = null;
    void requestStartBatch();
  }, [activePage, canRequestGenerate, prompt]);

  useEffect(() => {
    const marker = mainLoadMoreRef.current;
    const root = canvasRef.current;
    if (!marker || !root || !hasMoreMainRecords) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMainRecordsPage();
      },
      { root, rootMargin: "320px 0px", threshold: 0 },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [visibleRecords.length, hasMoreMainRecords]);

  useEffect(() => {
    const marker = sidebarLoadMoreRef.current;
    const root = sidebarListRef.current;
    if (!marker || !root || !hasMoreSidebarRecords) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadSidebarRecordsPage();
      },
      { root, rootMargin: "220px 0px", threshold: 0 },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [sidebarRecords.length, hasMoreSidebarRecords]);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1180px)");
    const mobile = window.matchMedia("(max-width: 780px)");
    const syncPanels = () => {
      if (compact.matches) setIsSettingsOpen(false);
      if (mobile.matches) setIsLeftSidebarOpen(false);
    };
    syncPanels();
    compact.addEventListener("change", syncPanels);
    mobile.addEventListener("change", syncPanels);
    return () => {
      compact.removeEventListener("change", syncPanels);
      mobile.removeEventListener("change", syncPanels);
    };
  }, []);

  useEffect(() => {
    if (!isAgentPanelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAgentPanelOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAgentPanelOpen]);

  function resizePromptTextarea() {
    const element = promptTextareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    const nextHeight = Math.min(element.scrollHeight, PROMPT_TEXTAREA_MAX_HEIGHT);
    element.style.height = `${Math.max(46, nextHeight)}px`;
    element.style.overflowY = element.scrollHeight > PROMPT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }

  function syncQueueStats() {
    setQueueStats({
      running: runningCountRef.current,
      queued: pendingQueueRef.current.length,
    });
  }

  async function loadMainRecordsPage() {
    if (isLoadingMainRef.current || !hasMoreMainRef.current) return;
    isLoadingMainRef.current = true;
    setIsLoadingMainRecords(true);
    try {
      const page = await getHistoryRecordsPage({
        limit: HISTORY_PAGE_SIZE,
        beforeCreatedAt: mainCursorRef.current,
      });
      const historicalJobs = page.records.map(historyRecordToJob);
      setVisibleRecords((current) => mergeHistoricalJobs(current, historicalJobs));
      mainCursorRef.current = page.nextCursor;
      hasMoreMainRef.current = page.hasMore;
      setHasMoreMainRecords(page.hasMore);
    } catch (error) {
      setModelState({
        status: "error",
        message: `历史库读取失败：${formatError(error)}`,
      });
    } finally {
      isLoadingMainRef.current = false;
      setIsLoadingMainRecords(false);
    }
  }

  async function loadSidebarRecordsPage() {
    if (isLoadingSidebarRef.current || !hasMoreSidebarRef.current) return;
    isLoadingSidebarRef.current = true;
    setIsLoadingSidebarRecords(true);
    try {
      const page = await getHistoryRecordsPage({
        limit: HISTORY_PAGE_SIZE,
        beforeCreatedAt: sidebarCursorRef.current,
      });
      setSidebarRecords((current) => mergeHistoryRecords(current, page.records));
      sidebarCursorRef.current = page.nextCursor;
      hasMoreSidebarRef.current = page.hasMore;
      setHasMoreSidebarRecords(page.hasMore);
    } catch (error) {
      setModelState({
        status: "error",
        message: `历史库读取失败：${formatError(error)}`,
      });
    } finally {
      isLoadingSidebarRef.current = false;
      setIsLoadingSidebarRecords(false);
    }
  }

  async function importServerOrphanTasks() {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    try {
      const [localRecovery, serverTasks] = await Promise.all([
        getRecentHistoryRecovery(since),
        fetchGenerationTasks({ clientId: getClientId(), since }),
      ]);
      const recovered = serverTasks
        .filter((task) => !localRecovery.requestIds.has(task.requestId))
        .map(recoveredTaskRecord);
      await Promise.all(recovered.map(saveHistoryRecord));
      const pendingHistory = localRecovery.pendingRecords.map((record): HistoryRecord => ({
        ...record,
        params: normalizeImageParams(record.params),
        referenceImages: normalizeStoredReferenceImages(record.referenceImages),
      }));
      const recoveredHistory = recovered.map((record): HistoryRecord => ({
        ...record,
        referenceImages: normalizeStoredReferenceImages(record.referenceImages),
      }));
      const resumableHistory = [...pendingHistory, ...recoveredHistory];
      if (resumableHistory.length === 0) return;
      setVisibleRecords((current) =>
        mergeHistoricalJobs(current, resumableHistory.map(historyRecordToJob)));
      setSidebarRecords((current) => mergeHistoryRecords(current, resumableHistory));
      if (recovered.length > 0) {
        showAppNotice(`已找回 ${recovered.length} 个服务端任务，正在同步结果`);
      }
    } catch {
      // 启动恢复失败不阻塞工作台；常驻任务对账和下次刷新还会继续尝试。
    }
  }

  // ── Studio 任务对账 ──────────────────────────────────────────
  // 服务端异步执行后，结果不再随 POST 返回。这里轮询 /api/tasks，
  // 把 queued/running 的记录推进到终态，并把图片取回本地。
  // 关掉页面再回来同样走这条路径——这正是「关页面不丢」的实现。
  const visibleRecordsRef = useRef<Job[]>([]);
  visibleRecordsRef.current = visibleRecords;
  const reconcilingRef = useRef(false);
  const studioTaskMissCountsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const reconcile = async () => {
      if (reconcilingRef.current) return;
      const pending = visibleRecordsRef.current.filter(
        (job) => (
          job.status === "submitting"
          || job.status === "queued"
          || job.status === "running"
        ) && job.requestId,
      );
      if (pending.length === 0) return;
      reconcilingRef.current = true;
      try {
        const ids = pending.flatMap((job) => job.requestId ? [job.requestId] : []);
        const tasks = await fetchGenerationTasks({ clientId: getClientId(), ids });
        if (cancelled) return;
        const byId = new Map(tasks.map((task) => [task.requestId, task]));

        for (const job of pending) {
          const task = byId.get(job.requestId as string);
          if (!task) {
            // 查询本身成功但连续 60 秒都找不到该 ID，说明两次同 ID POST 都没有被受理。
            // 此时转为可重试失败，避免“状态确认中”永久悬挂；查询接口不可达不会进入这里。
            const misses = (studioTaskMissCountsRef.current.get(job.id) || 0) + 1;
            studioTaskMissCountsRef.current.set(job.id, misses);
            if (misses >= 30) {
              studioTaskMissCountsRef.current.delete(job.id);
              const finishedAt = Date.now();
              const errorDetail = {
                error: "服务端持续未找到该任务，确认未接单；可以安全重试",
                requestId: job.requestId,
              };
              patchVisibleRecord(job.id, { status: "error", errorDetail, finishedAt });
              const failed = storedRecordForJob(job, {
                status: "error",
                errorDetail,
                finishedAt,
              });
              await saveHistoryRecord(failed);
              setSidebarRecords((current) => mergeHistoryRecords(current, [{
                ...failed,
                referenceImages: normalizeStoredReferenceImages(failed.referenceImages),
              }]));
              void reportGenerationClientEvent({
                requestId: job.requestId as string,
                clientId: getClientId(),
                phase: "client_error_received",
                occurredAt: finishedAt,
                surface: "studio",
                localRecordId: job.id,
                detail: "连续对账未找到服务端任务，前端已显示可安全重试",
              });
              pushLocalLog({
                type: "image_generation",
                level: "error",
                title: `任务对账失败 #${job.index}/${job.total}`,
                message: errorDetail.error,
                endpoint: "/api/tasks",
                requestId: job.requestId,
                durationMs: Math.max(0, finishedAt - (job.startedAt || job.createdAt)),
                response: { phase: "client_error_received", error: errorDetail.error },
              });
            }
            continue;
          }
          studioTaskMissCountsRef.current.delete(job.id);
          if (task.status === "queued" || task.status === "running") {
            // 状态可能从 queued 前进到 running，同步一下让 UI 有反馈
            if (task.status !== job.status) {
              patchVisibleRecord(job.id, {
                status: task.status as JobStatus,
                stages: task.stages,
                errorDetail: undefined,
              });
              await saveHistoryRecord(storedRecordForJob(job, {
                status: task.status,
                stages: task.stages,
                errorDetail: undefined,
              }));
            }
            continue;
          }
          if (task.status === "success" && task.images?.[0]?.url) {
            try {
              const blob = await generatedImageToBlob({ url: task.images[0].url });
              if (cancelled) return;
              const objectUrl = URL.createObjectURL(blob);
              const { width, height } = await getImageSize(objectUrl);
              const thumb = await createListThumbnail(blob);
              const thumbUrl = thumb ? URL.createObjectURL(thumb.blob) : undefined;
              if (cancelled) return;
              const finishedAt = Date.now();
              patchVisibleRecord(job.id, {
                status: "success",
                imageBlob: blob,
                imageUrl: objectUrl,
                thumbUrl,
                width,
                height,
                finishedAt,
                durationMs: task.durationMs,
                stages: task.stages,
              });
              const record: StoredHistoryRecord = {
                id: job.id,
                requestId: job.requestId,
                batchId: job.batchId,
                index: job.index,
                total: job.total,
                protocol: job.protocol,
                prompt: job.prompt,
                model: job.model,
                params: job.params,
                referenceImages: referenceImagesForHistory(job.referenceImages),
                submittedReferenceImages: job.submittedReferenceImages,
                status: "success",
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                finishedAt,
                durationMs: task.durationMs,
                stages: task.stages,
                imageBlob: blob,
                thumbBlob: thumb?.blob,
                thumbWidth: thumb?.width,
                thumbHeight: thumb?.height,
                width,
                height,
                agentId: job.agentId,
                agentName: job.agentName,
                agentScenario: job.agentScenario,
                promptVariant: job.promptVariant,
              };
              await saveHistoryRecord(record);
              setSidebarRecords((current) => mergeHistoryRecords(current, [{
                ...record,
                referenceImages: normalizeStoredReferenceImages(record.referenceImages),
                objectUrl,
                thumbUrl,
              }]));
              void reportGenerationClientEvent({
                requestId: job.requestId as string,
                clientId: getClientId(),
                phase: "client_result_received",
                occurredAt: finishedAt,
                surface: "studio",
                localRecordId: job.id,
                detail: "前端已取回图片、完成解码并写入本地历史",
              });
              pushLocalLog({
                type: "image_generation",
                level: "success",
                title: `生成完成并返回前端 #${job.index}/${job.total}`,
                message: "已从服务端取回图片，完成解码、缩略图生成与本地历史保存。",
                endpoint: "/api/tasks",
                requestId: job.requestId,
                durationMs: task.durationMs,
                response: {
                  phase: "client_result_received",
                  status: task.status,
                  imageCount: task.images?.length || 0,
                  stages: task.stages,
                },
              });
              // 补传缩略图给服务端供管理后台用：任务在用户离线时完成的话，
              // 这是唯一的补齐时机（服务端没有图片处理能力）
              if (thumb && job.requestId) {
                void blobToDataUrl(thumb.blob)
                  .then((thumbnailDataUrl) => fetch("/api/images/thumb", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ requestId: job.requestId, index: 0, thumbnailDataUrl, clientId: getClientId() }),
                  }))
                  .catch(() => undefined);
              }
            } catch {
              // 图取不回来（多半是被日志裁剪清理了）才判失败
              const imageMissingAt = Date.now();
              patchVisibleRecord(job.id, {
                status: "error",
                errorDetail: { error: "图片已被服务器清理" },
                finishedAt: imageMissingAt,
              });
              void reportGenerationClientEvent({
                requestId: job.requestId as string,
                clientId: getClientId(),
                phase: "client_error_received",
                occurredAt: imageMissingAt,
                surface: "studio",
                localRecordId: job.id,
                detail: "服务端任务成功，但前端无法取回图片文件",
              });
            }
          } else if (task.status === "error") {
            const finishedAt = Date.now();
            const errorDetail = { error: task.errorMessage || "生成失败" };
            patchVisibleRecord(job.id, {
              status: "error",
              errorDetail,
              finishedAt,
              durationMs: task.durationMs,
              stages: task.stages,
            });
            // 必须同时落库：只改内存的话，刷新后记录会以 queued 重新加载，
            // 然后再次对账、再次只改内存——永远推进不到终态
            const failed: StoredHistoryRecord = {
              id: job.id,
              requestId: job.requestId,
              batchId: job.batchId,
              index: job.index,
              total: job.total,
              protocol: job.protocol,
              prompt: job.prompt,
              model: job.model,
              params: job.params,
              referenceImages: referenceImagesForHistory(job.referenceImages),
              submittedReferenceImages: job.submittedReferenceImages,
              status: "error",
              createdAt: job.createdAt,
              startedAt: job.startedAt,
              finishedAt,
              durationMs: task.durationMs,
              stages: task.stages,
              errorDetail,
              agentId: job.agentId,
              agentName: job.agentName,
              agentScenario: job.agentScenario,
              promptVariant: job.promptVariant,
            };
            await saveHistoryRecord(failed);
            setSidebarRecords((current) => mergeHistoryRecords(current, [{
              ...failed,
              referenceImages: normalizeStoredReferenceImages(failed.referenceImages),
            }]));
            void reportGenerationClientEvent({
              requestId: job.requestId as string,
              clientId: getClientId(),
              phase: "client_error_received",
              occurredAt: finishedAt,
              surface: "studio",
              localRecordId: job.id,
              detail: task.errorMessage || "前端已收到服务端失败结果",
            });
            pushLocalLog({
              type: "image_generation",
              level: "error",
              title: `服务端返回生成失败 #${job.index}/${job.total}`,
              message: task.errorMessage || "生成失败",
              endpoint: "/api/tasks",
              requestId: job.requestId,
              durationMs: task.durationMs,
              response: {
                phase: "client_error_received",
                status: task.status,
                errorType: task.errorType,
                stages: task.stages,
              },
            });
          }
        }
      } catch {
        // 单轮对账失败不影响使用，下一轮重试
      } finally {
        reconcilingRef.current = false;
      }
    };

    void reconcile();
    const timer = window.setInterval(() => { void reconcile(); }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchVisibleRecord(id: string, patch: Partial<Job>) {
    setVisibleRecords((current) =>
      sortGenerationRecords(current.map((record) => (record.id === id ? { ...record, ...patch } : record))),
    );
  }

  function recordStudioSubmissionIntent(job: Job, config: ApiConfig) {
    if (!job.requestId) return;
    pushLocalLog({
      type: "image_generation",
      level: "info",
      title: `用户点击提交 #${job.index}/${job.total}`,
      message: "已分配 requestId，任务进入前端队列；接下来将准备参考图并在 POST 前写入本地数据库。",
      endpoint: "/api/images/generate",
      requestId: job.requestId,
      params: imageRequestParamsForLog(job, config),
      response: {
        phase: "client_submitted",
        localRecordId: job.id,
        submittedAt: job.createdAt,
      },
    });
    void reportGenerationClientEvent({
      requestId: job.requestId,
      clientId: getClientId(),
      phase: "client_submitted",
      occurredAt: job.createdAt,
      surface: "studio",
      localRecordId: job.id,
      detail: `用户点击提交，前端批次 ${job.index}/${job.total}`,
      context: {
        protocol: job.protocol,
        model: job.model,
        prompt: job.prompt,
        baseUrl: normalizeApiBaseUrl(config.baseUrl),
        batchId: job.batchId,
        batchIndex: job.index,
        batchTotal: job.total,
        aspectRatio: job.params.aspectRatio,
        resolution: job.params.resolution,
        size: job.params.size,
        referenceCount: job.referenceImages.length,
      },
    });
  }

  function enqueueJobs(records: Job[], config: ApiConfig) {
    for (const job of records) {
      // attempt > 1 是同一 requestId 的自动重试，不重复伪装成一次新的用户点击。
      if ((job.attempt ?? 1) > 1 || !job.requestId || job.submissionIntentLogged) continue;
      recordStudioSubmissionIntent(job, config);
    }
    pendingQueueRef.current.push(...records.map((job) => ({ job, config })));
    syncQueueStats();
    pumpQueue();
  }

  function pumpQueue() {
    const maxConcurrency = clampNumber(Number(paramsRef.current.concurrency), 1, 6);
    while (runningCountRef.current < maxConcurrency && pendingQueueRef.current.length > 0) {
      const next = pendingQueueRef.current.shift()!;
      runningCountRef.current += 1;
      syncQueueStats();
      void generateSingle(next.job, next.config).finally(() => {
        runningCountRef.current = Math.max(0, runningCountRef.current - 1);
        syncQueueStats();
        pumpQueue();
      });
    }
  }

  function registerRecordElement(id: string, element: HTMLElement | null) {
    if (element) {
      recordElementRefs.current.set(id, element);
    } else {
      recordElementRefs.current.delete(id);
    }
  }

  function focusSidebarRecord(record: HistoryRecord) {
    setHighlightedRecordId(record.id);
    const element = recordElementRefs.current.get(record.id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      if (record.status === "error") {
        window.setTimeout(() => previewCurrent(record), 220);
      }
    } else if (record.objectUrl || record.status === "error") {
      previewCurrent(record);
    }
    window.setTimeout(() => {
      setHighlightedRecordId((current) => (current === record.id ? "" : current));
    }, 1800);
  }

  function toggleSelectionMode() {
    setIsSelectionMode((value) => {
      if (value) setSelectedRecordIds(new Set());
      return !value;
    });
  }

  function toggleRecordSelection(record: Job) {
    if (record.status !== "success" && record.status !== "error") return;
    setIsSelectionMode(true);
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      if (next.has(record.id)) {
        next.delete(record.id);
      } else {
        next.add(record.id);
      }
      return next;
    });
  }

  function selectAllVisibleRecords() {
    setIsSelectionMode(true);
    setSelectedRecordIds(new Set(selectableVisibleRecords.map((record) => record.id)));
  }

  function invertVisibleSelection() {
    setIsSelectionMode(true);
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      selectableVisibleRecords.forEach((record) => {
        if (next.has(record.id)) {
          next.delete(record.id);
        } else {
          next.add(record.id);
        }
      });
      return next;
    });
  }

  function cancelSelection() {
    setIsSelectionMode(false);
    setSelectedRecordIds(new Set());
  }

  async function downloadSelectedRecords() {
    if (downloadableSelectedRecords.length === 0 || isBulkDownloading) return;
    setIsBulkDownloading(true);
    try {
      const zipBlob = await createZipBlob(
        downloadableSelectedRecords.map((record) => ({
          name: recordFilename(record),
          blob: record.imageBlob!,
          date: record.finishedAt || record.createdAt,
        })),
      );
      const url = URL.createObjectURL(zipBlob);
      downloadUrl(url, `image-studio-selected-${formatFileDate()}.zip`);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setIsBulkDownloading(false);
    }
  }

  function requestBulkDelete() {
    const ids = selectedRecords
      .filter((record) => record.status === "success" || record.status === "error")
      .map((record) => record.id);
    if (ids.length === 0) return;
    setPendingDeleteIds(ids);
  }

  async function confirmBulkDelete() {
    if (!pendingDeleteIds || pendingDeleteIds.length === 0) return;
    const deleteIdSet = new Set(pendingDeleteIds);
    const recordsToDelete = visibleRecords.filter((record) => deleteIdSet.has(record.id));
    const storedIds = recordsToDelete
      .filter((record) => record.status === "success" || record.status === "error")
      .map((record) => record.id);

    pendingQueueRef.current = pendingQueueRef.current.filter((item) => !deleteIdSet.has(item.job.id));
    syncQueueStats();
    await Promise.all(storedIds.map((id) => deleteHistoryRecord(id)));

    setSidebarRecords((current) => {
      current.forEach((record) => {
        if (deleteIdSet.has(record.id) && record.objectUrl) URL.revokeObjectURL(record.objectUrl);
        if (deleteIdSet.has(record.id) && record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
      });
      return current.filter((record) => !deleteIdSet.has(record.id));
    });
    setVisibleRecords((current) => {
      current.forEach((record) => {
        if (deleteIdSet.has(record.id) && record.imageUrl) URL.revokeObjectURL(record.imageUrl);
        if (deleteIdSet.has(record.id) && record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
      });
      return current.filter((record) => !deleteIdSet.has(record.id));
    });
    setSelectedRecordIds(new Set());
    setIsSelectionMode(false);
    setPendingDeleteIds(null);
    setHighlightedRecordId((current) => (deleteIdSet.has(current) ? "" : current));
  }

  async function clearFailedRecords() {
    const storedFailedIds = await deleteFailedHistoryRecords();
    const failedIds = new Set(storedFailedIds);
    visibleRecords.forEach((record) => {
      if (record.status === "error") failedIds.add(record.id);
    });
    sidebarRecords.forEach((record) => {
      if (record.status === "error") failedIds.add(record.id);
    });
    if (failedIds.size === 0) return;

    setSidebarRecords((current) => {
      current.forEach((record) => {
        if (failedIds.has(record.id) && record.objectUrl) URL.revokeObjectURL(record.objectUrl);
        if (failedIds.has(record.id) && record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
      });
      return current.filter((record) => !failedIds.has(record.id) && record.status !== "error");
    });
    setVisibleRecords((current) => {
      current.forEach((record) => {
        if ((failedIds.has(record.id) || record.status === "error") && record.imageUrl) {
          URL.revokeObjectURL(record.imageUrl);
          if (record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
        }
      });
      return current.filter((record) => !failedIds.has(record.id) && record.status !== "error");
    });
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      failedIds.forEach((id) => next.delete(id));
      return next;
    });
    setHighlightedRecordId((current) => (failedIds.has(current) ? "" : current));
  }

  async function handleFiles(files: FileList | File[]) {
    const incomingFiles = Array.from(files);
    if (incomingFiles.length === 0) return;
    cancelAnalysisCountdown();
    clearAgentModeDrafts();
    setIsComposerCollapsed(false);
    const nextImages = await Promise.all(incomingFiles.slice(0, REFERENCE_LIMIT).map(fileToReference));
    setReferenceImages((current) => [...current, ...nextImages].slice(0, REFERENCE_LIMIT));
  }

  // ── 配方快照（roadmap PRD B2）：命名的 prompt + params 组合，只存本机 IndexedDB ──
  async function refreshRecipes() {
    try { setRecipes(await listRecipes()); } catch { /* IDB 不可用时静默降级 */ }
  }

  async function saveCurrentAsRecipe() {
    const trimmed = prompt.trim();
    if (!trimmed) { showAppNotice("先写好提示词再存配方"); return; }
    // 注意：组件内 prompt 是 state，浏览器对话框必须写 window.prompt
    const name = window.prompt("配方名称", trimmed.replace(/\s+/g, " ").slice(0, 20));
    if (!name || !name.trim()) return;
    try {
      await saveRecipe({
        id: uid(),
        name: name.trim().slice(0, 40),
        prompt: trimmed,
        model: selectedModel,
        params,
        createdAt: Date.now(),
      });
      await refreshRecipes();
      showAppNotice("配方已保存（仅存本机浏览器）");
    } catch {
      showAppNotice("配方保存失败");
    }
  }

  function applyRecipe(recipe: Recipe) {
    setPrompt(recipe.prompt);
    if (isAllowedImageModel(recipe.model)) setSelectedModel(recipe.model);
    setParams((current) => ({ ...current, ...recipe.params }));
    showAppNotice(`已应用配方「${recipe.name}」`);
  }

  async function deleteRecipeById(id: string) {
    try {
      await idbDelete(RECIPES_STORE, id);
      await refreshRecipes();
    } catch { /* 忽略 */ }
  }

  function exportRecipes() {
    const blob = new Blob([JSON.stringify(recipes, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `imagehub-recipes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── 参考图库（roadmap PRD B3）：只存本机 IndexedDB，服务端仍是 10 分钟内存 TTL ──
  async function refreshReferenceLibrary() {
    try { setReferenceLibrary(await listReferenceLibrary()); } catch { /* 忽略 */ }
  }

  async function addReferenceToLibrary(image: UploadedReference) {
    try {
      const blob = await (await fetch(image.dataUrl)).blob();
      await saveReferenceLibraryItem({
        id: uid(),
        name: image.name || "参考图",
        blob,
        mime: blob.type || image.type,
        bytes: blob.size,
        createdAt: Date.now(),
      });
      await refreshReferenceLibrary();
      showAppNotice("已收藏到参考图库（仅存本机浏览器）");
    } catch (error) {
      showAppNotice(error instanceof Error ? error.message : "收藏失败");
    }
  }

  async function useLibraryItem(item: ReferenceLibraryItem) {
    await handleFiles([new File([item.blob], item.name, { type: item.mime })]);
    setIsRefLibraryOpen(false);
  }

  async function deleteLibraryItem(id: string) {
    try {
      await idbDelete(REFERENCE_LIBRARY_STORE, id);
      await refreshReferenceLibrary();
    } catch { /* 忽略 */ }
  }

  function onReferenceInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void handleFiles(event.target.files);
    event.target.value = "";
  }

  function onComposerDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleFiles(event.dataTransfer.files);
  }

  function apiLogSnapshot(config = apiConfig) {
    return {
      protocol: config.protocol,
      baseUrl: normalizeApiBaseUrl(config.baseUrl),
      apiKey: maskApiKeyForLog(config.apiKey, config.rememberKey),
    };
  }

  function pushLocalLog(entry: Omit<LocalLogEntry, "id" | "createdAt">) {
    const sanitized: Omit<LocalLogEntry, "id" | "createdAt"> = {
      ...entry,
      params: entry.params ? sanitizeClientLogValue(entry.params) as Record<string, unknown> : entry.params,
      response: entry.response ? sanitizeClientLogValue(entry.response) as Record<string, unknown> : entry.response,
      error: entry.error !== undefined ? sanitizeClientLogValue(entry.error) : entry.error,
    };
    setLocalLogs((current) => {
      const next = [{ id: uid(), createdAt: Date.now(), ...sanitized }, ...current].slice(0, LOCAL_LOG_LIMIT);
      saveLocalLogs(next);
      return next;
    });
  }

  function clearLocalLogs() {
    saveLocalLogs([]);
    setLocalLogs([]);
  }

  function exportLocalDiagnostics() {
    const exportedAt = new Date().toISOString();
    const filename = `image-studio-local-diagnostics-${exportedAt.replace(/[:.]/g, "-")}.json`;
    const refStatusBuckets: Record<ReferenceUploadStatus, number> = {
      none: 0,
      prepared: 0,
      sent_ok: 0,
      sent_failed: 0,
      skipped_unsupported: 0,
    };
    let imageGenLogCount = 0;
    let totalRefBytes = 0;
    for (const log of localLogs) {
      if (log.type !== "image_generation") continue;
      imageGenLogCount += 1;
      if (log.referenceSummary) {
        refStatusBuckets[log.referenceSummary.status] += 1;
        totalRefBytes += log.referenceSummary.totalBytes;
      }
    }
    const visibleSnapshot = visibleRecords.map((record) => ({
      id: record.id,
      requestId: record.requestId,
      batchId: record.batchId,
      index: record.index,
      total: record.total,
      protocol: record.protocol,
      model: record.model,
      promptPreview: record.prompt?.slice(0, 200) || "",
      promptLength: record.prompt?.length || 0,
      params: record.params,
      referenceCount: record.referenceImages?.length ?? 0,
      status: record.status,
      attempt: record.attempt,
      maxAttempts: record.maxAttempts,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      durationMs: record.durationMs,
      errorDetail: record.errorDetail ? sanitizeClientLogValue(record.errorDetail) : undefined,
      agentName: record.agentName,
      promptVariant: record.promptVariant,
    }));
    const payload = {
      exportedAt,
      schemaVersion: 2,
      apiConfig: {
        protocol: apiConfig.protocol,
        baseUrl: apiConfig.baseUrl,
        apiKey: maskApiKeyForLog(apiConfig.apiKey, apiConfig.rememberKey),
      },
      params,
      selectedModel,
      selectedAnalysisModel,
      modelState,
      queueStats,
      summary: {
        localLogs: localLogs.length,
        imageGenerationLogs: imageGenLogCount,
        referenceUploadStatusDistribution: refStatusBuckets,
        totalReferenceBytesSent: totalRefBytes,
        visibleRecords: visibleRecords.length,
        sidebarRecords: sidebarRecords.length,
        retryLimit: params.retryLimit,
      },
      visibleRecords: visibleSnapshot,
      localLogs: localLogs.map((log) => sanitizeClientLogValue(log)),
      currentFrontendVersion: CURRENT_FRONTEND_VERSION,
      availableFrontendVersion,
      userAgent: navigator.userAgent,
      origin: window.location.origin,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function imageRequestParamsForLog(job: Job, config: ApiConfig) {
    return {
      ...apiLogSnapshot(config),
      request: {
        batchId: job.batchId,
        index: job.index,
        total: job.total,
        protocol: job.protocol,
        model: job.model,
        prompt: truncateForLog(job.prompt),
        aspectRatio: job.params.aspectRatio,
        size: job.params.size || resolveRequestSize(job.params.aspectRatio, job.params.resolution, job.protocol, job.model),
        resolution: job.params.resolution,
        quality: job.params.quality,
        outputFormat: job.params.outputFormat,
        seed: job.params.seed,
        negativePrompt: truncateForLog(job.params.negativePrompt || "", 400),
        agentId: job.agentId,
        agentName: job.agentName,
        agentScenario: job.agentScenario,
        promptVariant: job.promptVariant,
        referenceCount: job.referenceImages.length,
        referenceImages: referenceMetaForLog(job.referenceImages),
      },
    };
  }

  async function loadModels({
    silent = false,
    config = apiConfig,
  }: {
    silent?: boolean;
    config?: ApiConfig;
  } = {}): Promise<boolean> {
    const normalizedBaseUrl = normalizeApiBaseUrl(config.baseUrl);
    const modelLoadKey = `${config.protocol}|${normalizedBaseUrl}|${config.apiKey.trim()}`;
    const startedAt = Date.now();
    if (config.apiKey.trim().length < API_KEY_MIN_LENGTH) {
      setVerifiedModelKey("");
      setVerifiedModelAt(0);
      setModels([]);
      setSelectedModel("");
      setAnalysisModels([]);
      setSelectedAnalysisModel("");
      setModelState({ status: "error", message: "请先填写有效的 API Key" });
      pushLocalLog({
        type: "model_load",
        level: "error",
        title: silent ? "自动读取模型失败" : "读取模型失败",
        message: "API Key 为空或长度不足，已阻止请求上游。",
        endpoint: "/api/models",
        durationMs: 0,
        params: apiLogSnapshot(config),
      });
      return false;
    }
    const requestId = modelLoadRequestRef.current + 1;
    modelLoadRequestRef.current = requestId;
    setVerifiedModelKey("");
    setVerifiedModelAt(0);
    if (silent) {
      setIsAutoLoadingModels(true);
      setModelState({ status: "loading", message: "正在自动验证 API Key" });
    } else {
      lastAutoModelLoadKeyRef.current = modelLoadKey;
      setIsAutoLoadingModels(false);
      setModelState({ status: "loading", message: "正在验证 API Key 并读取模型" });
    }
    pushLocalLog({
      type: "model_load",
      level: "info",
      title: silent ? "自动读取模型" : "读取模型列表",
      message: "正在通过 /api/models 验证 API Key 并读取模型列表。",
      endpoint: "/api/models",
      params: apiLogSnapshot(config),
    });
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: config.protocol,
          baseUrl: normalizedBaseUrl,
          apiKey: config.apiKey,
        }),
      });
      const payload = await readApiJson<{ ok?: boolean; models?: string[]; raw?: unknown; detail?: unknown }>(response, "/api/models");
      if (!response.ok || !payload.ok) {
        throw payload.detail || payload;
      }
      if (requestId !== modelLoadRequestRef.current) return false;
      const upstreamModels = Array.isArray(payload.models) ? payload.models : [];
      if (upstreamModels.length === 0) {
        throw new Error("接口返回了空模型列表");
      }
      // 只认上游真实返回的生图模型：把协议默认模型混进来会让「没有生图权限的 Key」
      // 也通过验证，用户点生成才在上游失败
      const nextModels = upstreamImageModels(config.protocol, upstreamModels);
      const nextAnalysisModels = filterAnalysisModels(upstreamModels);
      if (nextModels.length === 0) {
        const allowed = runtimeModelConfig.length > 0
          ? runtimeModelConfig.map((m) => m.displayName || m.id).slice(0, 4).join("、")
          : "gpt-image-2 系列";
        throw new Error(`该 API Key 下没有可用的生图模型（需要 ${allowed} 之一），请更换 Key 或联系服务商开通`);
      }
      const nextSelectedModel = preferModel(nextModels, selectedModel);
      const nextSelectedAnalysisModel = preferAnalysisModel(nextAnalysisModels, selectedAnalysisModel);
      lastAutoModelLoadKeyRef.current = modelLoadKey;
      setVerifiedModelKey(modelLoadKey);
      setVerifiedModelAt(Date.now());
      setModels(nextModels);
      setSelectedModel(nextSelectedModel);
      setAnalysisModels(nextAnalysisModels);
      setSelectedAnalysisModel(nextSelectedAnalysisModel);
      setModelFilter("");
      setModelState({ status: "ready", message: `API Key 有效 · ${nextModels.length} 个图片模型` });
      pushLocalLog({
        type: "model_load",
        level: "success",
        title: silent ? "自动读取模型成功" : "读取模型成功",
        message: `已读取 ${nextModels.length} 个图片模型，选中 ${nextSelectedModel}。`,
        endpoint: "/api/models",
        durationMs: Date.now() - startedAt,
        params: apiLogSnapshot(config),
        response: {
          modelCount: nextModels.length,
          analysisModelCount: nextAnalysisModels.length,
          selectedModel: nextSelectedModel,
          selectedAnalysisModel: nextSelectedAnalysisModel,
        },
      });
      if (silent && showOnboarding && onboardingStep < 2) {
        setOnboardingStep(2);
      }
      return true;
    } catch (error) {
      if (requestId !== modelLoadRequestRef.current) return false;
      setVerifiedModelKey("");
      setVerifiedModelAt(0);
      setModels([]);
      setSelectedModel("");
      setAnalysisModels([]);
      setSelectedAnalysisModel("");
      setModelState({ status: "error", message: modelValidationErrorMessage(error) });
      pushLocalLog({
        type: "model_load",
        level: "error",
        title: silent ? "自动读取模型失败" : "读取模型失败",
        message: modelValidationErrorMessage(error),
        endpoint: "/api/models",
        durationMs: Date.now() - startedAt,
        params: apiLogSnapshot(config),
        error: safeLogError(error),
      });
      return false;
    } finally {
      if (silent) {
        setIsAutoLoadingModels(false);
      }
    }
  }

  async function verifyApiKeyBeforeGeneration() {
    const modelLoadKey = apiConnectionKey(apiConfig);
    const startedAt = Date.now();
    if (apiConfig.apiKey.trim().length < API_KEY_MIN_LENGTH) {
      setVerifiedModelKey("");
      setVerifiedModelAt(0);
      setModels([]);
      setSelectedModel("");
      setAnalysisModels([]);
      setSelectedAnalysisModel("");
      setModelState({ status: "error", message: "请先填写有效的 API Key" });
      pushLocalLog({
        type: "api_health",
        level: "error",
        title: "提交前验证失败",
        message: "API Key 为空或长度不足，已阻止生成。",
        endpoint: "/api/models",
        durationMs: 0,
        params: apiLogSnapshot(),
      });
      return false;
    }

    setIsAutoLoadingModels(false);
    setModelState({ status: "loading", message: "提交前验证 API Key" });
    pushLocalLog({
      type: "api_health",
      level: "info",
      title: "提交前验证 API Key",
      message: "生成前先请求模型列表，避免无效 Key 进入生图链路。",
      endpoint: "/api/models",
      params: apiLogSnapshot(),
    });
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: apiConfig.protocol,
          baseUrl: normalizeApiBaseUrl(apiConfig.baseUrl),
          apiKey: apiConfig.apiKey,
        }),
      });
      const payload = await readApiJson<{ ok?: boolean; models?: string[]; raw?: unknown; detail?: unknown }>(response, "/api/models");
      if (!response.ok || !payload.ok) {
        throw payload.detail || payload;
      }
      const nextModels = imageModelsForProtocol(apiConfig.protocol, Array.isArray(payload.models) ? payload.models : []);
      const nextAnalysisModels = filterAnalysisModels(Array.isArray(payload.models) ? payload.models : []);
      if (nextModels.length === 0) {
        throw new Error("未找到可用的图片模型");
      }
      setVerifiedModelKey(modelLoadKey);
      setVerifiedModelAt(Date.now());
      setModels(nextModels);
      setAnalysisModels(nextAnalysisModels);
      if (!nextModels.includes(selectedModel)) {
        setSelectedModel(preferModel(nextModels, selectedModel));
        setModelState({ status: "ready", message: "模型列表已刷新，请再次点击生成" });
        pushLocalLog({
          type: "api_health",
          level: "warning",
          title: "提交前验证通过但模型已刷新",
          message: "当前选中模型不在最新图片模型列表中，已自动改选，需要用户再次确认生成。",
          endpoint: "/api/models",
          durationMs: Date.now() - startedAt,
          params: apiLogSnapshot(),
          response: {
            modelCount: nextModels.length,
            selectedModel,
            nextSelectedModel: preferModel(nextModels, selectedModel),
          },
        });
        return false;
      }
      setModelState({ status: "ready", message: `API Key 有效 · ${nextModels.length} 个图片模型` });
      pushLocalLog({
        type: "api_health",
        level: "success",
        title: "提交前验证通过",
        message: `API Key 可用，已确认 ${nextModels.length} 个图片模型。`,
        endpoint: "/api/models",
        durationMs: Date.now() - startedAt,
        params: apiLogSnapshot(),
        response: {
          modelCount: nextModels.length,
          selectedModel,
        },
      });
      return true;
    } catch (error) {
      setVerifiedModelKey("");
      setVerifiedModelAt(0);
      setModels([]);
      setSelectedModel("");
      setAnalysisModels([]);
      setSelectedAnalysisModel("");
      setModelState({ status: "error", message: modelValidationErrorMessage(error) });
      pushLocalLog({
        type: "api_health",
        level: "error",
        title: "提交前验证失败",
        message: modelValidationErrorMessage(error),
        endpoint: "/api/models",
        durationMs: Date.now() - startedAt,
        params: apiLogSnapshot(),
        error: safeLogError(error),
      });
      return false;
    }
  }

  async function generateSingle(job: Job, config: ApiConfig) {
    const startedAt = Date.now();
    const plannedRequestId = job.requestId || uid();
    let requestParamsForLog: Record<string, unknown> = imageRequestParamsForLog(job, config);
    patchVisibleRecord(job.id, {
      requestId: plannedRequestId,
      status: "submitting",
      startedAt,
      durationMs: 0,
      errorDetail: undefined,
    });

    const protocolSupportsRefs = getProtocolDefinition(job.protocol).supportsReferenceImages;
    const userRefsCount = job.referenceImages.length;
    let preparedSummary: ReferenceSummary;
    if (userRefsCount === 0) {
      preparedSummary = { hasReferences: false, count: 0, totalBytes: 0, status: "none" };
    } else if (!protocolSupportsRefs) {
      preparedSummary = {
        hasReferences: true,
        count: userRefsCount,
        totalBytes: 0,
        status: "skipped_unsupported",
        unsupportedReason: `当前协议 ${job.protocol} 不支持参考图`,
      };
    } else {
      preparedSummary = {
        hasReferences: true,
        count: userRefsCount,
        totalBytes: 0,
        status: "prepared",
      };
    }

    let submittedRefSnapshot: SubmittedReference[] = [];

    try {
      let requestReferenceImages: Awaited<ReturnType<typeof referenceImagesForRequest>> = [];
      if (protocolSupportsRefs && userRefsCount > 0) {
        const prepared = await Promise.all(job.referenceImages.map(prepareReferenceForRequest));
        requestReferenceImages = prepared.map((image) => ({
          name: image.name,
          type: image.type,
          dataUrl: image.dataUrl,
        }));
        submittedRefSnapshot = prepared.map((image) => ({
          name: image.name,
          type: image.type,
          dataUrl: image.dataUrl,
          originalBytes: image.originalBytes,
          requestBytes: image.requestBytes,
          compressed: image.compressed,
        }));
        preparedSummary = {
          hasReferences: true,
          count: prepared.length,
          totalBytes: prepared.reduce((sum, image) => sum + image.requestBytes, 0),
          status: "prepared",
          items: prepared.map((image) => ({
            name: image.name,
            type: image.type,
            originalBytes: image.originalBytes,
            requestBytes: image.requestBytes,
            compressed: image.compressed,
          })),
        };
        patchVisibleRecord(job.id, { submittedReferenceImages: submittedRefSnapshot });
      }
      requestParamsForLog = {
        ...requestParamsForLog,
        request: {
          ...(requestParamsForLog.request as Record<string, unknown>),
          preparedReferenceImages: preparedReferenceMetaForLog(requestReferenceImages),
          preparedReferenceTotalBytes: preparedSummary.totalBytes,
          referenceSummary: preparedSummary,
        },
      };
      const startMessage = describeReferenceForLog(preparedSummary, job.model);
      pushLocalLog({
        type: "image_generation",
        level: "info",
        title: `开始生成图片 #${job.index}/${job.total}${preparedSummary.hasReferences ? ` · 参考图 ${preparedSummary.count} 张` : " · 无参考图"}`,
        message: startMessage,
        endpoint: "/api/images/generate",
        referenceSummary: preparedSummary,
        params: requestParamsForLog,
      });

      const clientId = getClientId();
      const submissionBody: GenerationSubmissionBody = {
        baseUrl: normalizeApiBaseUrl(config.baseUrl),
        apiKey: config.apiKey,
        clientId,
        requestId: plannedRequestId,
        trace: {
          surface: "studio",
          localRecordId: job.id,
          submittedAt: job.createdAt,
        },
        request: {
          batchId: job.batchId,
          index: job.index,
          total: job.total,
          protocol: job.protocol,
          model: job.model,
          prompt: job.prompt,
          aspectRatio: job.params.aspectRatio,
          size: job.params.size || resolveRequestSize(job.params.aspectRatio, job.params.resolution, job.protocol, job.model),
          resolution: job.params.resolution,
          quality: job.params.quality,
          outputFormat: job.params.outputFormat,
          seed: job.params.seed,
          negativePrompt: job.params.negativePrompt,
          agentId: job.agentId,
          agentName: job.agentName,
          agentScenario: job.agentScenario,
          promptVariant: job.promptVariant,
          referenceImages: requestReferenceImages,
        },
      };

      // requestId 和完整任务快照必须在 POST 之前持久化。这样 202 丢失时，
      // 刷新页面仍能按同一个 ID 对账，而不是创建第二个收费任务。
      await saveHistoryRecord(storedRecordForJob(job, {
        requestId: plannedRequestId,
        submittedReferenceImages: submittedRefSnapshot.length > 0 ? submittedRefSnapshot : undefined,
        status: "submitting",
        startedAt,
        durationMs: 0,
      }));
      const persistedAt = Date.now();
      submissionBody.trace = {
        ...submissionBody.trace!,
        persistedAt,
      };
      void reportGenerationClientEvent({
        requestId: plannedRequestId,
        clientId,
        phase: "client_persisted",
        occurredAt: persistedAt,
        surface: "studio",
        localRecordId: job.id,
        detail: "任务快照已写入 IndexedDB，允许发送 POST",
      });
      pushLocalLog({
        type: "image_generation",
        level: "info",
        title: `任务快照已保存 #${job.index}/${job.total}`,
        message: "requestId 与完整生成参数已落盘，正在发送生成请求。",
        endpoint: "/api/images/generate",
        requestId: plannedRequestId,
        durationMs: persistedAt - startedAt,
        params: requestParamsForLog,
        response: { phase: "client_persisted", persistedAt },
      });

      const submission = await submitGenerationTask(submissionBody);
      const acceptedRequestId = submission.requestId || plannedRequestId;
      const acceptedStatus: JobStatus =
        submission.status === "queued" || submission.status === "running"
          ? submission.status
          : "submitting";
      // 入队成功：记录转入「排队中」并落库。此后不再等待图片——
      // 服务端在后台执行，由 useTaskReconcile 轮询把结果取回来。
      patchVisibleRecord(job.id, {
        requestId: acceptedRequestId,
        status: acceptedStatus,
        startedAt,
        stages: submission.stages,
      });
      await saveHistoryRecord(storedRecordForJob(job, {
        requestId: acceptedRequestId,
        submittedReferenceImages: submittedRefSnapshot.length > 0 ? submittedRefSnapshot : undefined,
        status: acceptedStatus,
        startedAt,
        stages: submission.stages,
      }));
      pushLocalLog({
        type: "image_generation",
        level: "info",
        title: `服务端已接单 #${job.index}/${job.total}`,
        message: submission.idempotent
          ? "已通过同一 requestId 接管服务端已有任务，等待后台生成结果。"
          : "已收到接单响应，任务正在服务端排队或生成。",
        endpoint: "/api/images/generate",
        requestId: acceptedRequestId,
        durationMs: Date.now() - startedAt,
        referenceSummary: preparedSummary,
        params: requestParamsForLog,
        response: {
          ok: true,
          status: submission.status,
          idempotent: submission.idempotent,
          stages: submission.stages,
        },
      });
      return;

    } catch (error) {
      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;
      const submissionError = error instanceof GenerationSubmissionError ? error : null;
      const rawErrorDetail = submissionError
        ? submissionError.detail
        : error instanceof Error
          ? { error: error.message }
          : error;
      const errorDetail = rawErrorDetail && typeof rawErrorDetail === "object"
        ? { ...rawErrorDetail as Record<string, unknown>, requestId: plannedRequestId }
        : { error: rawErrorDetail, requestId: plannedRequestId };
      const requestId = submissionError?.requestId || plannedRequestId;
      const attempt = job.attempt ?? 1;
      const maxAttempts = job.maxAttempts ?? 1;

      if (submissionError?.ambiguous) {
        const confirmingDetail = {
          ...errorDetail,
          error: "提交状态确认中：网络响应丢失，系统会继续用同一 requestId 对账",
        };
        patchVisibleRecord(job.id, {
          requestId,
          status: "submitting",
          errorDetail: confirmingDetail,
          startedAt,
          finishedAt: undefined,
          durationMs: undefined,
        });
        await saveHistoryRecord(storedRecordForJob(job, {
          requestId,
          submittedReferenceImages: submittedRefSnapshot.length > 0 ? submittedRefSnapshot : undefined,
          status: "submitting",
          startedAt,
          finishedAt: undefined,
          durationMs: undefined,
          errorDetail: confirmingDetail,
        }));
        pushLocalLog({
          type: "image_generation",
          level: "warning",
          title: `提交状态确认中 #${job.index}/${job.total}`,
          message: "连接中断后仍无法确认接单结果；已保留原 requestId，后台对账不会创建第二个任务。",
          endpoint: "/api/images/generate",
          requestId,
          durationMs,
          referenceSummary: preparedSummary,
          params: requestParamsForLog,
          response: { ok: false, requestId, ambiguous: true },
        });
        return;
      }

      const canRetry = attempt < maxAttempts && isRetryableError(errorDetail);
      if (canRetry) {
        const nextAttempt = attempt + 1;
        const backoffMs = Math.min(8000, 500 * Math.pow(2, attempt - 1));
        const retrySummary: ReferenceSummary = preparedSummary.hasReferences && preparedSummary.status === "prepared"
          ? { ...preparedSummary, status: "sent_failed" }
          : preparedSummary;
        pushLocalLog({
          type: "image_generation",
          level: "warning",
          title: `图片生成失败 #${job.index}/${job.total}，${Math.round(backoffMs / 1000)}s 后重试 (${nextAttempt}/${maxAttempts})${retrySummary.hasReferences ? ` · 参考图 ${retrySummary.count} 张` : ""}`,
          message: formatError(errorDetail),
          endpoint: "/api/images/generate",
          requestId,
          durationMs,
          referenceSummary: retrySummary,
          params: requestParamsForLog,
          response: {
            ok: false,
            requestId,
            detail: sanitizeClientLogValue(errorDetail),
            retry: { attempt, nextAttempt, maxAttempts, backoffMs },
          },
          error: safeLogError(errorDetail),
        });
        patchVisibleRecord(job.id, {
          requestId,
          status: "queued",
          errorDetail,
          startedAt: undefined,
          finishedAt: undefined,
          durationMs: undefined,
          attempt: nextAttempt,
          maxAttempts,
        });
        const retryJob: Job = {
          ...job,
          requestId,
          submittedReferenceImages: submittedRefSnapshot.length > 0
            ? submittedRefSnapshot
            : job.submittedReferenceImages,
          attempt: nextAttempt,
          maxAttempts,
          status: "queued",
        };
        await saveHistoryRecord(storedRecordForJob(retryJob, {
          status: "queued",
          startedAt: undefined,
          finishedAt: undefined,
          durationMs: undefined,
          errorDetail,
        }));
        window.setTimeout(() => {
          enqueueJobs([retryJob], config);
        }, backoffMs);
        return;
      }
      const failedSummary: ReferenceSummary = preparedSummary.hasReferences && preparedSummary.status === "prepared"
        ? { ...preparedSummary, status: "sent_failed" }
        : preparedSummary;
      pushLocalLog({
        type: "image_generation",
        level: "error",
        title: `图片生成失败 #${job.index}/${job.total}${attempt > 1 ? `（已重试 ${attempt - 1} 次）` : ""}${failedSummary.hasReferences ? ` · 参考图 ${failedSummary.count} 张` : " · 无参考图"}`,
        message: formatError(errorDetail),
        endpoint: "/api/images/generate",
        requestId,
        durationMs,
        referenceSummary: failedSummary,
        params: requestParamsForLog,
        response: {
          ok: false,
          requestId,
          detail: sanitizeClientLogValue(errorDetail),
          retry: { attempt, maxAttempts, exhausted: true },
        },
        error: safeLogError(errorDetail),
      });
      void reportGenerationClientEvent({
        requestId,
        clientId: getClientId(),
        phase: "client_error_received",
        occurredAt: finishedAt,
        surface: "studio",
        localRecordId: job.id,
        detail: formatError(errorDetail),
      });
      const errorStages = errorDetail && typeof errorDetail === "object" && "stages" in errorDetail
        ? (errorDetail as { stages?: JobStages }).stages
        : undefined;
      patchVisibleRecord(job.id, { requestId, status: "error", errorDetail, startedAt, finishedAt, durationMs, stages: errorStages });
      const historyRecord = storedRecordForJob(job, {
        requestId,
        submittedReferenceImages: submittedRefSnapshot.length > 0 ? submittedRefSnapshot : undefined,
        status: "error",
        startedAt,
        finishedAt,
        durationMs,
        stages: errorStages,
        errorDetail,
      });
      await saveHistoryRecord(historyRecord);
      setSidebarRecords((current) => mergeHistoryRecords(current, [{
        ...historyRecord,
        referenceImages: normalizeStoredReferenceImages(historyRecord.referenceImages),
      }]));
    }
  }

  function analysisFallback(
    mode: AnalysisMode,
    promptText = prompt.trim(),
    analysisParams = params,
    analysisReferences = referenceImages,
  ) {
    const usableAnalysisReferences = analysisReferences.filter(isReferenceUsable);
    return buildLocalPromptAnalysis({
      promptText,
      params: analysisParams,
      protocol: apiConfig.protocol,
      selectedModel,
      referenceImages: analysisReferences,
      usableReferenceImages: usableAnalysisReferences,
      mode,
    });
  }

  async function runPromptAnalysis(
    mode: AnalysisMode,
    promptText = prompt.trim(),
    analysisParams = params,
    agentContext?: AgentContext,
    analysisReferences = referenceImages,
  ) {
    const usableAnalysisReferences = analysisReferences.filter(isReferenceUsable);
    const fallback = analysisFallback(mode, promptText, analysisParams, analysisReferences);
    const analysisModel = preferAnalysisModel(analysisModels, selectedAnalysisModel);
    if (!analysisModel || !apiConfig.apiKey.trim()) {
      pushLocalLog({
        type: "prompt_analysis",
        level: "warning",
        title: "提示词分析使用本地预检",
        message: analysisModel ? "未配置 API Key，未请求 AI 分析接口。" : "未检测到可用分析模型，未请求 AI 分析接口。",
        endpoint: "/api/prompt/analyze",
        params: {
          ...apiLogSnapshot(),
          mode,
          prompt: truncateForLog(promptText),
          referenceCount: usableAnalysisReferences.length,
        },
      });
      return {
        ...fallback,
        analysisModel: analysisModel || "本地预检",
        source: "local" as const,
        summary: analysisModel
          ? "未配置 API Key，已先用本地规则完成预检。"
          : "未检测到 GPT 分析模型，已先用本地规则完成预检。",
      };
    }

    const startedAt = Date.now();
    const requestParamsForLog = {
      ...apiLogSnapshot(),
      analysisModel,
      prompt: truncateForLog(promptText),
      negativePrompt: truncateForLog(analysisParams.negativePrompt || "", 400),
      aspectRatio: analysisParams.aspectRatio,
      size: analysisParams.size || resolveRequestSize(analysisParams.aspectRatio, analysisParams.resolution, apiConfig.protocol, selectedModel),
      resolution: analysisParams.resolution,
      quality: analysisParams.quality,
      outputFormat: analysisParams.outputFormat,
      count: analysisParams.batchCount,
      concurrency: analysisParams.concurrency,
      referenceCount: usableAnalysisReferences.length,
      referenceIssues: analysisReferences
        .filter((image) => image.status && image.status !== "ready")
        .map((image) => ({ name: image.name, status: image.status, message: image.message })),
      protocol: apiConfig.protocol,
      imageModel: selectedModel,
      mode,
      agentId: agentContext?.plan.agentId,
      agentName: agentContext?.plan.agentName,
      agentScenario: agentContext?.plan.scenario,
      promptVariant: agentContext?.variant,
    };
    pushLocalLog({
      type: "prompt_analysis",
      level: "info",
      title: "开始提示词分析",
      message: `使用 ${analysisModel} 做 ${analysisModeLabel(mode)}。`,
      endpoint: "/api/prompt/analyze",
      params: requestParamsForLog,
    });
    try {
      const response = await fetch("/api/prompt/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
        baseUrl: normalizeApiBaseUrl(apiConfig.baseUrl),
        apiKey: apiConfig.apiKey,
        clientId: getClientId(),
        analysisModel,
        prompt: promptText,
        negativePrompt: analysisParams.negativePrompt,
        aspectRatio: analysisParams.aspectRatio,
        size: analysisParams.size || resolveRequestSize(analysisParams.aspectRatio, analysisParams.resolution, apiConfig.protocol, selectedModel),
        resolution: analysisParams.resolution,
        quality: analysisParams.quality,
        outputFormat: analysisParams.outputFormat,
        count: analysisParams.batchCount,
        concurrency: analysisParams.concurrency,
        referenceCount: usableAnalysisReferences.length,
        referenceIssues: analysisReferences
          .filter((image) => image.status && image.status !== "ready")
          .map((image) => ({ name: image.name, status: image.status, message: image.message })),
        protocol: apiConfig.protocol,
        imageModel: selectedModel,
        mode,
        agentId: agentContext?.plan.agentId,
        agentName: agentContext?.plan.agentName,
        agentScenario: agentContext?.plan.scenario,
        promptVariant: agentContext?.variant,
        }),
      });

      // 后端可能仍然走非流式（旧版兜底）
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const payload = await readApiJson<{ ok?: boolean; requestId?: string; analysis?: unknown; detail?: unknown }>(response, "/api/prompt/analyze");
        if (!response.ok || !payload.ok) {
          throw payload.detail || payload;
        }
        const result = normalizePromptAnalysisResult(payload.analysis, {
          ...fallback,
          analysisModel,
          source: "ai",
        });
        pushLocalLog({
          type: "prompt_analysis",
          level: "success",
          title: "提示词分析完成（非流式）",
          message: result.summary,
          endpoint: "/api/prompt/analyze",
          requestId: payload.requestId,
          durationMs: Date.now() - startedAt,
          params: requestParamsForLog,
          response: {
            score: result.score,
            riskLevel: result.riskLevel,
            safe: result.safe,
            source: result.source,
            analysis: sanitizeClientLogValue(result),
          },
        });
        return result;
      }

      if (!response.body) throw new Error("分析响应体为空");
      if (!response.ok) {
        const errorText = await response.text();
        throw { error: `HTTP ${response.status}`, raw: truncateForLog(errorText, 1600) };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let analysis: unknown = null;
      let upstreamRequestId: string | undefined;
      let chunkCount = 0;
      let firstByteAt: number | undefined;
      let receivingAt: number | undefined;
      let lastError: unknown = null;
      let totalLength = 0;
      let streamPreview = "";

      const flushFrame = (event: string, data: unknown) => {
        switch (event) {
          case "started":
            upstreamRequestId = (data as { requestId?: string })?.requestId;
            setAnalysisState((current) => ({ ...current, status: "analyzing", message: "已发送，等待模型响应..." }));
            break;
          case "upstream_connected":
            firstByteAt = Date.now();
            setAnalysisState((current) => ({ ...current, status: "analyzing", message: "上游已连接，等待模型生成..." }));
            break;
          case "receiving":
            receivingAt = Date.now();
            setAnalysisState((current) => ({
              ...current,
              status: "receiving",
              message: "正在接收结果...",
            }));
            break;
          case "chunk":
            chunkCount += 1;
            totalLength = (data as { totalLength?: number })?.totalLength ?? totalLength;
            streamPreview = typeof (data as { preview?: unknown })?.preview === "string"
              ? ((data as { preview?: string }).preview || "")
              : streamPreview;
            setAnalysisState((current) => current.status === "receiving"
              ? {
                ...current,
                message: `接收中... 已 ${totalLength} 字符`,
                streamPreview,
                streamCharacters: totalLength,
                streamChunks: chunkCount,
              }
              : current);
            break;
          case "done":
            analysis = (data as { analysis?: unknown })?.analysis ?? null;
            break;
          case "error":
            lastError = (data as { detail?: unknown })?.detail ?? data;
            break;
        }
      };

      // 解析 SSE 帧
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const lines = frame.split("\n");
            let eventName = "message";
            const dataParts: string[] = [];
            for (const line of lines) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) dataParts.push(line.slice(5).trim());
            }
            if (dataParts.length === 0) continue;
            const dataStr = dataParts.join("\n");
            let data: unknown = dataStr;
            try { data = JSON.parse(dataStr); } catch { /* leave as string */ }
            flushFrame(eventName, data);
          }
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }

      if (lastError) throw lastError;
      if (!analysis) throw new Error("分析流结束但未收到 done 事件");

      const result = normalizePromptAnalysisResult(analysis, {
        ...fallback,
        analysisModel,
        source: "ai",
      });
      const totalMs = Date.now() - startedAt;
      pushLocalLog({
        type: "prompt_analysis",
        level: "success",
        title: "提示词分析完成（流式）",
        message: result.summary,
        endpoint: "/api/prompt/analyze",
        requestId: upstreamRequestId,
        durationMs: totalMs,
        params: requestParamsForLog,
        response: {
          score: result.score,
          riskLevel: result.riskLevel,
          safe: result.safe,
          source: result.source,
          stream: {
            chunkCount,
            totalLength,
            firstByteMs: firstByteAt ? firstByteAt - startedAt : null,
            receivingMs: receivingAt ? receivingAt - startedAt : null,
            totalMs,
          },
          analysis: sanitizeClientLogValue(result),
        },
      });
      return result;
    } catch (error) {
      pushLocalLog({
        type: "prompt_analysis",
        level: "error",
        title: "提示词分析失败",
        message: formatError(error),
        endpoint: "/api/prompt/analyze",
        durationMs: Date.now() - startedAt,
        params: requestParamsForLog,
        error: safeLogError(error),
        response: {
          phase: "stream_error",
          rawDetail: sanitizeClientLogValue(error),
        },
      });
      throw error;
    }
  }

  function triggerSendLaunchAnimation() {
    if (sendLaunchFrameRef.current) {
      window.cancelAnimationFrame(sendLaunchFrameRef.current);
    }
    if (sendLaunchTimerRef.current) {
      window.clearTimeout(sendLaunchTimerRef.current);
    }
    setIsSendLaunching(false);
    sendLaunchFrameRef.current = window.requestAnimationFrame(() => {
      setIsSendLaunching(true);
      sendLaunchTimerRef.current = window.setTimeout(() => setIsSendLaunching(false), 760);
    });
  }

  function buildParamsFromAnalysis(
    result: PromptAnalysisResult,
    applyRecommendedParams = true,
    baseParams = params,
  ) {
    const nextResolution = normalizeResolutionForRequest(
      applyRecommendedParams && result.suggestedParams.resolution
        ? safeImageResolution(result.suggestedParams.resolution)
        : safeImageResolution(baseParams.resolution),
      apiConfig.protocol,
      selectedModel,
    );
    const suggestedRatio = result.suggestedParams.aspectRatio || baseParams.aspectRatio;
    const fallbackRatio =
      getSupportedAspectRatios(apiConfig.protocol, selectedModel, nextResolution)[0] || baseParams.aspectRatio;
    const nextRatio = applyRecommendedParams && isAspectRatioSupported(
      apiConfig.protocol,
      suggestedRatio,
      selectedModel,
      nextResolution,
    )
      ? suggestedRatio
      : fallbackRatio;
    return {
      ...baseParams,
      aspectRatio: nextRatio,
      resolution: nextResolution,
      size: resolveRequestSize(
        nextRatio,
        nextResolution,
        apiConfig.protocol,
        selectedModel,
        result.suggestedParams.size || baseParams.size,
      ),
      quality: applyRecommendedParams && protocolDefinition.supportsQuality && result.suggestedParams.quality
        ? result.suggestedParams.quality
        : baseParams.quality,
      batchCount: applyRecommendedParams && result.suggestedParams.count
        ? clampNumber(Number(result.suggestedParams.count), 1, 20)
        : baseParams.batchCount,
      negativePrompt: applyRecommendedParams && result.suggestedNegativePrompt && !baseParams.negativePrompt.trim()
        ? result.suggestedNegativePrompt
        : baseParams.negativePrompt,
    };
  }

  function applySuggestedParams(result: PromptAnalysisResult) {
    updateParams(buildParamsFromAnalysis(result, true));
  }

  function applyOptimizedPrompt(result: PromptAnalysisResult) {
    setPrompt(result.optimizedPrompt);
    window.requestAnimationFrame(resizePromptTextarea);
  }

  function appendStyleEnhancement(enhancement: StyleEnhancement) {
    setPrompt((current) => `${current.trim()}\n${enhancement.promptFragment}`.trim());
    window.requestAnimationFrame(resizePromptTextarea);
  }

  async function requestPromptAssist(mode: AnalysisMode) {
    const submittedPrompt = prompt.trim();
    if (!submittedPrompt || isPromptAnalyzing) return;
    cancelAnalysisCountdown();
    setShowPromptPresets(false);
    setAnalysisState({
      status: "analyzing",
      mode,
      message: analysisModeLabel(mode),
      streamPreview: "",
      streamCharacters: 0,
      streamChunks: 0,
    });
    try {
      const result = await runPromptAnalysis(mode, submittedPrompt);
      setAnalysisState({
        status: "ready",
        mode,
        message: `${analysisModeLabel(mode)}完成`,
        result,
      });
    } catch (error) {
      setAnalysisState({
        status: "error",
        mode,
        message: `${analysisModeLabel(mode)}失败`,
        error: formatError(error),
      });
    }
  }

  function cancelAnalysisCountdown() {
    if (analysisCountdownTimerRef.current) {
      window.clearInterval(analysisCountdownTimerRef.current);
      analysisCountdownTimerRef.current = undefined;
    }
    setAnalysisCountdown(null);
  }

  function abandonAnalysisCountdown() {
    if (analysisCountdown) {
      setPrompt((current) => current.trim() ? current : analysisCountdown.prompt);
      if (analysisCountdown.referenceImages.length > 0) {
        setReferenceImages((current) => current.length > 0 ? current : analysisCountdown.referenceImages);
      }
      if (analysisCountdown.agentContext && !lastAppliedAgent) {
        setLastAppliedAgent(analysisCountdown.agentContext);
      }
    }
    const abandonedIntent = pendingGenerationIntentRef.current;
    if (abandonedIntent) {
      pendingGenerationIntentRef.current = null;
      void reportGenerationClientEvent({
        requestId: abandonedIntent.requestId,
        clientId: getClientId(),
        phase: "client_submission_rejected",
        occurredAt: Date.now(),
        surface: "studio",
        detail: "用户在发送前分析阶段取消了生成",
      });
    }
    cancelAnalysisCountdown();
    setAnalysisState({ status: "idle", mode: "send", message: "" });
  }

  function startAnalysisCountdown({
    prompt: countdownPrompt,
    params: countdownParams,
    referenceImages: countdownReferenceImages,
    result,
    agentContext,
  }: {
    prompt: string;
    params: ImageParams;
    referenceImages: UploadedReference[];
    result?: PromptAnalysisResult;
    agentContext?: AgentContext;
  }) {
    cancelAnalysisCountdown();
    const runId = uid();
    const label = agentContext
      ? `10 秒后使用 ${agentContext.plan.agentName} · ${PROMPT_VARIANT_LABELS[agentContext.variant]} 自动生成`
      : "10 秒后将按原始提示词自动生成";
    let secondsLeft = 10;
    setAnalysisCountdown({
      runId,
      secondsLeft,
      prompt: countdownPrompt,
      params: countdownParams,
      referenceImages: countdownReferenceImages,
      result,
      agentContext,
      label,
    });
    if (agentContext) setAgentPhase("countdown");
    analysisCountdownTimerRef.current = window.setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        if (analysisCountdownTimerRef.current) {
          window.clearInterval(analysisCountdownTimerRef.current);
          analysisCountdownTimerRef.current = undefined;
        }
        setAnalysisCountdown(null);
        setAnalysisState({ status: "idle", mode: "send", message: "" });
        if (agentContext) setAgentPhase("generating");
        void startBatch(undefined, {
          promptOverride: countdownPrompt,
          paramsOverride: countdownParams,
          referenceImagesOverride: countdownReferenceImages,
          clearReferenceImages: false,
          agentContext,
        });
        return;
      }
      setAnalysisCountdown((current) =>
        current?.runId === runId ? { ...current, secondsLeft } : current,
      );
    }, 1000);
  }

  async function analyzeBeforeGenerate(
    submittedPrompt: string,
    options: { paramsOverride?: ImageParams; referenceImagesOverride?: UploadedReference[]; agentContext?: AgentContext } = {},
  ) {
    const analysisParams = options.paramsOverride || params;
    const analysisReferences = options.referenceImagesOverride || referenceImages;
    setShowPromptPresets(false);
    setAnalysisState({
      status: "analyzing",
      mode: "send",
      message: options.agentContext ? "Agent 行业预检" : "发送前智能检查",
      streamPreview: "",
      streamCharacters: 0,
      streamChunks: 0,
    });
    try {
      const result = await runPromptAnalysis("send", submittedPrompt, analysisParams, options.agentContext, analysisReferences);
      setAnalysisState({
        status: "ready",
        mode: "send",
        message: result.riskLevel === "high" ? "已完成预检，建议先查看风险" : "已完成预检",
        result,
      });
      startAnalysisCountdown({
        prompt: submittedPrompt,
        params: analysisParams,
        referenceImages: analysisReferences,
        result,
        agentContext: options.agentContext,
      });
    } catch (error) {
      const result = {
        ...analysisFallback("send", submittedPrompt, analysisParams, analysisReferences),
        summary: "AI 分析暂时不可用，已降级为本地预检。倒计时结束后仍会按当前提示词生成。",
        analysisModel: "本地预检",
        source: "local" as const,
      };
      setAnalysisState({
        status: "ready",
        mode: "send",
        message: `智能分析失败，已降级处理：${formatError(error)}`,
        result,
      });
      startAnalysisCountdown({
        prompt: submittedPrompt,
        params: analysisParams,
        referenceImages: analysisReferences,
        result,
        agentContext: options.agentContext,
      });
    }
  }

  function continueFromAnalysis({
    useOptimizedPrompt = false,
    applyRecommendedParams = false,
  }: {
    useOptimizedPrompt?: boolean;
    applyRecommendedParams?: boolean;
  } = {}) {
    const result = analysisState.result;
    const countdownContext = analysisCountdown?.agentContext;
    const basePrompt = analysisCountdown?.prompt || prompt.trim();
    const baseParams = analysisCountdown?.params || params;
    const baseReferenceImages = analysisCountdown?.referenceImages || referenceImages;
    const submittedPrompt = useOptimizedPrompt && result?.optimizedPrompt ? result.optimizedPrompt : basePrompt;
    if (!submittedPrompt) return;
    const nextParams = result ? buildParamsFromAnalysis(result, applyRecommendedParams, baseParams) : baseParams;
    if (result && applyRecommendedParams) {
      setParams(nextParams);
    }
    cancelAnalysisCountdown();
    triggerSendLaunchAnimation();
    setAnalysisState({ status: "idle", mode: "send", message: "" });
    if (countdownContext) setAgentPhase("generating");
    void startBatch(undefined, {
      promptOverride: submittedPrompt,
      paramsOverride: nextParams,
      referenceImagesOverride: baseReferenceImages,
      clearReferenceImages: false,
      agentContext: countdownContext,
    });
  }

  async function startBatch(
    event?: FormEvent,
    options: {
      promptOverride?: string;
      paramsOverride?: ImageParams;
      referenceImagesOverride?: UploadedReference[];
      clearReferenceImages?: boolean;
      agentContext?: AgentContext;
    } = {},
  ) {
    event?.preventDefault();
    const batchParams = options.paramsOverride || params;
    const submittedPrompt = (options.promptOverride || prompt).trim();
    if (!submittedPrompt) return;
    const batchResolution = normalizeResolutionForRequest(
      safeImageResolution(batchParams.resolution),
      apiConfig.protocol,
      selectedModel,
    );
    if (
      !selectedModel ||
      !isAllowedImageModel(selectedModel) ||
      !models.includes(selectedModel) ||
      !protocolMatchesImageModel(apiConfig.protocol, selectedModel) ||
      modelState.status !== "ready" ||
      !isAspectRatioSupported(apiConfig.protocol, batchParams.aspectRatio, selectedModel, batchResolution)
    ) {
      return;
    }
    const total = clampNumber(Number(batchParams.batchCount), 1, 20);
    const concurrency = clampNumber(Number(batchParams.concurrency), 1, 6);
    const batchId = uid();
    const batchCreatedAt = Date.now();
    const pendingIntent = pendingGenerationIntentRef.current;
    pendingGenerationIntentRef.current = null;
    const snapshotConfig = { ...apiConfig };
    const snapshotParams = {
      ...batchParams,
      batchCount: total,
      concurrency,
      resolution: batchResolution,
      size: resolveRequestSize(
        batchParams.aspectRatio,
        batchResolution,
        apiConfig.protocol,
        selectedModel,
        batchParams.size,
      ),
    };
    const candidateReferenceImages = options.referenceImagesOverride ?? usableReferenceImages;
    const snapshotReferenceImages = getProtocolDefinition(apiConfig.protocol).supportsReferenceImages
      ? candidateReferenceImages.filter(isReferenceUsable)
      : [];
    const nextJobs = Array.from({ length: total }, (_, index) => {
      const job = createJob(
        index + 1,
        total,
        batchId,
        apiConfig.protocol,
        submittedPrompt,
        selectedModel,
        snapshotParams,
        snapshotReferenceImages,
        (pendingIntent?.submittedAt || batchCreatedAt) - index / 1000,
        options.agentContext,
      );
      return index === 0 && pendingIntent
        ? {
            ...job,
            requestId: pendingIntent.requestId,
            submissionIntentLogged: true,
          }
        : job;
    });
    setHighlightedRecordId("");
    setVisibleRecords((current) => sortGenerationRecords([...nextJobs, ...current]));
    enqueueJobs(nextJobs, snapshotConfig);
    if (options.clearReferenceImages !== false) {
      setReferenceImages([]);
    }
  }

  function buildAgentModeJobParams(spec: AgentModeJobSpec, baseParams = params): ImageParams {
    const recommendedRatio = spec.aspectRatio || recommendAspectRatioForPrompt(spec.prompt, baseParams.aspectRatio);
    const resolution = normalizeResolutionForRequest(
      spec.resolution ? safeImageResolution(spec.resolution) : safeImageResolution(baseParams.resolution),
      apiConfig.protocol,
      selectedModel,
    );
    const aspectRatio = isAspectRatioSupported(apiConfig.protocol, recommendedRatio, selectedModel, resolution)
      ? recommendedRatio
      : getSupportedAspectRatios(apiConfig.protocol, selectedModel, resolution)[0] || baseParams.aspectRatio;
    return {
      ...baseParams,
      aspectRatio,
      resolution,
      size: spec.size || resolveRequestSize(aspectRatio, resolution, apiConfig.protocol, selectedModel),
      quality: spec.quality || baseParams.quality,
      batchCount: 1,
      negativePrompt: spec.negativePrompt || baseParams.negativePrompt,
    };
  }

  function enqueueAgentModeJobs(
    specs: AgentModeJobSpec[],
    options: {
      analysisResult: AgentModeAnalysisResult;
      clearComposer?: boolean;
      scenarioLabel?: string;
    },
  ) {
    const expandedSpecs = specs.flatMap((spec) =>
      Array.from({ length: clampNumber(Number(spec.count) || 1, 1, 8) }, () => spec),
    );
    if (expandedSpecs.length === 0) return;
    const snapshotConfig = { ...apiConfig };
    const snapshotReferenceImages = getProtocolDefinition(apiConfig.protocol).supportsReferenceImages
      ? usableReferenceImages
      : [];
    const batchId = uid();
    const batchCreatedAt = Date.now();
    const pendingIntent = pendingGenerationIntentRef.current;
    pendingGenerationIntentRef.current = null;
    const nextJobs = expandedSpecs.map((spec, index) => {
      const baseJob = createJob(
        index + 1,
        expandedSpecs.length,
        batchId,
        apiConfig.protocol,
        spec.prompt,
        selectedModel,
        buildAgentModeJobParams(spec),
        snapshotReferenceImages,
        (pendingIntent?.submittedAt || batchCreatedAt) - index / 1000,
      );
      return {
        ...baseJob,
        ...(index === 0 && pendingIntent ? {
          requestId: pendingIntent.requestId,
          submissionIntentLogged: true,
        } : {}),
        agentId: "agent-mode-a",
        agentName: AGENT_MODE_NAME,
        agentScenario: spec.title || options.scenarioLabel || options.analysisResult.intentType,
      };
    });
    setHighlightedRecordId("");
    setVisibleRecords((current) => sortGenerationRecords([...nextJobs, ...current]));
    enqueueJobs(nextJobs, snapshotConfig);
    setAgentModePendingPlan(null);
    setAgentModeBrochureDraft(null);
    setAgentModeState({ status: "idle", message: "" });
    if (options.clearComposer !== false) {
      setPrompt("");
      setReferenceImages([]);
      setLastAppliedAgent(null);
    }
  }

  function buildBrochureStyleBoardPrompt(project: AgentModeBrochureProject, direction: string, boardIndex: number) {
    const outlineText = project.outline
      .slice(0, 12)
      .map((page) => `${page.pageNo}. ${page.title}：${page.objective}`)
      .join("；");
    const company = project.companyName || project.title;
    const industry = project.industry || "企业品牌";
    const purpose = project.purpose || "公司宣传";
    return [
      `为「${company}」设计一张公司宣传画册模板板。`,
      `项目类型：${industry} 行业的 ${purpose} 画册，共 ${project.pageCount} 页。`,
      "请输出一张整本方案图，在同一张图中展示封面和全部内页的缩略版式，不需要真实小字，但必须让页面层级、主视觉和版式节奏清晰可见。",
      `风格方向：${direction}。`,
      `页面结构：${outlineText}。`,
      "要求整本风格统一、封面辨识度高、内页节奏分明、适合商务宣传画册模板探索，像设计提案板而不是最终可印刷文件。",
      `这是第 ${boardIndex + 1} 套候选方向，请拉开与其他方案的视觉差异。`,
    ].join(" ");
  }

  function submitBrochureStyleBoards(project: AgentModeBrochureProject) {
    const styleDirections = project.styleDirections.length > 0
      ? project.styleDirections.slice(0, 4)
      : ["科技蓝信息栅格", "高端杂志感", "制造业目录感", "招商海报感"];
    const specs = styleDirections.map((direction, index) => ({
      id: `brochure-style-${index + 1}`,
      title: `模板板 ${index + 1} · ${direction}`,
      prompt: buildBrochureStyleBoardPrompt(project, direction, index),
      aspectRatio: "4:3",
      resolution: "2K" as ImageResolution,
      quality: "high",
      count: 1,
    }));
    enqueueAgentModeJobs(specs, {
      analysisResult: {
        intentType: "brochure_project",
        confidence: 1,
        reasoningSummary: project.summary,
        estimatedCostLevel: "medium",
        requiresConfirmation: true,
        autoExecute: false,
        jobs: specs,
        brochureProject: project,
        source: "local",
      },
      clearComposer: false,
      scenarioLabel: "宣传画册模板板",
    });
  }

  function applyAgentModeAnalysisResult(
    result: AgentModeAnalysisResult,
    requestId: string | undefined,
    submittedPrompt: string,
  ) {
    if (result.intentType === "brochure_project" && result.brochureProject) {
      setAgentModePendingPlan(null);
      setAgentModeBrochureDraft(result.brochureProject);
      setAgentModeState({
        status: "planned",
        message: "已识别为宣传画册任务，请先确认页结构和模板方向。",
        requestId,
        result,
        requestPrompt: submittedPrompt,
      });
      return;
    }
    if (result.requiresConfirmation || result.intentType === "multi_image_batch") {
      setAgentModeBrochureDraft(null);
      setAgentModePendingPlan(result);
      setAgentModeState({
        status: "needs_confirmation",
        message: `已拆解出 ${result.jobs.length} 个独立任务，确认后进入队列。`,
        requestId,
        result,
        requestPrompt: submittedPrompt,
      });
      return;
    }
    enqueueAgentModeJobs(result.jobs, {
      analysisResult: result,
      clearComposer: true,
      scenarioLabel: "自动拆解任务",
    });
  }

  async function requestAgentModeExecution(submittedPrompt: string) {
    const analysisModel = preferredAnalysisModel;
    const requestStartedAt = Date.now();
    const payload = {
      baseUrl: normalizeApiBaseUrl(apiConfig.baseUrl),
      apiKey: apiConfig.apiKey,
      clientId: getClientId(),
      analysisModel,
      prompt: submittedPrompt,
      protocol: apiConfig.protocol,
      imageModel: selectedModel,
      aspectRatio: params.aspectRatio,
      size: params.size || resolveRequestSize(params.aspectRatio, selectedResolution, apiConfig.protocol, selectedModel),
      resolution: selectedResolution,
      quality: params.quality,
      outputFormat: params.outputFormat,
      count: params.batchCount,
      referenceCount: usableReferenceImages.length,
    };
    setAgentModePendingPlan(null);
    setAgentModeBrochureDraft(null);
    setAgentModeState({
      status: "analyzing",
      message: `${AGENT_MODE_NAME} 正在理解你的任务并自动编排。`,
      requestPrompt: submittedPrompt,
      streamPreview: "",
      streamCharacters: 0,
      streamChunks: 0,
    });
    pushLocalLog({
      type: "agent_analysis",
      level: "info",
      title: `${AGENT_MODE_NAME} 开始解析`,
      message: "正在识别单图、多图还是宣传画册任务。",
      endpoint: "/api/agent/analyze",
      params: {
        ...apiLogSnapshot(),
        prompt: truncateForLog(submittedPrompt),
        analysisModel,
        referenceCount: usableReferenceImages.length,
      },
    });
    try {
      const response = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(payload),
      });

      if (!response.ok && response.headers.get("content-type")?.includes("text/event-stream") !== true) {
        const payloadJson = await readApiJson<{ ok?: boolean; requestId?: string; analysis?: unknown; detail?: unknown }>(response, "/api/agent/analyze");
        if (!response.ok || !payloadJson.ok) {
          throw payloadJson.detail || payloadJson;
        }
        const result = normalizeAgentModeAnalysisResult(payloadJson.analysis, submittedPrompt);
        pushLocalLog({
          type: "agent_analysis",
          level: "success",
          title: `${AGENT_MODE_NAME} 解析完成`,
          message: result.reasoningSummary,
          endpoint: "/api/agent/analyze",
          requestId: payloadJson.requestId,
          durationMs: Date.now() - requestStartedAt,
          params: {
            ...apiLogSnapshot(),
            prompt: truncateForLog(submittedPrompt),
          },
          response: sanitizeClientLogValue(result) as Record<string, unknown>,
        });
        applyAgentModeAnalysisResult(result, payloadJson.requestId, submittedPrompt);
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const payloadJson = await readApiJson<{ ok?: boolean; requestId?: string; analysis?: unknown; detail?: unknown }>(response, "/api/agent/analyze");
        if (!response.ok || !payloadJson.ok) {
          throw payloadJson.detail || payloadJson;
        }
        const result = normalizeAgentModeAnalysisResult(payloadJson.analysis, submittedPrompt);
        pushLocalLog({
          type: "agent_analysis",
          level: "success",
          title: `${AGENT_MODE_NAME} 解析完成`,
          message: result.reasoningSummary,
          endpoint: "/api/agent/analyze",
          requestId: payloadJson.requestId,
          durationMs: Date.now() - requestStartedAt,
          params: {
            ...apiLogSnapshot(),
            prompt: truncateForLog(submittedPrompt),
          },
          response: sanitizeClientLogValue(result) as Record<string, unknown>,
        });
        applyAgentModeAnalysisResult(result, payloadJson.requestId, submittedPrompt);
        return;
      }

      if (!response.body) throw new Error("分析响应体为空");
      if (!response.ok) {
        const errorText = await response.text();
        throw { error: `HTTP ${response.status}`, raw: truncateForLog(errorText, 1600) };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let analysis: unknown = null;
      let upstreamRequestId: string | undefined;
      let chunkCount = 0;
      let firstByteAt: number | undefined;
      let receivingAt: number | undefined;
      let lastError: unknown = null;
      let totalLength = 0;
      let streamPreview = "";

      const flushFrame = (event: string, data: unknown) => {
        switch (event) {
          case "started":
            upstreamRequestId = (data as { requestId?: string })?.requestId;
            setAgentModeState((current) => ({
              ...current,
              status: "analyzing",
              message: "已发送，等待模型响应...",
            }));
            break;
          case "upstream_connected":
            firstByteAt = Date.now();
            setAgentModeState((current) => ({
              ...current,
              status: "analyzing",
              message: "上游已连接，等待模型生成...",
            }));
            break;
          case "receiving":
            receivingAt = Date.now();
            setAgentModeState((current) => ({
              ...current,
              status: "receiving",
              message: "正在接收 AI 输出...",
            }));
            break;
          case "chunk":
            chunkCount += 1;
            totalLength = (data as { totalLength?: number })?.totalLength ?? totalLength;
            streamPreview = typeof (data as { preview?: unknown })?.preview === "string"
              ? ((data as { preview?: string }).preview || "")
              : streamPreview;
            setAgentModeState((current) => ({
              ...current,
              status: "receiving",
              message: `AI 输出中... 已接收 ${totalLength} 字符`,
              streamPreview,
              streamCharacters: totalLength,
              streamChunks: chunkCount,
            }));
            break;
          case "done":
            analysis = (data as { analysis?: unknown })?.analysis ?? null;
            break;
          case "error":
            lastError = (data as { detail?: unknown })?.detail ?? data;
            break;
        }
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let frame = "";
          while ((frame = buffer.split("\n\n")[0] || "") && buffer.includes("\n\n")) {
            const nextIndex = buffer.indexOf("\n\n");
            const rawFrame = buffer.slice(0, nextIndex);
            buffer = buffer.slice(nextIndex + 2);
            let eventName = "message";
            let dataText = "";
            for (const line of rawFrame.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              if (line.startsWith("data:")) dataText += `${line.slice(5).trim()}\n`;
            }
            if (!dataText.trim()) continue;
            try {
              flushFrame(eventName, JSON.parse(dataText.trim()));
            } catch {
              flushFrame(eventName, { raw: dataText.trim() });
            }
          }
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }

      if (!analysis && lastError) throw lastError;
      if (!analysis) throw new Error("分析流结束但未收到 done 事件");

      const result = normalizeAgentModeAnalysisResult(analysis, submittedPrompt);
      pushLocalLog({
        type: "agent_analysis",
        level: "success",
        title: `${AGENT_MODE_NAME} 解析完成`,
        message: result.reasoningSummary,
        endpoint: "/api/agent/analyze",
        requestId: upstreamRequestId,
        durationMs: Date.now() - requestStartedAt,
        params: {
          ...apiLogSnapshot(),
          prompt: truncateForLog(submittedPrompt),
        },
        response: {
          requestId: upstreamRequestId,
          chunkCount,
          totalLength,
          firstByteMs: firstByteAt ? firstByteAt - requestStartedAt : null,
          receivingMs: receivingAt ? receivingAt - requestStartedAt : null,
          analysis: sanitizeClientLogValue(result),
        },
      });
      applyAgentModeAnalysisResult(result, upstreamRequestId, submittedPrompt);
    } catch (error) {
      setAgentModeState({
        status: "error",
        message: "Agent 解析失败，请调整描述后重试。",
        error: formatError(error),
        requestPrompt: submittedPrompt,
      });
      pushLocalLog({
        type: "agent_analysis",
        level: "error",
        title: `${AGENT_MODE_NAME} 解析失败`,
        message: formatError(error),
        endpoint: "/api/agent/analyze",
        durationMs: Date.now() - requestStartedAt,
        params: {
          ...apiLogSnapshot(),
          prompt: truncateForLog(submittedPrompt),
        },
        error: safeLogError(error),
      });
      const failedIntent = pendingGenerationIntentRef.current;
      if (failedIntent) {
        pendingGenerationIntentRef.current = null;
        void reportGenerationClientEvent({
          requestId: failedIntent.requestId,
          clientId: getClientId(),
          phase: "client_error_received",
          occurredAt: Date.now(),
          surface: "studio",
          detail: `发送前 Agent 解析失败，生成 POST 未发送：${formatError(error)}`,
        });
      }
    }
  }

  async function requestAgentModeReanalysis() {
    const submittedPrompt = prompt.trim() || agentModeState.requestPrompt || "";
    if (!submittedPrompt) return;
    const apiKeyReady = await verifyApiKeyBeforeGeneration();
    if (!apiKeyReady) return;
    triggerSendLaunchAnimation();
    void requestAgentModeExecution(submittedPrompt);
  }

  async function requestStartBatch() {
    if (!canRequestGenerate) return;
    const nextStart = performance.now();
    if (nextStart - startIntentRef.current < 400) return;
    startIntentRef.current = nextStart;
    const submittedPrompt = prompt.trim();
    const submittedAt = Date.now();
    const supersededIntent = pendingGenerationIntentRef.current;
    if (supersededIntent) {
      void reportGenerationClientEvent({
        requestId: supersededIntent.requestId,
        clientId: getClientId(),
        phase: "client_submission_rejected",
        occurredAt: submittedAt,
        surface: "studio",
        detail: "用户发起了新的提交，上一条尚未发送的生成意图已取消",
      });
    }
    const generationIntent: GenerationIntent = { requestId: uid(), submittedAt };
    pendingGenerationIntentRef.current = generationIntent;
    const intentPreview = {
      ...createJob(
        1,
        clampNumber(Number(params.batchCount), 1, 20),
        generationIntent.requestId,
        apiConfig.protocol,
        submittedPrompt,
        selectedModel,
        params,
        getProtocolDefinition(apiConfig.protocol).supportsReferenceImages ? usableReferenceImages : [],
        submittedAt,
      ),
      id: `intent-${generationIntent.requestId}`,
      requestId: generationIntent.requestId,
      submissionIntentLogged: true,
    };
    recordStudioSubmissionIntent(intentPreview, apiConfig);
    const apiKeyReady = await verifyApiKeyBeforeGeneration();
    if (!apiKeyReady) {
      pendingGenerationIntentRef.current = null;
      void reportGenerationClientEvent({
        requestId: generationIntent.requestId,
        clientId: getClientId(),
        phase: "client_error_received",
        occurredAt: Date.now(),
        surface: "studio",
        localRecordId: intentPreview.id,
        detail: "提交前 API Key / 模型校验未通过，生成 POST 未发送",
      });
      return;
    }
    if (isAgentModeEnabled) {
      triggerSendLaunchAnimation();
      void requestAgentModeExecution(submittedPrompt);
      return;
    }
    const snapshotReferenceImages = getProtocolDefinition(apiConfig.protocol).supportsReferenceImages
      ? usableReferenceImages
      : [];
    const agentContext = lastAppliedAgent ?? undefined;
    triggerSendLaunchAnimation();
    if (agentContext) setAgentPhase("generating");
    setPrompt("");
    setReferenceImages([]);
    setLastAppliedAgent(null);
    if (!isAutoPromptAnalysisEnabled) {
      cancelAnalysisCountdown();
      setAnalysisState({ status: "idle", mode: "send", message: "" });
      void startBatch(undefined, {
        promptOverride: submittedPrompt,
        referenceImagesOverride: snapshotReferenceImages,
        clearReferenceImages: false,
        agentContext,
      });
      return;
    }
    void analyzeBeforeGenerate(submittedPrompt, {
      referenceImagesOverride: snapshotReferenceImages,
      agentContext,
    });
  }

  async function retryJob(job: Job) {
    const retry = {
      ...createJob(
      job.index,
      job.total,
      uid(),
      job.protocol,
      job.prompt,
      job.model,
      job.params,
      job.referenceImages,
      ),
      agentId: job.agentId,
      agentName: job.agentName,
      agentScenario: job.agentScenario,
      promptVariant: job.promptVariant,
    };
    setHighlightedRecordId("");
    setVisibleRecords((current) => sortGenerationRecords([retry, ...current]));
    enqueueJobs([retry], { ...apiConfig });
  }

  async function deleteHistory(id: string) {
    await deleteHistoryRecord(id);
    setSidebarRecords((current) => {
      current.forEach((record) => {
        if (record.id === id && record.objectUrl) URL.revokeObjectURL(record.objectUrl);
        if (record.id === id && record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
      });
      return current.filter((record) => record.id !== id);
    });
    setVisibleRecords((current) => {
      current.forEach((record) => {
        if (record.id === id && record.imageUrl) URL.revokeObjectURL(record.imageUrl);
        if (record.id === id && record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
      });
      return current.filter((record) => record.id !== id);
    });
    setHighlightedRecordId((current) => (current === id ? "" : current));
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  async function clearHistory() {
    await clearHistoryRecords();
    sidebarRecords.forEach((record) => {
      if (record.objectUrl) URL.revokeObjectURL(record.objectUrl);
      if (record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
    });
    setSidebarRecords((current) => current.filter(
      (record) => record.status === "submitting" || record.status === "queued" || record.status === "running",
    ));
    setVisibleRecords((current) => {
      current.forEach((record) => {
        if ((record.status === "success" || record.status === "error") && record.imageUrl) {
          URL.revokeObjectURL(record.imageUrl);
          if (record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
        }
      });
      return current.filter(
        (record) => record.status === "submitting" || record.status === "queued" || record.status === "running",
      );
    });
    mainCursorRef.current = undefined;
    sidebarCursorRef.current = undefined;
    hasMoreMainRef.current = false;
    hasMoreSidebarRef.current = false;
    setHasMoreMainRecords(false);
    setHasMoreSidebarRecords(false);
    setHighlightedRecordId("");
    setSelectedRecordIds(new Set());
    setIsSelectionMode(false);
  }

  function updateParams(patch: Partial<ImageParams>) {
    cancelAnalysisCountdown();
    setParams((current) => {
      const nextResolution = normalizeResolutionForRequest(
        patch.resolution ? safeImageResolution(patch.resolution) : safeImageResolution(current.resolution),
        apiConfig.protocol,
        selectedModel,
      );
      const candidateAspectRatio = patch.aspectRatio || current.aspectRatio;
      const nextSupportedRatios = getSupportedAspectRatios(apiConfig.protocol, selectedModel, nextResolution);
      const nextAspectRatio = nextSupportedRatios.includes(candidateAspectRatio)
        ? candidateAspectRatio
        : nextSupportedRatios[0] || "1:1";
      const candidateSize = typeof patch.size === "string" ? patch.size : current.size;
      return {
        ...current,
        ...patch,
        aspectRatio: nextAspectRatio,
        resolution: nextResolution,
        size: resolveRequestSize(nextAspectRatio, nextResolution, apiConfig.protocol, selectedModel, candidateSize),
        batchCount: patch.batchCount !== undefined
          ? clampNumber(Number(patch.batchCount), 1, 20)
          : current.batchCount,
        concurrency: patch.concurrency !== undefined
          ? clampNumber(Number(patch.concurrency), 1, 6)
          : current.concurrency,
        retryLimit: patch.retryLimit !== undefined
          ? clampNumber(Number(patch.retryLimit), 0, 5)
          : current.retryLimit,
      };
    });
  }

  function changeProtocol(protocol: ImageProtocol) {
    const nextDefinition = getProtocolDefinition(protocol);
    const nextModels = imageModelsForProtocol(protocol, nextDefinition.defaultModels);
    const nextAnalysisModels = filterAnalysisModels(nextDefinition.defaultModels);
    setApiConfig((current) => {
      return {
        ...current,
        protocol,
        baseUrl: normalizeApiBaseUrl(current.baseUrl),
      };
    });
    setModels(nextModels);
    setSelectedModel((current) => preferModel(nextModels, current));
    setAnalysisModels(nextAnalysisModels);
    setSelectedAnalysisModel((current) => preferAnalysisModel(nextAnalysisModels, current));
    setModelFilter("");
    setModelState(
      nextModels.length > 0
        ? { status: "idle", message: `${nextModels.length} 个预设图片模型，等待验证` }
        : { status: "idle", message: "等待读取图片模型" },
    );
  }

  function selectImageModel(model: string) {
    const nextModel = model.trim();
    if (!isAllowedImageModel(nextModel)) return;
    const nextProtocol = protocolForImageModel(nextModel, apiConfig.protocol);
    const protocolChanged = nextProtocol !== apiConfig.protocol;
    const nextDefinition = getProtocolDefinition(nextProtocol);
    const nextModels = imageModelsForProtocol(nextProtocol, [...models, nextModel]);
    const nextAnalysisModels = filterAnalysisModels(nextDefinition.defaultModels);
    if (protocolChanged) {
      setVerifiedModelKey("");
      setVerifiedModelAt(0);
      setAnalysisModels(nextAnalysisModels);
      setSelectedAnalysisModel((current) => preferAnalysisModel(nextAnalysisModels, current));
      setModelState({
        status: "idle",
        message: `已切换到 ${nextDefinition.shortLabel} 通道，等待自动验证`,
      });
    }
    setApiConfig((current) => {
      if (current.protocol === nextProtocol) return current;
      return {
        ...current,
        protocol: nextProtocol,
        baseUrl: normalizeApiBaseUrl(current.baseUrl),
      };
    });
    setModels(nextModels);
    setSelectedModel(nextModel);
    setModelFilter("");
    setParams((current) => {
      const canScale = isGptImage2ProModel(nextModel) || !usesOfficialGptImageSizing(nextProtocol, nextModel);
      const nextResolution = canScale ? current.resolution : "1K" as ImageResolution;
      const nextSupportedRatios = getSupportedAspectRatios(nextProtocol, nextModel, nextResolution);
      const nextAspectRatio = nextSupportedRatios.includes(current.aspectRatio)
        ? current.aspectRatio
        : nextSupportedRatios[0] || "1:1";
      return {
        ...current,
        aspectRatio: nextAspectRatio,
        resolution: nextResolution,
        size: resolveRequestSize(nextAspectRatio, nextResolution, nextProtocol, nextModel, current.size),
      };
    });
  }

  function downloadCurrent(job: Job | HistoryRecord) {
    const url = (job as Job).imageUrl || (job as HistoryRecord).objectUrl;
    if (!url) return;
    const size = job.width && job.height ? `${job.width}x${job.height}` : job.params.size || "image";
    const filename = `${formatFileDate(job.createdAt)}-${sanitizeFilename(job.model)}-${size}-${job.id}.${job.params.outputFormat}`;
    downloadUrl(url, filename);
  }

  function downloadCurrentBatch() {
    successfulVisibleRecords.forEach((job) => downloadCurrent(job));
  }

  function clearAgentModeDrafts() {
    setAgentModePendingPlan(null);
    setAgentModeBrochureDraft(null);
    setAgentModeState((current) =>
      current.status === "idle"
        ? current
        : { status: "idle", message: isAgentModeEnabled ? "输入已更新，等待重新理解需求。" : "" },
    );
  }

  function copyPrompt(text: string) {
    void navigator.clipboard.writeText(text);
  }

  async function imageSourceToDataUrl(item: Job | PreviewItem) {
    const blob = "imageBlob" in item ? item.imageBlob : undefined;
    if (blob) return blobToDataUrl(blob);
    const url = (item as Job).imageUrl || (item as PreviewItem).url;
    if (!url) throw new Error("没有可推荐的图片");
    const response = await fetch(url);
    if (!response.ok) throw new Error("无法读取图片用于推荐");
    return blobToDataUrl(await response.blob());
  }

  async function recommendToSquare(item: Job | PreviewItem) {
    if (!canUseSquareIdentity) {
      setSquareRecommendState((current) => ({
        ...current,
        [item.id]: { status: "error", message: "配置 API Key 后可推荐到广场" },
      }));
      return;
    }
    if (item.status !== "success") return;
    setSquareRecommendState((current) => ({
      ...current,
      [item.id]: { status: "submitting", message: "正在压缩并推荐到广场..." },
    }));
    try {
      const imageDataUrl = await imageSourceToDataUrl(item);
      const thumbnail = await createSquareThumbnail(imageDataUrl, 1024);
      const sourceType = item.agentId === "agent-mode-a"
        ? "agent_mode"
        : item.agentName
          ? "industry_agent"
          : "local_history";
      const response = await fetch("/api/square/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiConfig.apiKey,
          imageId: item.id,
          thumbnailDataUrl: thumbnail.dataUrl,
          sourceImageMeta: {
            imageId: item.id,
            requestId: item.requestId,
            model: item.model,
            width: item.width || thumbnail.width,
            height: item.height || thumbnail.height,
            aspectRatio: item.params.aspectRatio,
            pageLabel: item.agentScenario,
          },
          prompt: item.prompt,
          params: item.params,
          caption: item.agentScenario || item.prompt.replace(/\s+/g, " ").slice(0, 120),
          hidePrompt: hidePromptOnShare,
          sourceType,
          reasonPlan: {
            agentName: item.agentName,
            agentScenario: item.agentScenario,
            promptVariant: item.promptVariant,
            compressedTo: "1K",
          },
        }),
      });
      const payload = await readApiJson<SquareRecommendResponse>(response, "/api/square/recommend");
      if (!response.ok || !payload.ok) throw payload;
      const message = payload.action === "replaced"
        ? `已推荐，替换最早展示位 · 今日剩余 ${payload.remainingDailyQuota ?? 0}`
        : `已推荐到广场 · 今日剩余 ${payload.remainingDailyQuota ?? 0}`;
      setSquareRecommendState((current) => ({
        ...current,
        [item.id]: {
          status: "success",
          message,
          itemId: payload.item?.id,
        },
      }));
    } catch (error) {
      setSquareRecommendState((current) => ({
        ...current,
        [item.id]: {
          status: "error",
          message: formatError(error),
        },
      }));
    }
  }

  function removeReference(id: string) {
    cancelAnalysisCountdown();
    clearAgentModeDrafts();
    setReferenceImages((current) => current.filter((image) => image.id !== id));
  }

  function applyPromptStarter(nextPrompt: string) {
    cancelAnalysisCountdown();
    clearAgentModeDrafts();
    setIsComposerCollapsed(false);
    setPrompt((current) => (current.trim() ? `${current.trim()}\n${nextPrompt}` : nextPrompt));
    setShowPromptPresets(false);
    window.requestAnimationFrame(resizePromptTextarea);
  }

  function updatePromptValue(nextPrompt: string) {
    cancelAnalysisCountdown();
    clearAgentModeDrafts();
    setIsComposerCollapsed(false);
    setPrompt(nextPrompt);
  }

  function markAgentHintSeen() {
    if (!isAgentHintSeen) {
      localStorage.setItem("imageStudioAgentHintSeen", "true");
      setIsAgentHintSeen(true);
    }
    setIsAgentHintVisible(false);
  }

  function disableAgent() {
    setSelectedAgentId("");
    setAgentValues({});
    setAgentPlan(null);
    setAgentPhase("collecting");
    setIsAgentPanelOpen(false);
    setLastAppliedAgent(null);
  }

  function openAgentPanel(agentId?: string) {
    const targetAgentId = agentId ?? selectedAgentId;
    const nextAgent = targetAgentId ? INDUSTRY_AGENTS.find((agent) => agent.id === targetAgentId) || null : null;
    markAgentHintSeen();
    setIsAgentQuickbarExpanded(true);
    if (nextAgent) {
      // 同一个 Agent 重开：保留 agentValues / agentPlan / agentPhase，避免用户填好的字段被冲掉
      // 切换到不同 Agent：才重置
      if (selectedAgentId !== nextAgent.id) {
        setSelectedAgentId(nextAgent.id);
        setAgentValues(createAgentDefaults(nextAgent));
        setAgentPlan(null);
        setAgentPhase("collecting");
      }
    } else {
      setSelectedAgentId("");
      setAgentValues({});
      setAgentPlan(null);
      setAgentPhase("collecting");
    }
    setShowPromptPresets(false);
    setIsComposerCollapsed(false);
    setIsAgentPanelOpen(true);
  }

  function selectAgent(agent: IndustryAgent) {
    setIsAgentQuickbarExpanded(true);
    if (selectedAgentId !== agent.id) {
      setLastAppliedAgent(null);
    }
    setSelectedAgentId(agent.id);
    setAgentValues(createAgentDefaults(agent));
    setAgentPlan(null);
    setAgentPhase("collecting");
  }

  function updateAgentValue(fieldId: string, value: string) {
    setAgentValues((current) => ({ ...current, [fieldId]: value }));
    setAgentPlan(null);
    setAgentPhase("collecting");
  }

  function generateAgentPlan() {
    if (!selectedAgent) return;
    // buildAgentPlan 是纯本地拼接，无需"假装 AI 在思考"的延迟
    const nextPlan = buildAgentPlan(selectedAgent, agentValues);
    setAgentPlan(nextPlan);
    setAgentPhase("prompting");
  }

  function paramsFromAgentPlan(plan: AgentPlan) {
    // Agent 是给视觉/创意方向建议，不是控制运行行为。
    // 覆盖创意方向：aspectRatio + 派生 size + negativePrompt
    // 保留运行参数：batchCount / concurrency / quality / outputFormat / resolution / seed / retryLimit
    // —— 用户调好的批量数 / 清晰度等应当跨 Agent 应用保留
    const recommendedRatio = typeof plan.recommendedParams.aspectRatio === "string"
      ? plan.recommendedParams.aspectRatio
      : params.aspectRatio;
    const nextResolution = normalizeResolutionForRequest(
      safeImageResolution(params.resolution),
      apiConfig.protocol,
      selectedModel,
    );
    const nextRatio = isAspectRatioSupported(apiConfig.protocol, recommendedRatio, selectedModel, nextResolution)
      ? recommendedRatio
      : getSupportedAspectRatios(apiConfig.protocol, selectedModel, nextResolution)[0] || params.aspectRatio;
    return {
      ...params,
      aspectRatio: nextRatio,
      size: resolveRequestSize(
        nextRatio,
        nextResolution,
        apiConfig.protocol,
        selectedModel,
        params.size,
      ),
      negativePrompt: plan.negativePrompt || params.negativePrompt,
    } as ImageParams;
  }

  function applyAgentVariant(variant: PromptVariant) {
    const plan = agentPlan || (selectedAgent ? buildAgentPlan(selectedAgent, agentValues) : null);
    if (!plan) return;
    // 应用新 variant 等于覆盖当前 prompt —— 任何待执行的旧倒计时（snapshot 着旧 prompt）必须取消，
    // 否则会用旧 prompt 跑生成而 UI 显示新 prompt，行为割裂。
    cancelAnalysisCountdown();
    setAnalysisState({ status: "idle", mode: "send", message: "" });
    const nextPrompt = plan.promptVariants[variant];
    const nextParams = paramsFromAgentPlan(plan);
    setAgentPlan(plan);
    setParams(nextParams);
    setPrompt(nextPrompt);
    setIsAgentPanelOpen(false);
    setIsComposerCollapsed(false);
    setAgentPhase("collecting");
    setLastAppliedAgent({ plan, variant });
    window.requestAnimationFrame(() => {
      resizePromptTextarea();
      promptTextareaRef.current?.focus();
    });
  }

  function handleCanvasScroll() {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      if (composerCollapseTimerRef.current) {
        window.clearTimeout(composerCollapseTimerRef.current);
      }
      if (
        prompt.trim() ||
        isAgentPanelOpen ||
        analysisState.status !== "idle" ||
        analysisCountdown ||
        referenceImages.length > 0
      ) {
        return;
      }
      composerCollapseTimerRef.current = window.setTimeout(() => setIsComposerCollapsed(true), 120);
    });
  }

  function previewCurrent(item: Job | HistoryRecord) {
    // 只取原图字段。列表用的缩略图另走 thumbUrl，绝不能混进来当预览主图。
    const url = (item as Job).imageUrl || (item as HistoryRecord).objectUrl;
    setPreviewItem({
      id: item.id,
      requestId: item.requestId,
      url,
      thumbUrl: (item as Job).thumbUrl || (item as HistoryRecord).thumbUrl,
      protocol: (item as Job).protocol || (item as HistoryRecord).protocol,
      prompt: item.prompt,
      model: item.model,
      status: item.status === "success" ? "success" : "error",
      params: item.params,
      width: item.width,
      height: item.height,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      durationMs: item.durationMs,
      errorDetail: item.errorDetail,
      agentId: item.agentId,
      agentName: item.agentName,
      agentScenario: item.agentScenario,
      promptVariant: item.promptVariant,
      submittedReferenceImages: item.submittedReferenceImages,
    });
  }

  function enterStudio() {
    setActivePage("studio");
    if (window.location.hash !== "#studio") {
      window.history.pushState(null, "", "#studio");
    }
    if (showOnboarding) {
      setOnboardingStep(0);
      setIsSettingsOpen(true);
    }
  }

  // 首页输入框提交：无条件先接住提示词再跳转，未就绪也不丢失用户输入
  function submitFromHome() {
    const value = homePrompt.trim();
    if (!value) return;
    setPrompt(value);
    setHomePrompt("");
    // 连同提示词快照一起记：用户若在 studio 改写了提示词，说明他要自己接管，待办必须作废而不是抢跑
    homeSubmitPendingRef.current = { at: Date.now(), prompt: value };
    enterStudio();
  }

  function enterAdmin() {
    setActivePage("admin");
    if (window.location.hash !== "#admin") {
      window.history.pushState(null, "", "#admin");
    }
  }

  function enterSquare() {
    setActivePage("square");
    if (window.location.hash !== "#square") {
      window.history.pushState(null, "", "#square");
    }
  }

  function enterCanvas() {
    setActivePage("canvas");
    if (window.location.hash !== "#canvas") {
      window.history.pushState(null, "", "#canvas");
    }
  }

  // 工作台成功记录 → 画布节点（roadmap PRD N2）。
  // objectUrl 在本页面生命周期内始终有效，画布挂载后 fetch 它拿 blob。
  function openRecordInCanvas(job: Job) {
    if (job.status !== "success" || !job.imageUrl) return;
    setCanvasImport({
      imageUrl: job.imageUrl,
      prompt: job.prompt,
      model: job.model,
      protocol: job.protocol,
      params: job.params,
      requestId: job.requestId,
    });
    enterCanvas();
  }

  // 广场作品 → 工作台复现（roadmap PRD B1）：参数与提示词回填。
  // 隐藏提示词的作品只回填参数；模型不在白名单时保留当前选择并提醒。
  function applySquareItemToStudio(item: SquareFeedItem) {
    if (item.prompt) setPrompt(item.prompt);
    const modelAllowed = isAllowedImageModel(item.model);
    if (modelAllowed) setSelectedModel(item.model);
    const p = item.params || {};
    setParams((current) => ({
      ...current,
      aspectRatio: typeof p.aspectRatio === "string" && p.aspectRatio ? p.aspectRatio : current.aspectRatio,
      size: typeof p.size === "string" && p.size ? p.size : current.size,
      resolution: p.resolution === "1K" || p.resolution === "2K" || p.resolution === "4K" ? p.resolution : current.resolution,
      quality: typeof p.quality === "string" && p.quality ? p.quality : current.quality,
    }));
    enterStudio();
    showAppNotice(modelAllowed
      ? (item.prompt ? "已带入同款提示词与参数，可直接生成" : "该作品未公开提示词，已带入生成参数")
      : `模型 ${item.model} 不在当前站点，已带入其余参数`);
  }

  // 画布节点 → 工作台（roadmap PRD N2）：prompt + params 回填，模型不在白名单则保留当前选择
  function applyCanvasNodeToStudio(payload: { prompt: string; model: string; params: ImageParams }) {
    setPrompt(payload.prompt);
    if (isAllowedImageModel(payload.model)) setSelectedModel(payload.model);
    setParams((current) => ({
      ...current,
      aspectRatio: payload.params.aspectRatio || current.aspectRatio,
      size: payload.params.size || current.size,
      resolution: payload.params.resolution || current.resolution,
      quality: payload.params.quality || current.quality,
    }));
    enterStudio();
    showAppNotice("已把该图的提示词与参数带到工作台");
  }

  function returnHome() {
    setActivePage("home");
    if (window.location.hash) {
      window.history.pushState(null, "", window.location.pathname);
    }
  }

  function oauthLogin() {
    window.location.href = "/api/auth/oauth/login";
  }

  async function oauthLogout() {
    try {
      await fetch("/api/auth/oauth/logout", { method: "POST", credentials: "same-origin" });
    } catch { /* ignore */ }
    setOauthUser(null);
    // 登出必须连 Key 一起清掉。OAuth 登录时服务端把真实上游 Key 交给了浏览器，
    // 只清 oauthUser 会让它留在 state / sessionStorage / localStorage 里，
    // 共享设备上的下一个人直接继承一把可用的 Key。
    clearApiKey();
  }

  // 把 Key 从内存与两处浏览器存储中一并抹掉（登出与「清除 Key」按钮共用）。
  // 模型列表 / verifiedModelKey 的清理交给监听 apiConfig.apiKey 的那个 effect，
  // 它在 Key 短于 API_KEY_MIN_LENGTH 时已经会把这些状态复位。
  function clearApiKey() {
    setApiConfig((prev) => ({ ...prev, apiKey: "" }));
    try {
      sessionStorage.removeItem("imageStudioApiKey");
      localStorage.removeItem("imageStudioApiKey");
    } catch { /* 存储不可用时忽略 */ }
  }

  function completeOnboarding() {
    localStorage.setItem("imageStudioOnboardingComplete", "true");
    setShowOnboarding(false);
    setOnboardingStep(0);
  }

  const analysisResult = analysisState.result;
  const suggestedRatio = analysisResult?.suggestedParams.aspectRatio;
  const suggestedSize = analysisResult?.suggestedParams.size || (
    suggestedRatio
      ? resolveRequestSize(suggestedRatio, selectedResolution, apiConfig.protocol, selectedModel, params.size)
      : ""
  );
  const suggestedCount = analysisResult?.suggestedParams.count;
  const analysisSourceLabel = analysisResult?.source === "ai"
    ? `AI · ${analysisResult.analysisModel || preferredAnalysisModel}`
    : analysisResult?.analysisModel || "本地预检";
  const frontendUpdateNotice = availableFrontendVersion ? (
    <FrontendUpdateNotice
      version={availableFrontendVersion}
      onRefresh={() => reloadWithFrontendVersion(availableFrontendVersion)}
      onDismiss={() => setAvailableFrontendVersion("")}
    />
  ) : null;
  // 跨页轻提示：随 frontendUpdateNotice 一起挂到每个页面分支的顶层
  const appNoticeElement = appNotice ? (
    <div className="app-notice" role="status">{appNotice}</div>
  ) : null;

  // 全局一级导航（2026-07-27 用户反馈定版）：四个主页面渲染**同一个**头部结构——
  // 品牌固定最左、四个 tab 绝对居中（不受左右内容宽度影响）、账号/管理固定最右。
  // 切页时导航的位置、大小、内容零变化；页面风格可以不同，这条头部不允许变。
  const appHeaderEnd = (
    <>
      {oauthUser ? (
        <div className="home-account">
          <User size={15} />
          <span>{oauthUser.displayName || oauthUser.username}</span>
          <button type="button" onClick={() => void oauthLogout()}>退出</button>
        </div>
      ) : oauthEnabled ? (
        <button type="button" className="home-login" onClick={oauthLogin}>登录</button>
      ) : null}
      <button type="button" className="home-admin-icon" onClick={enterAdmin} aria-label="管理后台" title="管理后台">
        <ShieldCheck size={16} />
      </button>
    </>
  );
  const renderAppHeader = (page: "home" | "studio" | "canvas" | "square") => (
    <header className="app-header">
      <AppNav
        current={page}
        brandLogo={imageStudioLogo}
        runningCount={queueStats.running + queueStats.queued}
        onNavigate={(target) => {
          if (target === "home") returnHome();
          else if (target === "studio") enterStudio();
          else if (target === "canvas") enterCanvas();
          else enterSquare();
        }}
        end={appHeaderEnd}
      />
    </header>
  );

  if (activePage === "home") {
    return (
      <>
        {frontendUpdateNotice}
        {appNoticeElement}
        {renderAppHeader("home")}
        <HomePage
          onEnter={enterStudio}
          onSquare={enterSquare}
          onAdmin={enterAdmin}
          onCanvas={enterCanvas}
          oauthUser={oauthUser}
          onOauthLogout={oauthLogout}
          oauthEnabled={oauthEnabled}
          onOauthLogin={oauthLogin}
          homePrompt={homePrompt}
          onHomePromptChange={setHomePrompt}
          onHomeSubmit={submitFromHome}
          models={selectableImageModels}
          modelStats={modelStats}
          selectedModel={selectedModel}
          onSelectModel={selectImageModel}
          recentRecords={sidebarRecords}
          hasApiKey={apiConfig.apiKey.trim().length >= API_KEY_MIN_LENGTH}
          runningCount={queueStats.running + queueStats.queued}
        />
      </>
    );
  }

  if (activePage === "square") {
    return (
      <>
        {frontendUpdateNotice}
        {appNoticeElement}
        {renderAppHeader("square")}
        <SquarePage
          apiKey={apiConfig.apiKey}
          onBackHome={returnHome}
          onEnterStudio={enterStudio}
          onCanvas={enterCanvas}
          runningCount={queueStats.running + queueStats.queued}
          onReproduce={applySquareItemToStudio}
        />
      </>
    );
  }

  if (activePage === "canvas") {
    return (
      <>
        {frontendUpdateNotice}
        {appNoticeElement}
        {renderAppHeader("canvas")}
        <CanvasPage
          apiConfig={apiConfig}
          selectedModel={selectedModel}
          selectableModels={selectableImageModels}
          modelState={modelState}
          onBackHome={returnHome}
          onEnterStudio={enterStudio}
          onEnterSquare={enterSquare}
          runningCount={queueStats.running + queueStats.queued}
          pendingImport={canvasImport}
          onImportConsumed={() => setCanvasImport(null)}
          onSendToStudio={applyCanvasNodeToStudio}
          hidePromptOnShare={hidePromptOnShare}
        />
      </>
    );
  }

  if (activePage === "admin") {
    return (
      <>
        {frontendUpdateNotice}
        {appNoticeElement}
        <AdminApp onBackHome={returnHome} onEnterStudio={enterStudio} oauthEnabled={oauthEnabled} onOauthLogin={oauthLogin} />
      </>
    );
  }

  return (
    <>
    {frontendUpdateNotice}
    {appNoticeElement}
    {renderAppHeader("studio")}
    <div className={`app-shell ${isLeftSidebarOpen ? "left-open" : "left-closed"} ${isSettingsOpen ? "settings-open" : "settings-closed"}`}>
      <button
        className="drawer-backdrop"
        type="button"
        aria-label="关闭侧边栏"
        onClick={() => {
          setIsLeftSidebarOpen(false);
          setIsSettingsOpen(false);
        }}
      />
      <aside className={`sidebar ${isLeftSidebarOpen ? "open" : "closed"}`}>
        <div className="brand">
          <div className="brand-main">
            <div className="brand-mark">
              <img src={imageStudioLogo} alt="" />
            </div>
            <div>
              <strong>Image Studio</strong>
              <span>本地批量生图</span>
            </div>
          </div>
          <button
            className="icon-button sidebar-close-button"
            type="button"
            title="收起最近记录"
            onClick={() => setIsLeftSidebarOpen(false)}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <button
          className="new-task"
          type="button"
          onClick={() => {
            cancelAnalysisCountdown();
            setPrompt("");
            setReferenceImages([]);
            setIsAgentPanelOpen(false);
            setLastAppliedAgent(null);
            setHighlightedRecordId("");
            canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <ImagePlus size={17} />
          新任务
        </button>

        <div className="history-title">
          <span>最近记录</span>
          <button type="button" className="icon-button" title="清空历史" onClick={() => void clearHistory()}>
            <Trash2 size={16} />
          </button>
        </div>

        {/* 历史筛选（roadmap PRD B4）：筛的是已加载的记录，继续下拉仍会加载更多 */}
        <div className="history-filter">
          <div className="history-filter-tabs">
            {([["all", "全部"], ["success", "成功"], ["error", "失败"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={sidebarFilterStatus === key ? "is-active" : ""}
                onClick={() => setSidebarFilterStatus(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={sidebarSearch}
            onChange={(event) => setSidebarSearch(event.target.value)}
            placeholder="搜提示词 / 模型…"
            aria-label="搜索历史记录"
          />
        </div>

        <div className="history-list" ref={sidebarListRef}>
          {filteredSidebarRecords.length === 0 && !isLoadingSidebarRecords ? (
            <div className="muted-box">{sidebarRecords.length === 0 ? "暂无记录" : "没有符合筛选条件的记录"}</div>
          ) : (
            filteredSidebarRecords.map((record) => (
              <button
                key={record.id}
                type="button"
                className={`history-item ${highlightedRecordId === record.id ? "active" : ""}`}
                onClick={() => focusSidebarRecord(record)}
              >
                <div className={`history-thumb ${record.status}`}>
                  {(record.thumbUrl ?? record.objectUrl) ? (
                    <img src={record.thumbUrl ?? record.objectUrl} alt="" loading="lazy" decoding="async" />
                  ) : record.status === "submitting" || record.status === "queued" || record.status === "running" ? (
                    <Loader2 size={18} className="spin" />
                  ) : (
                    <AlertCircle size={18} />
                  )}
                </div>
                <div className="history-copy">
                  <strong>
                    {record.status === "success"
                      ? record.prompt
                      : record.status === "error"
                        ? "生成失败"
                        : record.status === "submitting"
                          ? "状态确认中"
                          : record.status === "queued"
                            ? "排队中"
                            : "生成中"}
                  </strong>
                  <span>
                    {record.model} · {formatDate(record.finishedAt || record.createdAt)}
                  </span>
                </div>
              </button>
            ))
          )}
          {isLoadingSidebarRecords && <div className="load-more-state">读取记录中...</div>}
          {hasMoreSidebarRecords && <div ref={sidebarLoadMoreRef} className="load-more-sentinel" />}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-cluster">
            <SidebarToggleButton
              side="left"
              open={isLeftSidebarOpen}
              title={isLeftSidebarOpen ? "收起最近记录" : "打开最近记录"}
              onClick={() => setIsLeftSidebarOpen((value) => !value)}
            />
            <div className={`status-pill ${modelState.status}`}>
              {modelState.status === "ready" ? <Wifi size={16} /> : <Settings2 size={16} />}
              <span>{modelState.status === "ready" ? "已连接" : modelState.message}</span>
            </div>
          </div>
          <div className="current-model">
            <span>{protocolDefinition.shortLabel}</span>
            <strong>{selectedModel || "未选择"}</strong>
          </div>
          <div className="topbar-cluster right">
            {oauthUser && (
              <div className="oauth-user-compact" title={oauthUser.email || oauthUser.username}>
                <User size={14} />
                <span>{oauthUser.displayName || oauthUser.username}</span>
              </div>
            )}
            <button
              type="button"
              className="icon-button"
              title="需求反馈：告诉我们你想要什么功能"
              onClick={() => {
                if (apiConfig.apiKey.trim().length < API_KEY_MIN_LENGTH) {
                  showAppNotice("请先配置 API Key 再提交反馈（用于防滥用与查看回复）");
                  return;
                }
                setIsFeedbackOpen(true);
              }}
            >
              <MessageSquare size={15} />
            </button>
            <button
              type="button"
              className={`topbar-log-button ${latestLocalLogLevel ? `is-${latestLocalLogLevel}` : ""}`}
              title="查看本地请求日志"
              onClick={() => setIsLocalLogOpen((value) => !value)}
            >
              <Database size={15} />
              <span>{localLogs.length}</span>
            </button>
            <SidebarToggleButton
              side="right"
              open={isSettingsOpen}
              title={isSettingsOpen ? "收起配置" : "打开配置"}
              onClick={() => setIsSettingsOpen((value) => !value)}
            />
          </div>
        </header>
        {isLocalLogOpen && (
          <section className="local-log-panel" role="dialog" aria-label="本地请求日志">
            <div className="local-log-head">
              <div>
                <strong>本地请求日志</strong>
                <span>只保存在当前浏览器，API Key 和参考图内容已脱敏。</span>
              </div>
              <div className="local-log-actions">
                <button type="button" className="subtle-button compact" onClick={exportLocalDiagnostics} disabled={localLogs.length === 0} title="导出本地诊断为 JSON（图片内容已脱敏）">
                  <DownloadCloud size={14} />
                  导出
                </button>
                <button type="button" className="subtle-button compact" onClick={clearLocalLogs} disabled={localLogs.length === 0}>
                  <Trash2 size={14} />
                  清空
                </button>
                <button type="button" className="icon-button" title="关闭日志" onClick={() => setIsLocalLogOpen(false)}>
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="local-log-list">
              {localLogs.length === 0 ? (
                <div className="local-log-empty">暂无日志。提交生成或读取模型后会显示请求详情。</div>
              ) : (
                localLogs.map((log, index) => (
                  <details className={`local-log-item ${log.level}`} key={log.id} open={index === 0}>
                    <summary>
                      <span>{formatFullDate(log.createdAt)}</span>
                      <strong>{log.title}</strong>
                      <small>
                        {log.endpoint || log.type}
                        {log.durationMs !== undefined ? ` · ${formatDuration(log.durationMs)}` : ""}
                        {log.referenceSummary && (
                          <em className={`ref-pill ref-pill-${log.referenceSummary.status}`}>
                            {log.referenceSummary.status === "none" && "无参考图"}
                            {log.referenceSummary.status === "skipped_unsupported" && `${log.referenceSummary.count} 张未发送`}
                            {log.referenceSummary.status === "prepared" && `${log.referenceSummary.count} 张待发送${log.referenceSummary.totalBytes > 0 ? ` · ${formatBytes(log.referenceSummary.totalBytes)}` : ""}`}
                            {log.referenceSummary.status === "sent_ok" && `${log.referenceSummary.count} 张已上传${log.referenceSummary.totalBytes > 0 ? ` · ${formatBytes(log.referenceSummary.totalBytes)}` : ""}`}
                            {log.referenceSummary.status === "sent_failed" && `${log.referenceSummary.count} 张发送失败`}
                          </em>
                        )}
                      </small>
                    </summary>
                    <div className="local-log-body">
                      <p>{log.message}</p>
                      {log.requestId && <span className="local-log-request-id">requestID：{log.requestId}</span>}
                      <pre>{JSON.stringify({
                        params: log.params,
                        response: log.response,
                        error: log.error,
                      }, null, 2)}</pre>
                    </div>
                  </details>
                ))
              )}
            </div>
          </section>
        )}

        <section className="canvas" ref={canvasRef} onScroll={handleCanvasScroll}>
          {visibleRecords.length === 0 && !isLoadingMainRecords ? (
            <div className="empty-state">
              <div className="empty-mark">
                <ImagePlus size={26} />
              </div>
              <div>
                <strong>准备生成</strong>
                <span>读取模型后输入提示词</span>
              </div>
            </div>
          ) : (
            <div className="gallery-stack">
              <div className="batch-toolbar">
                <div className="record-summary">
                  <span>全部生成记录 · 已显示 {visibleRecords.length} 条</span>
                  <small>
                    运行中 {queueStats.running} / 排队 {queueStats.queued}
                    {visibleStats.submitting > 0 ? ` / 状态确认 ${visibleStats.submitting}` : ""}
                    {` / 成功 ${visibleStats.success} / 失败 ${visibleStats.error}`}
                  </small>
                </div>
                <div className="toolbar-actions">
                  {isSelectionMode ? (
                    <BulkActionBar
                      selectedCount={selectedRecords.length}
                      downloadableCount={downloadableSelectedRecords.length}
                      selectableCount={selectableVisibleRecords.length}
                      failedCount={failedVisibleRecordCount}
                      isDownloading={isBulkDownloading}
                      onSelectAll={selectAllVisibleRecords}
                      onClearFailed={() => void clearFailedRecords()}
                      onInvert={invertVisibleSelection}
                      onDownload={() => void downloadSelectedRecords()}
                      onDelete={requestBulkDelete}
                      onCancel={cancelSelection}
                    />
                  ) : (
                    <>
                      <button type="button" className="subtle-button" onClick={toggleSelectionMode}>
                        <CheckSquare size={16} />
                        选择
                      </button>
                      {successfulVisibleRecords.length > 0 && (
                        <button type="button" className="subtle-button" onClick={downloadCurrentBatch}>
                          <Download size={16} />
                          下载已显示成功图片
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="gallery-scroll">
                <div className="gallery-grid">
                  {visibleRecords.map((job) => (
	                    <JobCard
	                      key={job.id}
	                      job={job}
	                      highlighted={highlightedRecordId === job.id}
                      recordRef={(element) => registerRecordElement(job.id, element)}
                      selected={selectedRecordIds.has(job.id)}
                      selectionMode={isSelectionMode}
                      selectable={job.status === "success" || job.status === "error"}
                      onToggleSelect={() => toggleRecordSelection(job)}
                      onRetry={() => void retryJob(job)}
                      onPreview={() => previewCurrent(job)}
                      onDownload={() => downloadCurrent(job)}
                      onCopyPrompt={() => copyPrompt(job.prompt)}
                      onRecommend={() => void recommendToSquare(job)}
                      onOpenInCanvas={() => openRecordInCanvas(job)}
                      recommendState={squareRecommendState[job.id]}
                      canRecommend={canUseSquareIdentity}
                      feedback={job.requestId ? feedbackMap[job.requestId] : undefined}
                      onFeedback={(rating) => void sendImageFeedback(job.requestId, rating)}
                    />
                  ))}
                </div>
                {isLoadingMainRecords && <div className="load-more-state">读取更多记录中...</div>}
                {hasMoreMainRecords && <div ref={mainLoadMoreRef} className="load-more-sentinel" />}
              </div>
            </div>
          )}
        </section>

        <form
          className={[
            "composer",
            isPromptAnalyzing ? "is-analyzing" : "",
            isComposerCollapsed ? "is-collapsed" : "",
            isAgentPanelOpen ? "has-agent-panel" : "",
            isAgentModeEnabled ? "is-agent-mode" : "",
          ].filter(Boolean).join(" ")}
          data-onboarding-target="composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (isAgentPanelOpen) return;
            requestStartBatch();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onComposerDrop}
        >
          {isComposerCollapsed && (
            <button
              type="button"
              className="composer-mini"
              onClick={() => {
                setIsComposerCollapsed(false);
                window.requestAnimationFrame(() => promptTextareaRef.current?.focus());
              }}
            >
              <WandSparkles size={16} />
              <span>描述你想生成的图片...</span>
              <Send size={16} />
            </button>
          )}
          {isAgentModeEnabled ? (
            <AgentModeSwitch
              enabled
              status={agentModeState.status}
              onToggle={() => setIsAgentModeEnabled((value) => !value)}
            />
          ) : (
            // 未启用的功能全部收进这一行 chip，点开才展开，避免 composer 常驻五层
            <div className="composer-toolbar">
              <AgentModeSwitch
                enabled={false}
                status={agentModeState.status}
                onToggle={() => setIsAgentModeEnabled((value) => !value)}
              />
              {!isAgentEnabled && !lastAppliedAgent && (
                <button
                  type="button"
                  className="composer-tool-chip"
                  onClick={() => openAgentPanel()}
                  title="选择行业工作流，不填也能生成标准图"
                >
                  <WandSparkles size={14} />
                  行业 Agent
                </button>
              )}
            </div>
          )}
          {!isAgentModeEnabled && (isAgentEnabled || lastAppliedAgent) && (
            <div className="agent-quickbar">
              <button
                type="button"
                className={[
                  "agent-entry-button",
                  lastAppliedAgent ? "is-active" : isAgentEnabled ? "is-enabled" : "is-muted",
                  !isAgentHintSeen ? "needs-attention" : "",
                ].filter(Boolean).join(" ")}
                title={
                  lastAppliedAgent
                    ? `${lastAppliedAgent.plan.agentName} · ${PROMPT_VARIANT_LABELS[lastAppliedAgent.variant]} 已应用到当前提示词`
                    : isAgentEnabled
                      ? "已选行业，点开面板应用 variant"
                      : "打开行业 Agent 选择器"
                }
                onClick={() => openAgentPanel()}
              >
                <WandSparkles size={15} />
                {lastAppliedAgent
                  ? `${lastAppliedAgent.plan.agentName} · ${PROMPT_VARIANT_LABELS[lastAppliedAgent.variant]} 已应用`
                  : isAgentEnabled
                    ? `${selectedAgent?.name || "行业 Agent"} · 已选`
                    : "行业 Agent · 未启用"}
                <ChevronRight size={14} />
                <small>
                  {lastAppliedAgent ? "送出后清" : isAgentEnabled ? "可应用" : "可开启"}
                </small>
              </button>
              {isAgentEnabled && (
                <button
                  type="button"
                  className="agent-disable-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    disableAgent();
                  }}
                  title="停用行业 Agent"
                  aria-label="停用行业 Agent"
                >
                  <X size={13} />
                </button>
              )}
              {lastAppliedAgent && (
                <div className="agent-applied-chip" role="status">
                  <WandSparkles size={12} />
                  <span>{lastAppliedAgent.plan.agentName} · {PROMPT_VARIANT_LABELS[lastAppliedAgent.variant]}</span>
                  <button
                    type="button"
                    className="agent-applied-chip-clear"
                    onClick={() => setLastAppliedAgent(null)}
                    title="清除 Agent 标签（保留提示词）"
                    aria-label="清除 Agent 标签"
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
              <button
                type="button"
                className="agent-expand-button"
                onClick={() => setIsAgentQuickbarExpanded((value) => !value)}
                aria-expanded={isAgentQuickbarExpanded}
                title={isAgentQuickbarExpanded ? "收起行业 Agent 快捷入口" : "展开行业 Agent 快捷入口"}
              >
                {isAgentQuickbarExpanded ? "收起" : "展开"}
                <ChevronRight size={13} />
              </button>
              {isAgentHintVisible && (
                <div className="agent-entry-hint" role="status">
                  选择行业工作流，不填也能生成标准图
                </div>
              )}
              {isAgentQuickbarExpanded && (
                <div className="agent-chip-row" aria-label="行业 Agent 快捷入口">
                  {runtimeIndustryAgents.slice(0, 8).map((agent) => (
                    <button
                      type="button"
                      key={agent.id}
                      className={`agent-chip ${selectedAgentId === agent.id ? "active" : ""}`}
                      title={agent.clickHint}
                      onClick={() => openAgentPanel(agent.id)}
                    >
                      <span>{agent.icon}</span>
                      {agent.name}
                      <small>{selectedAgentId === agent.id ? "已选" : "开启"}</small>
                      <ChevronRight size={12} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {isAgentPanelOpen && (
            <div className="agent-modal">
              <button
                type="button"
                className="agent-modal-backdrop"
                aria-label="关闭行业 Agent 背景"
                onClick={() => setIsAgentPanelOpen(false)}
              />
              <section className="agent-panel" role="dialog" aria-modal="true" aria-label="行业 Agent">
                <div className="agent-panel-head">
                  <div>
                    <span className="eyebrow">AI + Image workflow</span>
                    <strong>行业 Agent</strong>
                    <p>选择行业即可生成标准方案。下方信息可选填，不填写也会使用行业默认值。</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    title="关闭行业 Agent"
                    aria-label="关闭行业 Agent"
                    onClick={() => setIsAgentPanelOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="agent-layout">
                  <div className="agent-list" aria-label="行业 Agent 列表">
                    {runtimeIndustryAgents.map((agent) => (
                      <button
                        type="button"
                        key={agent.id}
                        className={`agent-list-item ${selectedAgentId === agent.id ? "active" : ""}`}
                        onClick={() => selectAgent(agent)}
                      >
                        <span>{agent.icon}</span>
                        <div>
                          <strong>{agent.name}</strong>
                          <small>{agent.tag} · {agent.recommendedRatio}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="agent-workspace">
                    {selectedAgent ? (
                      <>
                    <div className="agent-current">
                      <div>
                        <strong>{selectedAgent.name}</strong>
                        <span>{selectedAgent.description}</span>
                        <small>{selectedAgent.emptyStateHint}</small>
                      </div>
                      <div className="agent-meta-pills">
                        <span>{selectedAgent.recommendedRatio}</span>
                        <span>{selectedAgent.defaultCount} 张</span>
                        <span>{selectedAgent.defaultQuality}</span>
                      </div>
                    </div>
                    {agentPlan && (
                      <div className="agent-plan">
                        <div className="agent-brief">
                          <strong>生图 Brief</strong>
                          <p>{agentPlan.brief}</p>
                        </div>
                        <div className="agent-variant-grid">
                          {(Object.keys(agentPlan.promptVariants) as PromptVariant[]).map((variant) => (
                            <button
                              type="button"
                              className={`agent-variant-card ${variant === "stable" ? "recommended" : ""}`}
                              key={variant}
                              onClick={() => applyAgentVariant(variant)}
                            >
                              <strong>{PROMPT_VARIANT_LABELS[variant]}</strong>
                              <span>{agentPlan.promptVariants[variant]}</span>
                              <small>应用到提示词，可继续编辑</small>
                            </button>
                          ))}
                        </div>
                        <div className="agent-note-grid">
                          {agentPlan.notes.map((note) => <span key={note}>{note}</span>)}
                        </div>
                      </div>
                    )}
                    <div className="agent-form-grid">
                      {selectedAgent.fields.map((field) => (
                        <label className={field.type === "textarea" ? "agent-field wide" : "agent-field"} key={field.id}>
                          <span>{field.label}{field.required ? " · 建议" : ""}</span>
                          {field.type === "select" ? (
                            <select value={agentValues[field.id] || field.defaultValue || ""} onChange={(event) => updateAgentValue(field.id, event.target.value)}>
                              {(field.options || []).map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : field.type === "textarea" ? (
                            <textarea
                              rows={3}
                              value={agentValues[field.id] || ""}
                              placeholder={field.placeholder}
                              onChange={(event) => updateAgentValue(field.id, event.target.value)}
                            />
                          ) : (
                            <input
                              value={agentValues[field.id] || ""}
                              placeholder={field.placeholder}
                              onChange={(event) => updateAgentValue(field.id, event.target.value)}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="agent-supplement-row">
                      {selectedAgent.supplements.map((item) => <span key={item}>{item}</span>)}
                      {selectedAgent.qualityChecklist.map((item) => <span key={item}>验收：{item}</span>)}
                    </div>
                    {agentPhase === "planning" && (
                      <div className="agent-scan">
                        <span />
                        <span />
                        <span />
                      </div>
                    )}
                      </>
                    ) : (
                      <div className="agent-empty-select">
                        <WandSparkles size={24} />
                        <strong>先选择一个行业 Agent</strong>
                        <span>默认不启用行业工作流。选择左侧行业后，系统会自动填入行业默认目标、比例、张数和负面提示词。</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="agent-panel-actions">
                  {!selectedAgent ? (
                    <button type="button" className="primary-action compact" disabled>
                      <WandSparkles size={15} />
                      先选择行业 Agent
                    </button>
                  ) : agentPlan ? (
                    <>
                      {(Object.keys(agentPlan.promptVariants) as PromptVariant[]).map((variant) => (
                        <button
                          type="button"
                          className={variant === "stable" ? "primary-action compact" : "subtle-button"}
                          key={variant}
                          onClick={() => applyAgentVariant(variant)}
                        >
                          <WandSparkles size={15} />
                          应用{PROMPT_VARIANT_LABELS[variant]}到提示词
                        </button>
                      ))}
                      <button type="button" className="subtle-button" onClick={generateAgentPlan} disabled={agentPhase === "planning"}>
                        {agentPhase === "planning" ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
                        重新生成方案
                      </button>
                    </>
                  ) : (
                    <button type="button" className="primary-action compact" onClick={generateAgentPlan} disabled={agentPhase === "planning"}>
                      {agentPhase === "planning" ? <Loader2 size={15} className="spin" /> : <WandSparkles size={15} />}
                      生成行业方案
                    </button>
                  )}
                  {selectedAgent && (
                    <button type="button" className="subtle-button danger" onClick={disableAgent}>
                      停用行业 Agent
                    </button>
                  )}
                  <button
                    type="button"
                    className="subtle-button"
                    onClick={() => setIsAgentPanelOpen(false)}
                  >
                    取消
                  </button>
                </div>
              </section>
            </div>
          )}
          {isAgentModeEnabled && (
            <AgentModeStatusPanel
              state={agentModeState}
              onClear={() => {
                setAgentModePendingPlan(null);
                setAgentModeBrochureDraft(null);
                setAgentModeState({ status: "idle", message: "" });
              }}
              onReanalyze={() => void requestAgentModeReanalysis()}
            />
          )}
          {!isAgentModeEnabled && showPromptPresets && (
            <div className="prompt-presets-panel">
              <div className="prompt-presets-head">
                <div>
                  <strong>预设提示词</strong>
                  <span>点击模板填入输入框，填入后仍可继续编辑。</span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  title="收起预设提示词"
                  onClick={() => setShowPromptPresets(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="prompt-presets-grid">
                {runtimePromptStarters.map((starter) => (
                  <button
                    type="button"
                    className="prompt-preset-card"
                    key={starter.label}
                    onClick={() => applyPromptStarter(starter.prompt)}
                  >
                    <span>{starter.tag}</span>
                    <strong>{starter.label}</strong>
                    <small>{starter.prompt}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {referenceImages.length > 0 && (
            <div className="reference-strip">
              {!protocolDefinition.supportsReferenceImages && (
                <div className="reference-warning">当前协议暂不发送参考图，切回兼容协议或 Gemini Native 后生效</div>
              )}
              {referenceImages.map((image) => (
                <div className={`reference-chip ${image.status || "ready"}`} key={image.id}>
                  {image.dataUrl ? (
                    <img src={image.thumbnailDataUrl || image.dataUrl} alt="" />
                  ) : (
                    <div className="reference-thumb-fallback">
                      <AlertCircle size={16} />
                    </div>
                  )}
                  <div className="reference-chip-copy">
                    <span title={image.name}>{image.name}</span>
                    <small title={image.message || ""}>
                      {referenceDimensionLabel(image)} · {formatReferenceType(image.type)} · {formatBytes(image.size)}
                    </small>
                  </div>
                  <div className="reference-status" title={image.message || "可用"}>
                    {image.status === "error" ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                  </div>
                  {image.dataUrl && (
                    <button type="button" title="收藏到参考图库（仅存本机）" onClick={() => void addReferenceToLibrary(image)}>
                      <Star size={14} />
                    </button>
                  )}
                  <button type="button" title="移除参考图" onClick={() => removeReference(image.id)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!isAgentModeEnabled && analysisState.status !== "idle" && (
            <div className={`prompt-analysis-panel ${analysisState.status} risk-${analysisResult?.riskLevel || "low"}`}>
              <div className="analysis-panel-head">
                <div className="analysis-orb" aria-hidden="true">
                  {(analysisState.status === "analyzing" || analysisState.status === "receiving") ? <Loader2 size={16} className="spin" /> : <WandSparkles size={16} />}
                </div>
                <div>
                  <strong>
                    {analysisState.status === "receiving"
                      ? "正在接收结果"
                      : analysisState.message || analysisModeLabel(analysisState.mode)}
                  </strong>
                  <span>
                    {analysisState.status === "analyzing"
                      ? currentAnalysisMessage
                      : analysisState.status === "receiving"
                        ? analysisState.message || "AI 正在流式返回..."
                        : analysisResult
                          ? `${analysisSourceLabel} · 评分 ${analysisResult.score}`
                          : analysisState.error || "可以稍后重试"}
                  </span>
                  {(analysisState.streamChunks || analysisState.streamCharacters) && (
                    <small className="analysis-stream-progress">
                      {`进度 · ${analysisState.streamChunks || 0} 段 / ${analysisState.streamCharacters || 0} 字`}
                    </small>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-button"
                  title="关闭智能建议"
                  onClick={() => {
                    cancelAnalysisCountdown();
                    setAnalysisState({ status: "idle", mode: "send", message: "" });
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {analysisCountdown && (
                <div className="analysis-countdown">
                  <div>
                    <strong>{analysisCountdown.secondsLeft}s</strong>
                    <span>{analysisCountdown.label}</span>
                  </div>
                  <div className="analysis-countdown-track" aria-hidden="true">
                    <span style={{ width: `${(analysisCountdown.secondsLeft / 10) * 100}%` }} />
                  </div>
                  <button type="button" className="subtle-button" onClick={abandonAnalysisCountdown}>
                    停止自动生成
                  </button>
                </div>
              )}

              {(analysisState.status === "analyzing" || analysisState.status === "receiving") && (
                <div className="analysis-scan">
                  <span />
                  <span />
                  <span />
                </div>
              )}

              {analysisState.streamPreview && (analysisState.status === "analyzing" || analysisState.status === "receiving") && (
                <pre className="analysis-stream-preview">{analysisState.streamPreview}</pre>
              )}

              {analysisState.status === "error" && (
                <div className="analysis-error">
                  <AlertCircle size={16} />
                  <span>{analysisState.error || "分析接口暂时不可用"}</span>
                  {analysisState.mode === "send" && (
                    <button type="button" className="subtle-button" onClick={() => continueFromAnalysis()}>
                      跳过分析继续生成
                    </button>
                  )}
                </div>
              )}

              {analysisResult && analysisState.status === "ready" && (
                <>
                  <div className="analysis-summary">
                    <div className={`risk-badge ${analysisResult.riskLevel}`}>
                      {analysisResult.riskLevel === "high" ? "高风险" : analysisResult.riskLevel === "medium" ? "建议优化" : "可直接生成"}
                    </div>
                    <p>{analysisResult.summary}</p>
                  </div>

                  {analysisResult.risks.length > 0 && (
                    <div className="analysis-section">
                      <strong>失败预判</strong>
                      <div className="analysis-risk-list">
                        {analysisResult.risks.slice(0, 4).map((risk) => (
                          <div className={`analysis-risk ${risk.level}`} key={`${risk.title}-${risk.level}`}>
                            <span>{risk.title}</span>
                            <small>{risk.description}{risk.fix ? ` · 建议：${risk.fix}` : ""}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="analysis-section">
                    <strong>参数推荐</strong>
                    <div className="analysis-param-grid">
                      <span>比例 <b>{suggestedRatio || params.aspectRatio}</b></span>
                      <span>尺寸 <b>{suggestedSize || resolvedRequestSize}</b></span>
                      <span>张数 <b>{suggestedCount || params.batchCount}</b></span>
                      <span>风格 <b>{analysisResult.suggestedParams.styleStrength || "medium"}</b></span>
                    </div>
                  </div>

                  <div className="analysis-section">
                    <strong>提示词优化</strong>
                    <div className="optimized-prompt-preview">{analysisResult.optimizedPrompt}</div>
                  </div>

                  {analysisResult.styleEnhancements.length > 0 && (
                    <div className="analysis-section">
                      <strong>风格增强</strong>
                      <div className="style-enhancement-row">
                        {analysisResult.styleEnhancements.slice(0, 4).map((enhancement) => (
                          <button
                            type="button"
                            key={enhancement.name}
                            className="style-enhancement-chip"
                            title={enhancement.description}
                            onClick={() => appendStyleEnhancement(enhancement)}
                          >
                            {enhancement.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="analysis-actions">
                    {analysisState.mode === "send" ? (
                      <>
                        <button
                          type="button"
                          className="primary-action compact"
                          onClick={() => continueFromAnalysis({ useOptimizedPrompt: true, applyRecommendedParams: true })}
                        >
                          <WandSparkles size={15} />
                          使用优化版生成
                        </button>
                        <button type="button" className="subtle-button" onClick={() => continueFromAnalysis()}>
                          原样继续
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="primary-action compact" onClick={() => applyOptimizedPrompt(analysisResult)}>
                          <WandSparkles size={15} />
                          应用优化提示词
                        </button>
                        <button type="button" className="subtle-button" onClick={() => applySuggestedParams(analysisResult)}>
                          应用推荐参数
                        </button>
                      </>
                    )}
                    <button type="button" className="subtle-button" onClick={() => copyPrompt(analysisResult.optimizedPrompt)}>
                      <Copy size={15} />
                      复制优化版
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <div className={`composer-main ${isAgentModeEnabled ? "is-agent-mode" : ""}`}>
            <button
              type="button"
              className="icon-button upload-button"
              title="上传参考图"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud size={19} />
            </button>
            <button
              type="button"
              className="icon-button upload-button"
              title="从参考图库选择（本机收藏）"
              onClick={() => { void refreshReferenceLibrary(); setIsRefLibraryOpen(true); }}
            >
              <Star size={18} />
            </button>
            {!isAgentModeEnabled && (
              <button
                type="button"
                className={`icon-button preset-toggle-button ${!showPromptPresets && !prompt.trim() ? "is-guiding" : ""}`}
                title={showPromptPresets ? "收起预设提示词" : "查看预设提示词"}
                aria-expanded={showPromptPresets}
                onClick={() => setShowPromptPresets((value) => !value)}
              >
                <WandSparkles size={18} />
                <span>预设</span>
              </button>
            )}
            <textarea
              ref={promptTextareaRef}
              value={prompt}
              onChange={(event) => updatePromptValue(event.target.value)}
              onInput={resizePromptTextarea}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  requestStartBatch();
                }
              }}
              placeholder={
                isAgentModeEnabled
                  ? "上传参考图后，直接描述你想做一张图、一组不同图片，或一本宣传画册..."
                  : "描述你想生成的图片..."
              }
              aria-label="提示词"
              rows={1}
            />
            {!isAgentModeEnabled && (
              <button
                type="button"
                className={`composer-config-button ${isSettingsOpen ? "active" : ""}`}
                title={`打开生成配置：${composerConfigSummary} · ${composerConfigDetail}`}
                aria-label={`打开生成配置，当前 ${composerConfigSummary}`}
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings2 size={15} />
                <span>{params.batchCount}张</span>
                <span>{params.aspectRatio}</span>
                <span>{selectedResolution}</span>
              </button>
            )}
            <button
              type="button"
              className={`send-button${isSendLaunching ? " is-launching" : ""}`}
              title={
                blockedReason
                  ? blockedReason
                  : isAgentModeEnabled
                    ? agentModeState.status === "analyzing"
                      ? "正在理解任务"
                      : "开始由 Agent 自动编排"
                    : isPromptAnalyzing
                      ? "正在分析提示词"
                      : "生成"
              }
              aria-label={isAgentModeEnabled ? "开始 Agent 编排" : "生成图片"}
              disabled={!canRequestGenerate}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                requestStartBatch();
              }}
              onClick={() => requestStartBatch()}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                requestStartBatch();
              }}
            >
              <span className="send-button__trail" aria-hidden="true" />
              <span className="send-button__plane" aria-hidden="true">
                <Send size={18} />
              </span>
            </button>
          </div>
          {!isAgentModeEnabled && (
            <>
              <div className="prompt-assist-bar" aria-label="智能创作工具">
                <button type="button" disabled={!prompt.trim() || isPromptAnalyzing} onClick={() => void requestPromptAssist("optimize")}>
                  <WandSparkles size={14} />
                  优化提示词
                </button>
                <button type="button" disabled={!prompt.trim() || isPromptAnalyzing} onClick={() => void requestPromptAssist("params")}>
                  <Settings2 size={14} />
                  参数推荐
                </button>
                <button type="button" disabled={!prompt.trim() || isPromptAnalyzing} onClick={() => void requestPromptAssist("risk")}>
                  <ShieldCheck size={14} />
                  失败预判
                </button>
                <button type="button" disabled={!prompt.trim() || isPromptAnalyzing} onClick={() => void requestPromptAssist("style")}>
                  <WandSparkles size={14} />
                  风格增强
                </button>
              </div>
              <div className="composer-meta">
                <span className={referenceIssueCount > 0 ? "has-error" : referenceWarningCount > 0 ? "has-warning" : ""}>
                  {referenceMetaLabel}
                </span>
                {/* 只在「有提示词但仍不能生成」时提示——空输入框时提示「请输入提示词」是噪声 */}
                {blockedReason && prompt.trim().length > 0 && (
                  <span className="composer-config-meta has-error">{blockedReason}</span>
                )}
                <label className="composer-auto-toggle" title="发送前自动优化提示词">
                  <input
                    type="checkbox"
                    checked={isAutoPromptAnalysisEnabled}
                    onChange={(event) => setIsAutoPromptAnalysisEnabled(event.target.checked)}
                  />
                  <span>发送前优化</span>
                </label>
                <span>{prompt.trim().length} 字</span>
              </div>
            </>
          )}
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            multiple
            onChange={onReferenceInput}
          />
        </form>
        {agentModePendingPlan && (
          <AgentModePlanModal
            plan={agentModePendingPlan}
            onCancel={() => {
              setAgentModePendingPlan(null);
              setAgentModeState({
                status: "idle",
                message: "已取消自动拆解，请继续修改需求。",
              });
            }}
            onReanalyze={() => void requestAgentModeReanalysis()}
            onConfirm={() => enqueueAgentModeJobs(agentModePendingPlan.jobs, {
              analysisResult: agentModePendingPlan,
              clearComposer: true,
              scenarioLabel: "自动拆解任务",
            })}
          />
        )}
        {agentModeBrochureDraft && (
          <BrochurePlannerModal
            project={agentModeBrochureDraft}
            onCancel={() => {
              setAgentModeBrochureDraft(null);
              setAgentModeState({
                status: "idle",
                message: "已取消画册规划，请继续补充你的要求。",
              });
            }}
            onReanalyze={() => void requestAgentModeReanalysis()}
            onGenerateBoards={() => submitBrochureStyleBoards(agentModeBrochureDraft)}
          />
        )}
      </main>

      <aside className={`settings-panel ${isSettingsOpen ? "open" : "closed"}`}>
        <div className="panel-header">
          <div>
            <strong>配置</strong>
            <span>API 与生成参数</span>
          </div>
          <button
            className="icon-button"
            type="button"
            title="收起配置"
            aria-label="收起配置"
            onClick={() => setIsSettingsOpen(false)}
          >
            <PanelRightClose size={16} />
          </button>
        </div>

        <section className="settings-section" data-onboarding-target="api">
          <label>
            <span>生图协议</span>
            <select
              value={apiConfig.protocol}
              onChange={(event) => changeProtocol(event.target.value as ImageProtocol)}
            >
              {PROTOCOLS.map((protocol) => (
                <option key={protocol.value} value={protocol.value}>
                  {protocol.label}
                </option>
              ))}
            </select>
          </label>
          <div className="protocol-note">
            <strong>{protocolDefinition.shortLabel}</strong>
            <span>{protocolDefinition.description}</span>
            <small>{formatProtocolCapability(apiConfig.protocol)}</small>
          </div>
          <label>
            <span>API URL</span>
            <select
              value={apiConfig.baseUrl}
              onChange={(event) => setApiConfig((current) => ({ ...current, baseUrl: normalizeApiBaseUrl(event.target.value) }))}
            >
              {runtimeEndpoints.map((endpoint) => (
                <option key={endpoint.value} value={endpoint.value}>
                  {endpoint.label}
                </option>
              ))}
            </select>
          </label>
          <div className="endpoint-note">
            {runtimeEndpoints.find((endpoint) => endpoint.value === apiConfig.baseUrl)?.description || "固定服务地址"}
          </div>
          <label>
            <span>API Key</span>
            <input
              value={apiConfig.apiKey}
              type="password"
              onChange={(event) => setApiConfig((current) => ({ ...current, apiKey: event.target.value }))}
              spellCheck={false}
            />
          </label>
          <div className="prompt-group-hint api-key-hint" role="note">
            <WandSparkles size={14} />
            <span>
              推荐使用 <strong>banana Pro 官转</strong> 或 <strong>OpenRouter</strong> 分组。
            </span>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={apiConfig.rememberKey}
              onChange={(event) => setApiConfig((current) => ({ ...current, rememberKey: event.target.checked }))}
            />
            <span>记住 API Key</span>
          </label>
          <label className="check-row" title="勾选后，推荐到广场的作品不公开提示词，仅展示生成参数">
            <input
              type="checkbox"
              checked={hidePromptOnShare}
              onChange={(event) => {
                setHidePromptOnShare(event.target.checked);
                try { localStorage.setItem("imageStudioHidePromptOnShare", String(event.target.checked)); } catch { /* 忽略 */ }
              }}
            />
            <span>推荐到广场时隐藏提示词</span>
          </label>
          <div className="api-key-storage-note" role="note">
            <span>
              {apiConfig.rememberKey
                ? "Key 以明文保存在本机浏览器，换人使用请先清除。"
                : "Key 仅保留在本次会话，关闭浏览器即失效。"}
            </span>
            {apiConfig.apiKey ? (
              <button type="button" className="subtle-button" onClick={clearApiKey}>
                清除 Key
              </button>
            ) : null}
          </div>
          <button className="primary-action" type="button" onClick={() => void loadModels()} disabled={modelState.status === "loading"}>
            {modelState.status === "loading" ? <Loader2 size={17} className="spin" /> : <RefreshCw size={17} />}
            读取/刷新模型
          </button>
          <div className={`status-line ${isAutoLoadingModels ? "loading" : modelState.status}`}>
            {isAutoLoadingModels ? (
              <Loader2 size={15} className="spin" />
            ) : modelState.status === "ready" ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertCircle size={15} />
            )}
            <span>{modelStatusMessage}</span>
          </div>
          <label>
            <span>智能分析 AI</span>
            <select
              value={preferredAnalysisModel}
              disabled={analysisModels.length === 0}
              onChange={(event) => setSelectedAnalysisModel(event.target.value)}
            >
              {analysisModels.length === 0 ? (
                <option value="">未检测到 GPT 分析模型</option>
              ) : (
                analysisModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              )}
            </select>
          </label>
          <div className={`status-line ${analysisModels.length > 0 ? "ready" : "idle"}`}>
            {analysisModels.length > 0 ? <ShieldCheck size={15} /> : <AlertCircle size={15} />}
            <span>
              {!isAutoPromptAnalysisEnabled
                ? "已关闭发送前自动优化，点击发送会直接进入生图队列"
                : analysisModels.length > 0
                ? `发送前使用 ${preferredAnalysisModel} 做提示词优化、参数推荐和失败预判`
                : "没有 GPT 文本模型时，会先使用本地规则预检"}
            </span>
          </div>
          <div className="local-save-note">
            <Database size={15} />
            <span>生成图片和历史仅保存到当前浏览器本地，服务端只做无状态协议转发。</span>
          </div>
        </section>

        <section className="settings-section" data-onboarding-target="model">
          <div className="section-label with-note">
            <span>可用生图模型</span>
            <small>支持 GPT Image 2 与 Gemini 3 Pro Image Preview，选择后自动切换接口格式</small>
          </div>
          <div className="search-input">
            <Search size={16} />
            <input
              value={modelFilter}
              placeholder="筛选模型"
              onChange={(event) => setModelFilter(event.target.value)}
            />
          </div>
          <div className="model-list">
            {filteredModels.length === 0 ? (
              <div className="muted-box">
                {selectableImageModels.length === 0 ? "暂无可用图片模型" : "无匹配模型"}
              </div>
            ) : (
              filteredModels.map((model) => (
                <button
                  type="button"
                  key={model}
                  className={selectedModel === model ? "selected" : ""}
                  onClick={() => selectImageModel(model)}
                >
                  <span>{model}</span>
                  <small>
                    {imageModelLaneLabel(model)}
                    {(() => {
                      const stat = modelStats[normalizedModelId(model)];
                      if (!stat || stat.samples < 3) return null;
                      return ` · 近7日成功率 ${stat.successRate}% · P50 ${formatCompactDuration(stat.p50DurationMs)}`;
                    })()}
                  </small>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="settings-section recipe-section">
          <label>
            <span>配方（本机保存的提示词 + 参数组合）</span>
            <div className="recipe-row">
              <select
                value=""
                onChange={(event) => {
                  const recipe = recipes.find((r) => r.id === event.target.value);
                  if (recipe) applyRecipe(recipe);
                }}
              >
                <option value="">{recipes.length > 0 ? "选择配方应用…" : "还没有配方"}</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} · {r.model}</option>
                ))}
              </select>
              <button type="button" className="subtle-button" title="把当前提示词与参数存为配方" onClick={() => void saveCurrentAsRecipe()}>
                <Save size={14} /> 存
              </button>
              {recipes.length > 0 && (
                <button type="button" className="subtle-button" title="导出全部配方为 JSON" onClick={exportRecipes}>
                  <DownloadCloud size={14} />
                </button>
              )}
            </div>
          </label>
          {recipes.length > 0 && (
            <details className="recipe-manage">
              <summary>管理配方（{recipes.length}/{RECIPES_LIMIT}）</summary>
              <div className="recipe-manage-list">
                {recipes.map((r) => (
                  <div key={r.id} className="recipe-manage-item">
                    <span title={r.prompt}>{r.name}</span>
                    <button type="button" className="icon-button" title="删除该配方" onClick={() => void deleteRecipeById(r.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        <section className="settings-section compact-grid">
          <label>
            <span>宽高比</span>
            <select
              value={params.aspectRatio}
              onChange={(event) => updateParams({ aspectRatio: event.target.value })}
            >
              {supportedAspectOptions.map((ratio) => (
                <option
                  key={ratio.value}
                  value={ratio.value}
                >
                  {ratio.label}
                </option>
              ))}
            </select>
          </label>
          <div className={`ratio-preview ${aspectRatioSupported ? "" : "unsupported"}`}>
            <strong>{selectedAspectRatio.value}</strong>
            <span>{selectedAspectHint}</span>
            <small>{aspectRatioSupported ? `${selectedResolution} · 请求尺寸 ${resolvedRequestSize}` : "当前协议不支持此比例"}</small>
          </div>
          <label>
            <span>分辨率</span>
            <select
              value={selectedResolution}
              disabled={isOfficialGptImageSizeMode}
              onChange={(event) => updateParams({ resolution: event.target.value as ImageResolution })}
            >
              {IMAGE_RESOLUTIONS.map((item) => (
                <option key={item.value} value={item.value} disabled={isOfficialGptImageSizeMode && item.value !== "1K"}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ratio-preview">
            <strong>{selectedResolution}</strong>
            <span>{selectedResolutionDefinition.hint}</span>
            <small>{isOfficialGptImageSizeMode ? "该 image-2 模型使用官方固定尺寸" : isGemini3ProImageModel(selectedModel) ? "Gemini 3 Pro 会以 imageSize 传递 1K/2K/4K" : supportsGptImage2ExplicitSizes(selectedModel) ? "GPT Image 2 支持显式 2K/4K 尺寸" : "尺寸会随宽高比自动换算"}</small>
          </div>
          {explicitSizeOptions.length > 0 && (
            <>
              <label>
                <span>尺寸</span>
                <select
                  value={resolvedRequestSize}
                  onChange={(event) => {
                    const option = gptImage2SizeOptionForSize(event.target.value);
                    if (!option) return;
                    updateParams({
                      aspectRatio: option.aspectRatio,
                      resolution: option.resolution,
                      size: option.size,
                    });
                  }}
                >
                  {explicitSizeOptions.map((option) => (
                    <option key={option.size} value={option.size}>
                      {option.size} · {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ratio-preview">
                <strong>{resolvedRequestSize}</strong>
                <span>{selectedExplicitSizeOption?.label || "GPT Image 2 显式尺寸"}</span>
                <small>{selectedResolution} · {params.aspectRatio}</small>
              </div>
            </>
          )}
          <label>
            <span>张数</span>
            <input
              type="number"
              min={1}
              max={20}
              value={params.batchCount}
              onChange={(event) => updateParams({ batchCount: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>并发</span>
            <input
              type="number"
              min={1}
              max={6}
              value={params.concurrency}
              onChange={(event) => updateParams({ concurrency: Number(event.target.value) })}
            />
          </label>
        </section>

        {/* 低频参数按使用频率折叠（设计修订 §六.2）：高频的张数/比例/分辨率保持一击可达 */}
        <details className="settings-advanced">
          <summary>
            <ChevronRight size={14} />
            高级参数
            <small>质量 · 格式 · 重试 · Seed · 负面词</small>
          </summary>
          <div className="settings-section compact-grid">
            <label>
              <span>质量</span>
              <select
                value={params.quality}
                disabled={!protocolDefinition.supportsQuality}
                onChange={(event) => updateParams({ quality: event.target.value })}
              >
                <option value="auto">auto</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>
              <span>格式</span>
              <select
                value={params.outputFormat}
                disabled={!protocolDefinition.supportsOutputFormat}
                onChange={(event) => updateParams({ outputFormat: event.target.value as ImageParams["outputFormat"] })}
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <label title="生成失败时（5xx / 429 / 网络错误）自动重试的次数。范围 0–5，默认 2。">
              <span>失败自动重试</span>
              <input
                type="number"
                min={0}
                max={5}
                value={params.retryLimit}
                onChange={(event) => updateParams({ retryLimit: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Seed</span>
              <input value={params.seed} onChange={(event) => updateParams({ seed: event.target.value })} />
            </label>
          </div>
          <div className="settings-section">
            <label>
              <span>负面提示词</span>
              <textarea
                value={params.negativePrompt}
                rows={3}
                onChange={(event) => updateParams({ negativePrompt: event.target.value })}
                placeholder="不想出现的内容"
              />
            </label>
          </div>
        </details>
      </aside>

      {isRefLibraryOpen && (
        <ReferenceLibraryModal
          items={referenceLibrary}
          onUse={(item) => void useLibraryItem(item)}
          onDelete={(id) => void deleteLibraryItem(id)}
          onClose={() => setIsRefLibraryOpen(false)}
        />
      )}
      {isFeedbackOpen && (
        <FeedbackModal
          apiKey={apiConfig.apiKey}
          baseUrl={apiConfig.baseUrl}
          analysisModel={selectedAnalysisModel}
          onClose={() => setIsFeedbackOpen(false)}
        />
      )}
      {previewItem && (
        <ImagePreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onDownload={() => {
            if (!previewItem.url) return;
            downloadUrl(
              previewItem.url,
              `${previewItem.model}-${previewItem.width || "image"}x${previewItem.height || "image"}-${previewItem.id}.${previewItem.params.outputFormat}`,
            );
          }}
          onCopyPrompt={() => copyPrompt(previewItem.prompt)}
          onRecommend={() => void recommendToSquare(previewItem)}
          recommendState={squareRecommendState[previewItem.id]}
          canRecommend={canUseSquareIdentity}
        />
      )}
      {pendingDeleteIds && (
        <ConfirmDialog
          title="删除本地记录"
          body={`将从当前浏览器本地删除 ${pendingDeleteRecords.length} 条记录，此操作不可撤销。运行中的任务不会被删除。`}
          confirmLabel="删除"
          onCancel={() => setPendingDeleteIds(null)}
          onConfirm={() => void confirmBulkDelete()}
        />
      )}
      {showOnboarding && (
        <OnboardingGuide
          step={onboardingStep}
          canGenerate={canGenerate}
          modelState={modelState}
          selectedModel={selectedModel}
          apiKeyReady={apiConfig.apiKey.trim().length > 0}
          onStepChange={setOnboardingStep}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onFinish={completeOnboarding}
        />
      )}
    </div>
    </>
  );
}

type AdminConfigUpstream = { id: string; name: string; baseUrl: string; enabled: boolean; note?: string; sort: number };
type AdminConfigModel = { id: string; displayName: string; sizing: "explicit-2k4k" | "official-1k"; enabled: boolean; sort: number; tags?: string[] };
type AdminConfigData = {
  version: number;
  updatedAt: string;
  upstreams: AdminConfigUpstream[];
  models: AdminConfigModel[];
  presets: {
    promptStarters: unknown[] | null;
    stylePresets: unknown[] | null;
    industryAgents: unknown[] | null;
    negativePrompt: string | null;
  };
  systemPrompts: { agentAnalyze: string; promptAnalyze: string };
  tokenGuide?: { enabled: boolean; siteName: string; tokenUrl: string; groupName: string; note: string };
  quotas: { squareShelfLimit: number; squareDailyRecommend: number; squareDailyLike: number; squareMaxFeed: number; generationDailyLimit?: number; userDiskLimitMB?: number };
  timeouts?: { apiTimeoutMs: number; generationTimeoutMs: number };
};

type ConfigSection = "sites" | "presets" | "system";

function AdminConfigCenter() {
  const [config, setConfig] = useState<AdminConfigData | null>(null);
  const [section, setSection] = useState<ConfigSection>("sites");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  const [upstreams, setUpstreams] = useState<AdminConfigUpstream[]>([]);
  const [models, setModels] = useState<AdminConfigModel[]>([]);
  const [promptStarters, setPromptStarters] = useState<Array<{ label: string; tag: string; prompt: string }>>([]);
  const [stylePresets, setStylePresets] = useState<StyleEnhancement[]>([]);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [industryAgents, setIndustryAgents] = useState<IndustryAgent[]>([]);
  const [openAgentId, setOpenAgentId] = useState("");
  const [agentAnalyze, setAgentAnalyze] = useState("");
  const [promptAnalyze, setPromptAnalyze] = useState("");
  const [quotas, setQuotas] = useState({ squareShelfLimit: 4, squareDailyRecommend: 10, squareDailyLike: 10, squareMaxFeed: 20, generationDailyLimit: 0, userDiskLimitMB: 0 });
  const [tokenGuide, setTokenGuide] = useState({ enabled: true, siteName: "", tokenUrl: "", groupName: "", note: "" });
  // 表单里用「秒」，存下去换成毫秒：管理员填 1200 比填 1200000 不容易错一个零
  const [timeoutSec, setTimeoutSec] = useState({ api: 300, generation: 1200 });

  function hydrate(data: AdminConfigData) {
    setConfig(data);
    setUpstreams(data.upstreams.map((u) => ({ ...u })));
    setModels(data.models.map((m) => ({ ...m, tags: m.tags || [] })));
    setPromptStarters((Array.isArray(data.presets.promptStarters) ? data.presets.promptStarters : PROMPT_STARTERS) as Array<{ label: string; tag: string; prompt: string }>);
    setStylePresets((Array.isArray(data.presets.stylePresets) ? data.presets.stylePresets : STYLE_ENHANCEMENT_PRESETS) as StyleEnhancement[]);
    setNegativePrompt(typeof data.presets.negativePrompt === "string" ? data.presets.negativePrompt : COMMON_AGENT_NEGATIVE_PROMPT);
    setIndustryAgents((Array.isArray(data.presets.industryAgents) ? data.presets.industryAgents : INDUSTRY_AGENTS) as IndustryAgent[]);
    setAgentAnalyze(data.systemPrompts.agentAnalyze);
    setPromptAnalyze(data.systemPrompts.promptAnalyze);
    setQuotas({ generationDailyLimit: 0, userDiskLimitMB: 0, ...data.quotas });
    // 服务端未下发 tokenGuide 时用空值兜底，避免受控输入退化成非受控
    setTokenGuide({ enabled: true, siteName: "", tokenUrl: "", groupName: "", note: "", ...data.tokenGuide });
    setTimeoutSec({
      api: Math.round((data.timeouts?.apiTimeoutMs ?? 300_000) / 1000),
      generation: Math.round((data.timeouts?.generationTimeoutMs ?? 1_200_000) / 1000),
    });
  }

  async function loadConfig() {
    setError("");
    try {
      const response = await fetch("/api/admin/config", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw payload;
      hydrate(payload.config as AdminConfigData);
    } catch (err) {
      setError(formatError(err));
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  async function saveSection(path: string, body: unknown, label: string) {
    setError("");
    setNotice("");
    setSaving(label);
    try {
      const response = await fetch(`/api/admin/config/${path}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw payload;
      hydrate(payload.config as AdminConfigData);
      void fetchAppConfig(true);
      setNotice(`${label}已保存，配置版本 v${payload.config.version}`);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving("");
    }
  }

  async function resetSection(sectionKey: string, label: string) {
    if (!window.confirm(`确定要把「${label}」恢复为内置默认值吗？当前修改将被覆盖。`)) return;
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/config/reset", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sectionKey }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw payload;
      hydrate(payload.config as AdminConfigData);
      void fetchAppConfig(true);
      setNotice(`${label}已恢复默认`);
    } catch (err) {
      setError(formatError(err));
    }
  }

  if (!config) {
    return (
      <section className="admin-panel">
        <div className="admin-checking"><Loader2 className="spin" size={20} /><span>正在读取配置...</span></div>
        {error && <div className="admin-error">{error}</div>}
      </section>
    );
  }

  return (
    <section className="admin-config">
      <div className="admin-config-subnav">
        <button type="button" className={section === "sites" ? "active" : ""} onClick={() => setSection("sites")}>站点与模型</button>
        <button type="button" className={section === "presets" ? "active" : ""} onClick={() => setSection("presets")}>提示词与场景</button>
        <button type="button" className={section === "system" ? "active" : ""} onClick={() => setSection("system")}>系统设置</button>
        <span className="admin-config-version">配置版本 v{config.version}</span>
      </div>
      {error && <div className="admin-error">{error}</div>}
      {notice && <div className="admin-notice">{notice}</div>}

      {section === "sites" && (
        <div className="admin-config-body">
          <div className="admin-config-block">
            <div className="admin-config-block-head">
              <strong>上游站点</strong>
              <div className="admin-panel-actions">
                <button type="button" className="subtle-button" onClick={() => void resetSection("upstreams", "上游站点")}><RefreshCw size={14} /> 恢复默认</button>
                <button type="button" className="subtle-button" onClick={() => setUpstreams((cur) => [...cur, { id: "", name: "", baseUrl: "https://", enabled: true, note: "", sort: cur.length + 1 }])}><Plus size={14} /> 添加站点</button>
              </div>
            </div>
            <div className="admin-config-rows">
              {upstreams.map((item, index) => (
                <div className="admin-config-row" key={index}>
                  <input placeholder="站点名称" value={item.name} onChange={(e) => setUpstreams((cur) => cur.map((u, i) => i === index ? { ...u, name: e.target.value } : u))} />
                  <input className="mono" placeholder="https://example.com/ 或 http://IP[:端口]" value={item.baseUrl} onChange={(e) => setUpstreams((cur) => cur.map((u, i) => i === index ? { ...u, baseUrl: e.target.value } : u))} />
                  <input placeholder="备注" value={item.note || ""} onChange={(e) => setUpstreams((cur) => cur.map((u, i) => i === index ? { ...u, note: e.target.value } : u))} />
                  <label className="admin-config-toggle"><input type="checkbox" checked={item.enabled} onChange={(e) => setUpstreams((cur) => cur.map((u, i) => i === index ? { ...u, enabled: e.target.checked } : u))} /> 启用</label>
                  <button type="button" className="admin-icon-button" title="删除" onClick={() => setUpstreams((cur) => cur.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" className="primary-button admin-config-save" disabled={saving === "上游站点"} onClick={() => void saveSection("upstreams", { upstreams }, "上游站点")}>
              {saving === "上游站点" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 保存站点
            </button>
          </div>

          <div className="admin-config-block">
            <div className="admin-config-block-head">
              <strong>模型白名单</strong>
              <div className="admin-panel-actions">
                <button type="button" className="subtle-button" onClick={() => void resetSection("models", "模型白名单")}><RefreshCw size={14} /> 恢复默认</button>
                <button type="button" className="subtle-button" onClick={() => setModels((cur) => [...cur, { id: "", displayName: "", sizing: "official-1k", enabled: true, sort: cur.length + 1, tags: [] }])}><Plus size={14} /> 添加模型</button>
              </div>
            </div>
            <div className="admin-config-rows">
              {models.map((item, index) => (
                <div className="admin-config-row admin-config-row-model" key={index}>
                  <input className="mono" placeholder="模型 ID（精确）" value={item.id} onChange={(e) => setModels((cur) => cur.map((m, i) => i === index ? { ...m, id: e.target.value } : m))} />
                  <input placeholder="展示名" value={item.displayName} onChange={(e) => setModels((cur) => cur.map((m, i) => i === index ? { ...m, displayName: e.target.value } : m))} />
                  <select value={item.sizing} onChange={(e) => setModels((cur) => cur.map((m, i) => i === index ? { ...m, sizing: e.target.value as AdminConfigModel["sizing"] } : m))}>
                    <option value="explicit-2k4k">2K / 4K 显式尺寸</option>
                    <option value="official-1k">官方 1K</option>
                  </select>
                  <label className="admin-config-toggle"><input type="checkbox" checked={item.enabled} onChange={(e) => setModels((cur) => cur.map((m, i) => i === index ? { ...m, enabled: e.target.checked } : m))} /> 启用</label>
                  <button type="button" className="admin-icon-button" title="删除" onClick={() => setModels((cur) => cur.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <p className="admin-muted admin-config-hint"><ShieldCheck size={13} /> 模型为精确匹配名单；站点地址支持 http/https 与 IP，但内网、回环及云元数据地址（127.x / 192.168.x / 169.254.x 等）会被拒绝。所有变更写入审计日志并递增版本号。</p>
            <button type="button" className="primary-button admin-config-save" disabled={saving === "模型白名单"} onClick={() => void saveSection("models", { models }, "模型白名单")}>
              {saving === "模型白名单" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 保存模型
            </button>
          </div>
        </div>
      )}

      {section === "presets" && (
        <div className="admin-config-body">
          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>示例提示词</strong>
              <button type="button" className="subtle-button" onClick={() => setPromptStarters((cur) => [...cur, { label: "", tag: "", prompt: "" }])}><Plus size={14} /> 添加</button>
            </div>
            <div className="admin-config-rows">
              {promptStarters.map((item, index) => (
                <div className="admin-config-preset-row" key={index}>
                  <div className="admin-config-preset-head">
                    <input placeholder="标题" value={item.label} onChange={(e) => setPromptStarters((cur) => cur.map((p, i) => i === index ? { ...p, label: e.target.value } : p))} />
                    <input placeholder="标签" value={item.tag} onChange={(e) => setPromptStarters((cur) => cur.map((p, i) => i === index ? { ...p, tag: e.target.value } : p))} />
                    <button type="button" className="admin-icon-button" title="删除" onClick={() => setPromptStarters((cur) => cur.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
                  </div>
                  <textarea placeholder="提示词内容" value={item.prompt} onChange={(e) => setPromptStarters((cur) => cur.map((p, i) => i === index ? { ...p, prompt: e.target.value } : p))} />
                </div>
              ))}
            </div>
          </div>

          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>风格增强预设</strong>
              <button type="button" className="subtle-button" onClick={() => setStylePresets((cur) => [...cur, { name: "", description: "", promptFragment: "" }])}><Plus size={14} /> 添加</button>
            </div>
            <div className="admin-config-rows">
              {stylePresets.map((item, index) => (
                <div className="admin-config-preset-row" key={index}>
                  <div className="admin-config-preset-head">
                    <input placeholder="名称" value={item.name} onChange={(e) => setStylePresets((cur) => cur.map((p, i) => i === index ? { ...p, name: e.target.value } : p))} />
                    <input placeholder="描述" value={item.description} onChange={(e) => setStylePresets((cur) => cur.map((p, i) => i === index ? { ...p, description: e.target.value } : p))} />
                    <button type="button" className="admin-icon-button" title="删除" onClick={() => setStylePresets((cur) => cur.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
                  </div>
                  <textarea placeholder="风格片段（追加到提示词）" value={item.promptFragment} onChange={(e) => setStylePresets((cur) => cur.map((p, i) => i === index ? { ...p, promptFragment: e.target.value } : p))} />
                </div>
              ))}
            </div>
          </div>

          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>通用负面提示词</strong></div>
            <textarea className="admin-config-fulltext" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} />
          </div>

          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>行业 Agent 场景</strong>
              <button type="button" className="subtle-button" onClick={() => {
                const template = (INDUSTRY_AGENTS[0] ? JSON.parse(JSON.stringify(INDUSTRY_AGENTS[0])) : null) as IndustryAgent | null;
                if (!template) return;
                template.id = `agent-${Date.now()}`;
                template.name = "新场景";
                setIndustryAgents((cur) => [...cur, template]);
                setOpenAgentId(template.id);
              }}><Plus size={14} /> 添加场景（克隆）</button>
            </div>
            <div className="admin-config-agent-list">
              {industryAgents.map((agent, index) => (
                <div className="admin-config-agent" key={agent.id || index}>
                  <div className="admin-config-agent-head" onClick={() => setOpenAgentId((cur) => cur === agent.id ? "" : agent.id)}>
                    <ChevronRight size={14} className={openAgentId === agent.id ? "rotated" : ""} />
                    <strong>{agent.name || "未命名场景"}</strong>
                    <span className="admin-muted">{agent.tag}</span>
                    <button type="button" className="admin-icon-button" title="删除" onClick={(e) => { e.stopPropagation(); setIndustryAgents((cur) => cur.filter((_, i) => i !== index)); }}><Trash2 size={15} /></button>
                  </div>
                  {openAgentId === agent.id && (
                    <div className="admin-config-agent-body">
                      <div className="admin-config-grid2">
                        <label>名称<input value={agent.name} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, name: e.target.value } : a))} /></label>
                        <label>标签<input value={agent.tag} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, tag: e.target.value } : a))} /></label>
                        <label>图标<input value={agent.icon} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, icon: e.target.value } : a))} /></label>
                        <label>推荐比例<input value={agent.recommendedRatio} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, recommendedRatio: e.target.value } : a))} /></label>
                      </div>
                      <label>场景描述<textarea value={agent.scenario} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, scenario: e.target.value } : a))} /></label>
                      <label>介绍<textarea value={agent.description} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, description: e.target.value } : a))} /></label>
                      <label>稳定版提示词结构<textarea value={agent.promptStructures?.stable || ""} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, promptStructures: { ...a.promptStructures, stable: e.target.value } } : a))} /></label>
                      <label>创意版提示词结构<textarea value={agent.promptStructures?.creative || ""} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, promptStructures: { ...a.promptStructures, creative: e.target.value } } : a))} /></label>
                      <label>商业版提示词结构<textarea value={agent.promptStructures?.commercial || ""} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, promptStructures: { ...a.promptStructures, commercial: e.target.value } } : a))} /></label>
                      <label>负面提示词<textarea value={agent.negativePrompt} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, negativePrompt: e.target.value } : a))} /></label>
                      <label>质检清单（每行一项）<textarea value={(agent.qualityChecklist || []).join("\n")} onChange={(e) => setIndustryAgents((cur) => cur.map((a, i) => i === index ? { ...a, qualityChecklist: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } : a))} /></label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="admin-config-actions">
            <button type="button" className="subtle-button" onClick={() => void resetSection("presets", "提示词与场景")}><RefreshCw size={14} /> 全部恢复默认</button>
            <button type="button" className="primary-button admin-config-save" disabled={saving === "提示词与场景"} onClick={() => void saveSection("presets", { presets: { promptStarters, stylePresets, industryAgents, negativePrompt } }, "提示词与场景")}>
              {saving === "提示词与场景" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 保存提示词与场景
            </button>
          </div>
        </div>
      )}

      {section === "system" && (
        <div className="admin-config-body">
          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>Agent 分析 System Prompt</strong>
              <span className="admin-muted">{agentAnalyze.length} 字</span>
            </div>
            <textarea className="admin-config-fulltext tall" value={agentAnalyze} onChange={(e) => setAgentAnalyze(e.target.value)} />
          </div>
          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>提示词安全分析 System Prompt</strong>
              <span className="admin-muted">{promptAnalyze.length} 字</span>
            </div>
            <textarea className="admin-config-fulltext tall" value={promptAnalyze} onChange={(e) => setPromptAnalyze(e.target.value)} />
          </div>
          <div className="admin-config-actions">
            <button type="button" className="subtle-button" onClick={() => void resetSection("systemPrompts", "系统提示词")}><RefreshCw size={14} /> 恢复默认提示词</button>
            <button type="button" className="primary-button admin-config-save" disabled={saving === "系统提示词"} onClick={() => void saveSection("system-prompts", { systemPrompts: { agentAnalyze, promptAnalyze } }, "系统提示词")}>
              {saving === "系统提示词" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 保存提示词
            </button>
          </div>

          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>请求超时</strong>
              <span className="admin-muted">单位秒，改完对下一个请求立即生效，无需重启</span>
            </div>
            <div className="admin-config-grid2">
              <label>生成请求超时（秒，30–3600）
                <input
                  type="number"
                  min={30}
                  max={3600}
                  value={timeoutSec.generation}
                  onChange={(e) => setTimeoutSec((t) => ({ ...t, generation: Number(e.target.value) }))}
                />
              </label>
              <label>常规接口超时（秒，10–600）
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={timeoutSec.api}
                  onChange={(e) => setTimeoutSec((t) => ({ ...t, api: Number(e.target.value) }))}
                />
              </label>
            </div>
            <p className="admin-muted admin-config-note">
              生成超时只作用于打上游生图的那一次请求（4K、多图、上游排队都可能很久）；
              常规接口超时管模型列表、OAuth、提示词分析这类交互式请求——把它一起放大，
              会让一个卡死的登录跳转也拖上好几分钟。
              超过 300 秒时服务端会自动放宽 Node fetch 的底层超时；排队判死时长跟着生成超时上浮（至少 30 分钟）。
            </p>
            <div className="admin-config-actions">
              <button type="button" className="subtle-button" onClick={() => void resetSection("timeouts", "请求超时")}><RefreshCw size={14} /> 恢复默认</button>
              <button
                type="button"
                className="primary-button admin-config-save"
                disabled={saving === "请求超时"}
                onClick={() => void saveSection("timeouts", {
                  timeouts: {
                    apiTimeoutMs: Math.round(timeoutSec.api * 1000),
                    generationTimeoutMs: Math.round(timeoutSec.generation * 1000),
                  },
                }, "请求超时")}
              >
                {saving === "请求超时" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 保存超时
              </button>
            </div>
          </div>

          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>配额管理</strong>
              <span className="admin-muted">生成类配额填 0 表示不限制</span>
            </div>
            <div className="admin-config-grid2">
              <label>每用户每日生成上限（次，0 不限）<input type="number" min={0} value={quotas.generationDailyLimit} onChange={(e) => setQuotas((q) => ({ ...q, generationDailyLimit: Number(e.target.value) }))} /></label>
              <label>每用户图片磁盘上限（MB，0 不限）<input type="number" min={0} value={quotas.userDiskLimitMB} onChange={(e) => setQuotas((q) => ({ ...q, userDiskLimitMB: Number(e.target.value) }))} /></label>
              <label>广场货架上限（每人展示）<input type="number" min={1} value={quotas.squareShelfLimit} onChange={(e) => setQuotas((q) => ({ ...q, squareShelfLimit: Number(e.target.value) }))} /></label>
              <label>广场每日推荐上限<input type="number" min={0} value={quotas.squareDailyRecommend} onChange={(e) => setQuotas((q) => ({ ...q, squareDailyRecommend: Number(e.target.value) }))} /></label>
              <label>广场每日点赞上限<input type="number" min={0} value={quotas.squareDailyLike} onChange={(e) => setQuotas((q) => ({ ...q, squareDailyLike: Number(e.target.value) }))} /></label>
              <label>广场信息流单页上限<input type="number" min={1} value={quotas.squareMaxFeed} onChange={(e) => setQuotas((q) => ({ ...q, squareMaxFeed: Number(e.target.value) }))} /></label>
            </div>
            <div className="admin-config-actions">
              <button type="button" className="subtle-button" onClick={() => void resetSection("quotas", "配额")}><RefreshCw size={14} /> 恢复默认</button>
              <button type="button" className="primary-button admin-config-save" disabled={saving === "配额"} onClick={() => void saveSection("quotas", { quotas }, "配额")}>
                {saving === "配额" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 保存配额
              </button>
            </div>
          </div>

          <div className="admin-config-block">
            <div className="admin-config-block-head"><strong>取 Key 引导</strong>
              <span className="admin-muted">首页给还没有 API Key 的新用户看的指引</span>
            </div>
            <label className="admin-config-toggle">
              <input
                type="checkbox"
                checked={tokenGuide.enabled}
                onChange={(e) => setTokenGuide((g) => ({ ...g, enabled: e.target.checked }))}
              /> 在首页展示
            </label>
            <div className="admin-config-grid2">
              <label>中转站名称
                <input
                  value={tokenGuide.siteName}
                  placeholder="例如 BobDong"
                  onChange={(e) => setTokenGuide((g) => ({ ...g, siteName: e.target.value }))}
                />
              </label>
              <label>令牌管理页地址（http/https）
                <input
                  className="mono"
                  value={tokenGuide.tokenUrl}
                  placeholder="https://example.com/console/token"
                  onChange={(e) => setTokenGuide((g) => ({ ...g, tokenUrl: e.target.value }))}
                />
              </label>
              <label>令牌分组名
                <input
                  value={tokenGuide.groupName}
                  placeholder="例如 banana Pro 官转"
                  onChange={(e) => setTokenGuide((g) => ({ ...g, groupName: e.target.value }))}
                />
              </label>
            </div>
            <div className="admin-config-block-head"><strong>补充说明</strong>
              <span className="admin-muted">{tokenGuide.note.length} 字</span>
            </div>
            <textarea
              className="admin-config-fulltext"
              value={tokenGuide.note}
              placeholder="告诉用户新建令牌时该选哪个分组、复制回来填到哪里"
              onChange={(e) => setTokenGuide((g) => ({ ...g, note: e.target.value }))}
            />
            <div className="admin-config-actions">
              <button type="button" className="subtle-button" onClick={() => void resetSection("tokenGuide", "取 Key 引导")}><RefreshCw size={14} /> 恢复默认</button>
              <button type="button" className="primary-button admin-config-save" disabled={saving === "取 Key 引导"} onClick={() => void saveSection("token-guide", { tokenGuide }, "取 Key 引导")}>
                {saving === "取 Key 引导" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 保存引导
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type CaptchaChallenge = { token: string; gapY: number; trackWidth: number; pieceSize: number; background: string; piece: string };

// 滑块拼图：背景与缺口全部用 CSS/SVG 生成，不需要任何图片处理依赖。
// 服务端只下发 gapY（视觉用）与 token，正确的 gapX 始终留在服务端校验。
function SliderCaptcha({ challenge, onSolved, onRefresh, error, solved }: {
  challenge: CaptchaChallenge | null;
  onSolved: (x: number) => void;
  onRefresh: () => void;
  error: string;
  solved: boolean;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setX(0); }, [challenge?.token]);

  const maxX = challenge ? challenge.trackWidth - challenge.pieceSize : 0;

  const startDrag = (clientX: number) => {
    if (solved || !challenge) return;
    setDragging(true);
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (cx: number) => {
      const next = Math.max(0, Math.min(maxX, cx - rect.left - challenge.pieceSize / 2));
      setX(next);
    };
    move(clientX);
    const onMove = (e: PointerEvent) => move(e.clientX);
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      const final = Math.max(0, Math.min(maxX, e.clientX - rect.left - challenge.pieceSize / 2));
      setX(final);
      onSolved(Math.round(final));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!challenge) {
    return <div className="captcha-box captcha-loading"><Loader2 size={16} className="spin" /> 正在加载验证…</div>;
  }

  return (
    <div className="captcha-box">
      <div className="captcha-stage" ref={trackRef} style={{ width: challenge.trackWidth }}>
        {/* 缺口位置只存在于这张图的像素里，接口响应中没有坐标 */}
        <img className="captcha-bg" src={challenge.background} alt="拖动拼图对齐缺口" draggable={false} />
        <img
          className={`captcha-piece${solved ? " is-solved" : ""}`}
          src={challenge.piece}
          alt=""
          draggable={false}
          style={{ top: challenge.gapY, left: x, width: challenge.pieceSize, height: challenge.pieceSize }}
        />
      </div>
      <div className="captcha-track">
        <div
          className={`captcha-handle${dragging ? " is-dragging" : ""}${solved ? " is-solved" : ""}`}
          style={{ left: x }}
          onPointerDown={(e) => { e.preventDefault(); startDrag(e.clientX); }}
          role="slider"
          aria-label="拖动滑块完成验证"
          aria-valuenow={Math.round(x)}
          aria-valuemin={0}
          aria-valuemax={maxX}
          tabIndex={0}
        >
          {solved ? <CheckCircle2 size={16} /> : <ChevronRight size={16} />}
        </div>
        <span className="captcha-hint">{solved ? "验证通过" : "按住滑块拖动完成拼图"}</span>
      </div>
      {error && (
        <div className="captcha-error">
          {error}
          <button type="button" onClick={onRefresh}>换一个</button>
        </div>
      )}
    </div>
  );
}

function AdminApp({
  onBackHome,
  onEnterStudio,
  oauthEnabled,
  onOauthLogin,
}: {
  onBackHome: () => void;
  onEnterStudio: () => void;
  oauthEnabled: boolean;
  onOauthLogin: () => void;
}) {
  const [user, setUser] = useState<AdminUserView | null>(null);
  // Tab 状态进 URL（#admin / #admin/logs / #admin/config），可深链与刷新保持
  const [adminTab, setAdminTab] = useState<"overview" | "logs" | "config" | "feedback" | "security">(() => {
    if (window.location.hash.startsWith("#admin/logs")) return "logs";
    if (window.location.hash.startsWith("#admin/config")) return "config";
    if (window.location.hash.startsWith("#admin/feedback")) return "feedback";
    if (window.location.hash.startsWith("#admin/security")) return "security";
    return "overview";
  });
  const selectAdminTab = (tab: "overview" | "logs" | "config" | "feedback" | "security") => {
    setAdminTab(tab);
    window.location.hash = tab === "overview" ? "#admin" : `#admin/${tab}`;
  };
  const [isChecking, setIsChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "" });
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaX, setCaptchaX] = useState<number | null>(null);
  const [captchaError, setCaptchaError] = useState("");
  const [lockedUntil, setLockedUntil] = useState(0);
  const [passwordForm, setPasswordForm] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" });
  const [adminError, setAdminError] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [squareOverview, setSquareOverview] = useState<SquareAdminOverview | null>(null);
  const [logs, setLogs] = useState<AdminRequestLog[]>([]);
  const [logStatus, setLogStatus] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [logLimit, setLogLimit] = useState(50);
  const [logTotal, setLogTotal] = useState(0);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isExportingSquare, setIsExportingSquare] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState("");

  useEffect(() => {
    void refreshMe();
  }, []);

  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    void refreshDashboard();
    const timer = window.setInterval(() => {
      // 后台标签页不轮询，避免无人观看时每 10s 拉取大量日志
      if (document.hidden) return;
      void refreshDashboard({ quiet: true });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [user?.username, user?.mustChangePassword, logStatus, logQuery, logLimit, adminTab]);

  async function adminFetch<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`/api/admin${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw payload;
    }
    return payload as T;
  }

  async function squareAdminFetch<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`/api/square/admin${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw payload;
    }
    return payload as T;
  }

  async function exportAdminLogs() {
    setAdminError("");
    try {
      const response = await fetch("/api/admin/logs/export", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw detail || new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const dispositionFilename = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1];
      const filename = dispositionFilename || `image-studio-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const url = URL.createObjectURL(blob);
      downloadUrl(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setAdminError(formatError(error));
    }
  }

  async function exportSquareLogs(format: "json" | "csv" = "json") {
    setAdminError("");
    setIsExportingSquare(true);
    try {
      const response = await fetch(`/api/square/admin/export?format=${format}`, {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw detail || new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const dispositionFilename = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1];
      const filename = dispositionFilename || `imagehub-square-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
      const url = URL.createObjectURL(blob);
      downloadUrl(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setAdminError(formatError(error));
    } finally {
      setIsExportingSquare(false);
    }
  }

  async function refreshMe() {
    setIsChecking(true);
    try {
      const payload = await adminFetch<{ ok: true; user: AdminUserView }>("/me");
      setUser(payload.user);
    } catch {
      setUser(null);
    } finally {
      setIsChecking(false);
    }
  }

  async function loadCaptcha() {
    setCaptchaError("");
    setCaptchaX(null);
    setCaptcha(null);
    try {
      const data = await adminFetch<CaptchaChallenge & { ok: true }>("/captcha");
      setCaptcha({
        token: data.token, gapY: data.gapY, trackWidth: data.trackWidth,
        pieceSize: data.pieceSize, background: data.background, piece: data.piece,
      });
    } catch {
      setCaptchaError("验证加载失败，请点「换一个」重试");
    }
  }

  // 进页先问一次：之前失败过就直接显示滑块，别等用户白试一次
  useEffect(() => {
    if (user) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await adminFetch<{ ok: true; captchaRequired: boolean; lockedUntil: number }>(
          `/login-state?username=${encodeURIComponent(loginForm.username)}`,
        );
        if (cancelled) return;
        setLockedUntil(data.lockedUntil || 0);
        if (data.captchaRequired) {
          setCaptchaRequired(true);
          void loadCaptcha();
        }
      } catch { /* 前置查询失败不阻塞登录 */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setAdminError("");
    setIsSubmitting(true);
    try {
      if (captchaRequired && (!captcha || captchaX === null)) {
        setAdminError("请先拖动滑块完成验证");
        setIsSubmitting(false);
        return;
      }
      const payload = await adminFetch<{ ok: true; user: AdminUserView }>("/login", {
        method: "POST",
        body: JSON.stringify({
          ...loginForm,
          ...(captchaRequired && captcha ? { captchaToken: captcha.token, captchaX } : {}),
        }),
      });
      setUser(payload.user);
      setCaptchaRequired(false);
      setCaptcha(null);
      setPasswordForm((current) => ({ ...current, oldPassword: loginForm.password }));
    } catch (error) {
      const detail = (error && typeof error === "object" ? error as Record<string, unknown> : {});
      if (typeof detail.lockedUntil === "number" && detail.lockedUntil > Date.now()) {
        setLockedUntil(detail.lockedUntil);
      }
      if (detail.captchaRequired) {
        setCaptchaRequired(true);
        void loadCaptcha();
      }
      setAdminError(formatError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordChange(event: FormEvent) {
    event.preventDefault();
    setAdminError("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setAdminError("两次输入的新密码不一致");
      return;
    }
    setIsSubmitting(true);
    try {
      await adminFetch<{ ok: true }>("/change-password", {
        method: "POST",
        body: JSON.stringify({
          oldPassword: passwordForm.oldPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
      setUser((current) => current ? { ...current, mustChangePassword: false } : current);
    } catch (error) {
      setAdminError(formatError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function refreshDashboard(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setIsLoadingLogs(true);
    try {
      // 按当前 Tab 拉取：概览只要 stats + 广场，日志 Tab 才拉日志，配置 Tab 自管不拉
      const wantOverview = adminTab === "overview";
      const wantLogs = adminTab === "logs";
      const query = new URLSearchParams();
      if (logStatus) query.set("status", logStatus);
      if (logQuery.trim()) query.set("q", logQuery.trim());
      query.set("limit", String(logLimit));
      const [statsPayload, logsPayload, squarePayload] = await Promise.all([
        wantOverview ? adminFetch<{ ok: true; stats: AdminStats }>("/stats") : Promise.resolve(null),
        wantLogs ? adminFetch<{ ok: true; logs: AdminRequestLog[]; total?: number }>(`/requests?${query.toString()}`) : Promise.resolve(null),
        wantOverview ? squareAdminFetch<{ ok: true; overview: SquareAdminOverview }>("/overview") : Promise.resolve(null),
      ]);
      if (statsPayload) setStats(statsPayload.stats);
      if (squarePayload) setSquareOverview(squarePayload.overview);
      if (logsPayload) {
        setLogs(logsPayload.logs);
        setLogTotal(logsPayload.total ?? logsPayload.logs.length);
        setExpandedLogId((current) =>
          logsPayload.logs.some((log) => log.requestId === current) ? current : "",
        );
      }
    } catch (error) {
      setAdminError(formatError(error));
      if ((error as { mustChangePassword?: boolean })?.mustChangePassword) {
        setUser((current) => current ? { ...current, mustChangePassword: true } : current);
      }
    } finally {
      if (!options.quiet) setIsLoadingLogs(false);
    }
  }

  async function handleLogout() {
    try {
      await adminFetch<{ ok: true }>("/logout", { method: "POST", body: "{}" });
    } finally {
      setUser(null);
      setStats(null);
      setSquareOverview(null);
      setLogs([]);
      setAdminError("");
    }
  }

  const topModels = useMemo(
    () => Object.entries(stats?.modelCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
    [stats],
  );
  const topErrors = useMemo(
    () => Object.entries(stats?.errorCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 4),
    [stats],
  );
  const squareLastTrend = squareOverview?.trend[squareOverview.trend.length - 1];
  const squareTopReasons = squareOverview?.rejectedReasonTop.slice(0, 4) || [];
  const squareRiskEvents = squareOverview?.riskEvents.slice(0, 4) || [];

  if (isChecking) {
    return (
      <main className="admin-page">
        <div className="admin-checking">
          <Loader2 className="spin" size={22} />
          <span>正在检查管理员登录状态...</span>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="admin-page">
        <section className="admin-auth-panel">
          <div className="admin-auth-hero">
            <span className="admin-badge"><ShieldCheck size={16} /> Admin Console</span>
            <h1>请求日志与服务健康后台</h1>
            <p>查看所有用户的生成请求、成功率、耗时和失败原因。后台不会记录 API Key，也不会保存生成图片。</p>
            <div className="admin-auth-actions">
              <button type="button" className="subtle-button" onClick={onBackHome}>返回首页</button>
              <button type="button" className="subtle-button" onClick={onEnterStudio}>打开工作台</button>
            </div>
          </div>
          <form className="admin-login-card" onSubmit={handleLogin}>
            <strong>管理员登录</strong>
            <span>首次登录默认账号需要立即重置密码</span>
            {oauthEnabled && (
              <button type="button" className="login-option login-option-oauth" onClick={onOauthLogin}>
                <ExternalLink size={20} />
                <div>
                  <strong>太极AI 账号登录</strong>
                  <span>使用太极AI统一账号</span>
                </div>
              </button>
            )}
            {oauthEnabled && <div className="admin-login-divider"><span>或使用管理员密码</span></div>}
            <label>
              <span>用户名</span>
              <input
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                autoComplete="username"
              />
            </label>
            <label>
              <span>密码</span>
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                autoComplete="current-password"
                placeholder="请输入管理员密码"
              />
            </label>
            {captchaRequired && (
              <SliderCaptcha
                challenge={captcha}
                onSolved={(x) => { setCaptchaX(x); setCaptchaError(""); }}
                onRefresh={() => void loadCaptcha()}
                error={captchaError}
                solved={captchaX !== null}
              />
            )}
            {lockedUntil > Date.now() && (
              <div className="admin-error">
                登录尝试过于频繁，请于 {new Date(lockedUntil).toLocaleTimeString("zh-CN")} 后重试
              </div>
            )}
            {adminError && <div className="admin-error">{adminError}</div>}
            <button className="primary-action" type="submit" disabled={isSubmitting || lockedUntil > Date.now()}>
              {isSubmitting ? <Loader2 size={17} className="spin" /> : <ShieldCheck size={17} />}
              登录
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (user.mustChangePassword) {
    return (
      <main className="admin-page">
        <section className="admin-reset-panel">
          <div>
            <span className="admin-badge"><ShieldCheck size={16} /> First Login</span>
            <h1>首次登录需要重置管理员密码</h1>
            <p>新密码至少 8 位，并包含字母和数字。完成后会进入日志后台。</p>
          </div>
          <form className="admin-login-card" onSubmit={handlePasswordChange}>
            <strong>重置密码</strong>
            <label>
              <span>当前密码</span>
              <input
                type="password"
                value={passwordForm.oldPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, oldPassword: event.target.value }))}
                autoComplete="current-password"
              />
            </label>
            <label>
              <span>新密码</span>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>确认新密码</span>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                autoComplete="new-password"
              />
            </label>
            {adminError && <div className="admin-error">{adminError}</div>}
            <button className="primary-action" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 size={17} className="spin" /> : <ShieldCheck size={17} />}
              保存新密码
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <div>
          <span className="admin-badge"><img src={imageStudioLogo} alt="" /> Image Studio Admin</span>
          <h1>请求日志后台</h1>
        </div>
        <div className="admin-topbar-actions">
          <button type="button" className="subtle-button" onClick={onEnterStudio}>工作台</button>
          <button type="button" className="subtle-button" onClick={() => void refreshDashboard()}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button type="button" className="subtle-button" onClick={exportAdminLogs} title="下载完整请求日志为 JSON（图片内容已脱敏）">
            <DownloadCloud size={16} />
            导出日志
          </button>
          <button type="button" className="subtle-button" onClick={() => void handleLogout()}>
            <LogOut size={16} />
            退出
          </button>
        </div>
      </header>

      <nav className="admin-tabs">
        <button type="button" className={adminTab === "overview" ? "active" : ""} onClick={() => selectAdminTab("overview")}>概览</button>
        <button type="button" className={adminTab === "logs" ? "active" : ""} onClick={() => selectAdminTab("logs")}>请求日志</button>
        <button type="button" className={adminTab === "feedback" ? "active" : ""} onClick={() => selectAdminTab("feedback")}>用户反馈</button>
        <button type="button" className={adminTab === "config" ? "active" : ""} onClick={() => selectAdminTab("config")}>接口配置</button>
        <button type="button" className={adminTab === "security" ? "active" : ""} onClick={() => selectAdminTab("security")}>安全加固</button>
      </nav>

      {adminTab === "config" && <AdminConfigCenter />}
      {adminTab === "feedback" && <AdminFeedbackPanel />}
      {adminTab === "security" && <AdminSecurityPanel />}

      {adminTab === "overview" && (<>
      <section className="admin-stat-grid">
        <AdminStatCard label="生图请求" value={stats?.total ?? 0} />
        <AdminStatCard label="成功率" value={`${stats?.successRate ?? 0}%`} tone="success" />
        <AdminStatCard label="失败" value={stats?.error ?? 0} tone="error" />
        <AdminStatCard label="耗时 P50 · P95" value={`${formatCompactDuration(stats?.p50DurationMs ?? 0)} · ${formatCompactDuration(stats?.p95DurationMs ?? 0)}`} />
        <AdminStatCard label="广场展示" value={squareOverview?.activeItems ?? 0} />
        <AdminStatCard label="推荐尝试" value={squareOverview?.totalRecommendAttempts ?? 0} />
        <AdminStatCard label="替换率" value={`${squareOverview?.replacementRate ?? 0}%`} />
        <AdminStatCard label="广场点赞" value={squareOverview?.totalLikes ?? 0} tone="success" />
      </section>

      <section className="admin-insight-grid">
        <article className="admin-panel">
          <div className="admin-panel-title">
            <BarChart3 size={17} />
            <strong>模型分布</strong>
          </div>
          {topModels.length === 0 ? (
            <p className="admin-muted">暂无模型请求</p>
          ) : (
            topModels.map(([model, count]) => (
              <div className="admin-rank-row" key={model}>
                <span title={model}>{model}</span>
                <strong>{count}</strong>
              </div>
            ))
          )}
        </article>
        <article className="admin-panel">
          <div className="admin-panel-title">
            <AlertCircle size={17} />
            <strong>常见失败</strong>
          </div>
          {topErrors.length === 0 ? (
            <p className="admin-muted">暂无失败记录</p>
          ) : (
            topErrors.map(([error, count]) => (
              <div className="admin-rank-row" key={error}>
                <span title={error}>{formatErrorKeyLabel(error)}</span>
                <strong>{count}</strong>
              </div>
            ))
          )}
        </article>
        <article className="admin-panel admin-square-panel">
          <div className="admin-panel-title admin-panel-title-spread">
            <div>
              <Star size={17} />
              <strong>广场治理</strong>
            </div>
            <div className="admin-panel-actions">
              <button type="button" className="subtle-button" onClick={() => void exportSquareLogs("csv")} disabled={isExportingSquare}>
                {isExportingSquare ? <Loader2 size={15} className="spin" /> : <DownloadCloud size={15} />}
                导出今日 CSV
              </button>
              <button type="button" className="subtle-button" onClick={() => void exportSquareLogs("json")} disabled={isExportingSquare}>
                <DownloadCloud size={15} />
                导出今日 JSON
              </button>
            </div>
          </div>
          <div className="admin-square-grid">
            <div>
              <strong>今日趋势</strong>
              <div className="admin-rank-row">
                <span>{squareLastTrend?.dateKey || "今日"}</span>
                <strong>{squareLastTrend ? `${squareLastTrend.recommendAttempts} 推荐 · ${squareLastTrend.likes} 赞` : "-"}</strong>
              </div>
              <div className="admin-rank-row">
                <span>新增 / 替换 / 拒绝</span>
                <strong>{squareLastTrend ? `${squareLastTrend.added} / ${squareLastTrend.replaced} / ${squareLastTrend.rejected}` : "0 / 0 / 0"}</strong>
              </div>
              <div className="admin-rank-row">
                <span>平均点赞</span>
                <strong>{squareOverview?.likeRate ?? 0}</strong>
              </div>
            </div>
            <div>
              <strong>拒绝原因 Top</strong>
              {squareTopReasons.length === 0 ? (
                <p className="admin-muted">暂无拒绝记录</p>
              ) : (
                squareTopReasons.map((reason) => (
                  <div className="admin-rank-row" key={reason.reasonCode}>
                    <span title={reason.reasonCode}>{reason.reasonCode}</span>
                    <strong>{reason.count}</strong>
                  </div>
                ))
              )}
            </div>
            <div>
              <strong>风控事件</strong>
              {squareRiskEvents.length === 0 ? (
                <p className="admin-muted">暂无风控事件</p>
              ) : (
                squareRiskEvents.map((event) => (
                  <div className="admin-rank-row" key={event.id}>
                    <span title={`${event.event} · ${event.reasonCode}`}>{event.severity} · {event.reasonCode}</span>
                    <strong>{formatFullDate(event.timestamp)}</strong>
                  </div>
                ))
              )}
            </div>
          </div>
        </article>
      </section>

      <section className="admin-panel admin-section">
        <div className="admin-panel-title">
          <Settings2 size={17} />
          <strong>生图链路各环节</strong>
          <span className="admin-muted admin-stage-caption">仅统计生图请求 · 共 {stats?.stageStats?.received ?? 0} 次</span>
        </div>
        <div className="admin-stage-flow">
          {(() => {
            const ss = stats?.stageStats;
            const base = ss?.received || 0;
            const pct = (n: number) => base ? Math.round((n / base) * 1000) / 10 : 0;
            const steps = [
              { key: "received", label: "接收请求", value: ss?.received ?? 0, sub: "100%" },
              { key: "ref", label: "参考图转发", value: ss?.referenceForwarded ?? 0, sub: `${ss?.referenceForwarded ?? 0}/${ss?.referenceTotal ?? 0}` },
              { key: "upstream", label: "上游返回", value: ss?.upstreamResponded ?? 0, sub: `${pct(ss?.upstreamResponded ?? 0)}%` },
              { key: "success", label: "生成成功", value: ss?.upstreamSuccess ?? 0, sub: `${pct(ss?.upstreamSuccess ?? 0)}%` },
              { key: "saved", label: "图片落盘", value: ss?.imageSaved ?? 0, sub: `${pct(ss?.imageSaved ?? 0)}%` },
            ];
            return steps.map((step, index) => (
              <Fragment key={step.key}>
                {index > 0 && <ChevronRight size={16} className="admin-stage-arrow" />}
                <div className="admin-stage-step">
                  <strong>{step.value}</strong>
                  <span>{step.label}</span>
                  <em>{step.sub}</em>
                </div>
              </Fragment>
            ));
          })()}
        </div>
      </section>

      <section className="admin-panel admin-section">
        <div className="admin-panel-title admin-panel-title-spread">
          <div><BarChart3 size={17} /><strong>每日趋势</strong></div>
          <span className="admin-muted">累计生成图片 {stats?.totalImages ?? 0} 张 · 好评 {stats?.feedback?.up ?? 0} · 差评 {stats?.feedback?.down ?? 0} · 分析类请求 {stats?.analysisCount ?? 0} 次</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table admin-daily-table">
            <thead>
              <tr><th>日期</th><th>请求</th><th>成功</th><th>失败</th><th>图片</th><th>成功率</th><th>平均耗时</th></tr>
            </thead>
            <tbody>
              {(stats?.daily?.length ?? 0) === 0 ? (
                <tr><td colSpan={7} className="admin-empty-cell">暂无数据</td></tr>
              ) : (
                stats?.daily?.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.total}</td>
                    <td className="admin-cell-success">{day.success}</td>
                    <td className="admin-cell-error">{day.error}</td>
                    <td>{day.images}</td>
                    <td>{day.successRate}%</td>
                    <td>{formatCompactDuration(day.avgDurationMs)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </>)}

      {adminTab === "logs" && (
      <section className="admin-panel admin-log-panel">
        <div className="admin-log-toolbar">
          <div>
            <strong>请求记录</strong>
            <span>从用户点击开始记录；展开可查看前端、服务端、上游与结果取回的完整时间线。</span>
          </div>
          <div className="admin-filter-row">
            <select
              value={logStatus}
              onChange={(event) => {
                setLogStatus(event.target.value);
                setLogLimit(50);
              }}
            >
              <option value="">全部状态</option>
              <option value="submitting">提交中</option>
              <option value="queued">排队中</option>
              <option value="running">运行中</option>
              <option value="success">成功</option>
              <option value="error">失败</option>
            </select>
            <input
              value={logQuery}
              onChange={(event) => {
                setLogQuery(event.target.value);
                setLogLimit(50);
              }}
              placeholder="搜索 requestID / 提示词 / 模型"
            />
          </div>
        </div>
        {adminError && <div className="admin-error">{adminError}</div>}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>类型</th>
                <th>Agent</th>
                <th>Request ID</th>
                <th>提示词</th>
                <th>模型</th>
                <th>参数</th>
                <th>耗时</th>
                <th>时间</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="admin-empty-cell">
                    {isLoadingLogs ? "正在读取日志..." : "暂无请求记录"}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <Fragment key={log.requestId}>
                    <tr
                      className={`admin-log-row ${expandedLogId === log.requestId ? "expanded" : ""}`}
                      onClick={() => setExpandedLogId((current) => current === log.requestId ? "" : log.requestId)}
                    >
                      <td>
                        <div className="admin-status-cell">
                          <ChevronRight size={14} />
                          <span className={`admin-status ${log.status}`}>{ADMIN_STATUS_LABELS[log.status]}</span>
                        </div>
                      </td>
                      <td>{log.requestType === "prompt_analysis" ? "提示词分析" : log.requestType === "agent_analysis" ? "Agent 分析" : "生图"}</td>
                      <td className="admin-model-cell" title={log.agentScenario || ""}>
                        {log.agentName ? `${log.agentName}${log.promptVariant ? ` · ${log.promptVariant}` : ""}` : "-"}
                      </td>
                      <td><code title={log.requestId}>{log.requestId.slice(0, 8)}</code></td>
                      <td className="admin-prompt-cell" title={log.prompt}>{log.prompt || "-"}</td>
                      <td className="admin-model-cell" title={log.model}>{log.model || "-"}</td>
                      <td
                        title={[
                          `API：${log.apiBaseUrl}`,
                          `Key：${log.apiKeyPresent ? `${log.apiKeyPrefix ? `${log.apiKeyPrefix}…` : "已提供"} · ${log.apiKeyLength || 0} 位` : "未读取到"}`,
                          log.upstreamPayloadKeys?.length ? `上游字段：${log.upstreamPayloadKeys.join(", ")}` : "",
                          log.upstreamReferenceMode ? `参考图模式：${log.upstreamReferenceMode}` : "",
                        ].filter(Boolean).join("\n")}
                      >
                        {[
                          log.aspectRatio,
                          log.resolution,
                          log.upstreamSize ? `上游 ${log.upstreamSize}` : log.size,
                          log.outputFormat,
                          log.upstreamReferenceCount ? `上游 ${log.upstreamReferenceCount} 图` : log.referenceCount ? `${log.referenceCount} 图` : "",
                        ].filter(Boolean).join(" · ") || "-"}
                      </td>
                      <td className="admin-latency-cell">
                        <strong>{formatCompactDuration(adminLifecycleDuration(log))}</strong>
                        <span title={adminLifecycleLatestLabel(log)}>{adminLifecycleLatestLabel(log)}</span>
                      </td>
                      <td>{formatFullDate(log.createdAt)}</td>
                      <td className="admin-error-cell" title={log.errorRaw || log.errorMessage || ""}>{log.errorMessage || "-"}</td>
                    </tr>
                    {expandedLogId === log.requestId && (
                      <tr className="admin-log-detail-row">
                        <td colSpan={10}>
                          <div className="admin-log-detail-head">
                            <div>
                              <strong>请求详情</strong>
                              <span>{log.requestId} · {log.endpoint}</span>
                            </div>
                            <span className="admin-log-safety">不记录 API Key 原文；生成图片保存在服务器本地</span>
                          </div>
                          <AdminLifecycleTimeline log={log} />
                          {log.savedImages && log.savedImages.length > 0 && (
                            <div className="admin-log-images">
                              {log.savedImages.map((image) => (
                                <a
                                  key={image.id}
                                  href={`/api/images/local/${image.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`${image.mime} · ${formatBytes(image.bytes)}`}
                                >
                                  {/* 列表用缩略图，点开 <a> 才取原图；老记录无 thumbId 时回退原图 */}
                                  <img
                                    src={`/api/images/local/${image.thumbId ?? image.id}`}
                                    alt="生成图片"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                </a>
                              ))}
                            </div>
                          )}
                          <div className="admin-log-detail-grid">
                            <AdminJsonBlock title="请求参数" value={log.requestParams || {
                              protocol: log.protocol,
                              apiBaseUrl: log.apiBaseUrl,
                              credential: {
                                present: log.apiKeyPresent,
                                length: log.apiKeyLength,
                                prefix: log.apiKeyPrefix,
                              },
                              model: log.model,
                              prompt: log.prompt,
                              negativePrompt: log.negativePrompt,
                              aspectRatio: log.aspectRatio,
                              size: log.size,
                              resolution: log.resolution,
                              quality: log.quality,
                              outputFormat: log.outputFormat,
                              seed: log.seed,
                              referenceCount: log.referenceCount,
                            }} />
                            <AdminJsonBlock title="上游请求" value={log.upstreamRequest || {
                              endpoint: log.endpoint,
                              payloadKeys: log.upstreamPayloadKeys,
                              referenceMode: log.upstreamReferenceMode,
                              referenceCount: log.upstreamReferenceCount,
                              upstreamSize: log.upstreamSize,
                            }} />
                            <AdminJsonBlock title="返回内容" value={log.responseBody || {
                              status: log.status,
                              httpStatus: log.httpStatus,
                              errorMessage: log.errorMessage,
                              errorType: log.errorType,
                              errorCode: log.errorCode,
                              errorRaw: log.errorRaw,
                            }} />
                          </div>
                          {log.status === "error" && log.errorFull && (
                            <div className="admin-error-full">
                              <div className="admin-error-full-head">
                                <AlertCircle size={14} />
                                <strong>完整错误内容</strong>
                                <span className="admin-muted">上游/中转站原始返回，仅脱敏图片数据</span>
                              </div>
                              <pre>{log.errorFull}</pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="admin-log-footer">
          <span>已加载 {logs.length} / 共 {logTotal} 条历史记录</span>
          {logs.length < logTotal && logLimit < 1000 && (
            <button
              type="button"
              onClick={() => setLogLimit((current) => Math.min(current + 50, 1000))}
              disabled={isLoadingLogs}
            >
              {isLoadingLogs ? "加载中..." : "加载更多"}
            </button>
          )}
        </div>
      </section>
      )}
    </main>
  );
}

function AdminStatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "error";
}) {
  return (
    <article className={`admin-stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AdminLifecycleTimeline({ log }: { log: AdminRequestLog }) {
  const events = adminLifecycleEvents(log);
  if (events.length === 0) return null;
  const stages = log.stages;
  const segment = (from?: number, to?: number) =>
    typeof from === "number" && typeof to === "number" && to >= from ? to - from : null;
  const startAt = stages?.clientSubmittedAt || events[0].at;
  const isActive = log.status === "submitting" || log.status === "queued" || log.status === "running";
  const endAt = isActive
    ? Date.now()
    : stages?.clientResultReceivedAt
      || stages?.clientErrorReceivedAt
      || stages?.taskCompletedAt
      || log.finishedAt
      || events[events.length - 1].at;
  const metrics = [
    { label: "点击 → 服务端", value: segment(stages?.clientSubmittedAt, stages?.receivedAt) },
    { label: "服务端排队", value: segment(stages?.enqueuedAt || stages?.receivedAt, stages?.dispatchedAt) },
    { label: "上游生成", value: segment(stages?.upstreamRequestedAt, stages?.upstreamRespondedAt) },
    { label: "完整链路", value: segment(startAt, endAt) },
  ].filter((item): item is { label: string; value: number } => item.value !== null);

  return (
    <section className="admin-lifecycle">
      <div className="admin-lifecycle-head">
        <div>
          <strong>完整请求链路</strong>
          <span>{events.length} 个事件 · {log.sourceSurface === "canvas" ? "画布" : log.sourceSurface === "studio" ? "工作台" : "来源未知"}</span>
        </div>
        <div className="admin-lifecycle-metrics">
          {metrics.map((metric) => (
            <span key={metric.label}>
              {metric.label}<strong>{formatCompactDuration(metric.value)}</strong>
            </span>
          ))}
          {(log.idempotentReplayCount || 0) > 0 && (
            <span>幂等命中<strong>{log.idempotentReplayCount} 次</strong></span>
          )}
        </div>
      </div>
      <ol className="admin-lifecycle-list">
        {events.map((event, index) => {
          const previous = events[index - 1];
          const delta = previous ? Math.max(0, event.at - previous.at) : 0;
          const cumulative = Math.max(0, event.at - events[0].at);
          const reportDelay = event.recordedAt && event.source === "client"
            ? Math.max(0, event.recordedAt - event.at)
            : 0;
          return (
            <li className={`admin-lifecycle-event ${event.source}`} key={`${event.id}-${index}`}>
              <span className="admin-lifecycle-dot" aria-hidden="true" />
              <div className="admin-lifecycle-event-main">
                <div>
                  <strong>{ADMIN_LIFECYCLE_LABELS[event.phase] || event.phase}</strong>
                  <span className={`admin-lifecycle-source ${event.source}`}>
                    {event.source === "client" ? "前端" : event.source === "upstream" ? "上游" : "服务端"}
                  </span>
                </div>
                {event.detail && <p>{event.detail}</p>}
              </div>
              <div className="admin-lifecycle-event-time">
                <time dateTime={new Date(event.at).toISOString()}>{formatFullDate(event.at)}</time>
                <span>
                  {index === 0 ? "链路起点" : `距上一步 +${formatCompactDuration(delta)}`}
                  {index > 0 && ` · 累计 ${formatCompactDuration(cumulative)}`}
                </span>
                {reportDelay >= 1000 && <em>客户端事件上报延迟 {formatCompactDuration(reportDelay)}</em>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function AdminJsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <article className="admin-json-block">
      <strong>{title}</strong>
      <pre>{JSON.stringify(value ?? {}, null, 2)}</pre>
    </article>
  );
}




const HOME_FEED_TABS: Array<{ value: SquareFeedTab; label: string }> = [
  { value: "hot", label: "热门" },
  { value: "latest", label: "最新" },
  { value: "top_week", label: "本周" },
  { value: "top_month", label: "本月" },
];

function HomePage({
  onEnter,
  onSquare,
  onAdmin,
  onCanvas,
  oauthUser,
  onOauthLogout,
  oauthEnabled,
  onOauthLogin,
  homePrompt,
  onHomePromptChange,
  onHomeSubmit,
  models,
  modelStats,
  selectedModel,
  onSelectModel,
  recentRecords,
  hasApiKey,
  runningCount,
}: {
  onEnter: () => void; onSquare: () => void; onAdmin: () => void; onCanvas: () => void;
  runningCount: number;
  oauthUser: { sub: string; username: string; displayName: string; email: string; role: number; group: string } | null;
  onOauthLogout: () => void;
  oauthEnabled: boolean;
  onOauthLogin: () => void;
  homePrompt: string;
  onHomePromptChange: (value: string) => void;
  onHomeSubmit: () => void;
  models: string[];
  modelStats: Record<string, ModelStat>;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  recentRecords: HistoryRecord[];
  hasApiKey: boolean;
}) {
  const [feedTab, setFeedTab] = useState<SquareFeedTab>("hot");
  const [feedItems, setFeedItems] = useState<SquareFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  // 灵感发现：/api/square/feed 匿名可用，首页只拉一页（20 条足够铺满两屏）
  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    fetch(`/api/square/feed?tab=${feedTab}&limit=20`, { credentials: "same-origin" })
      .then((res) => res.json())
      .then((data: SquareFeedResponse) => {
        if (cancelled) return;
        setFeedItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setFeedItems([]);
      })
      .finally(() => {
        if (!cancelled) setFeedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feedTab]);

  const focusPrompt = () => {
    promptRef.current?.focus();
    promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const agents = runtimeIndustryAgents.slice(0, 6);
  const recent = recentRecords.filter((record) => record.thumbUrl || record.objectUrl).slice(0, 8);
  const showLoginHint = oauthEnabled && !oauthUser && !hasApiKey;
  const [needKeyGuide, setNeedKeyGuide] = useState(false);
  // 当前会用哪个上游站点——用户要去这里申请 Key，必须让他看见
  const primaryEndpoint = runtimeEndpoints[0];

  // 有 Key 就直接走生成；没有就地引导，不要把人丢到工作台再让他对着灰按钮猜
  const guardedSubmit = () => {
    if (!homePrompt.trim()) return;
    if (!hasApiKey) {
      setNeedKeyGuide(true);
      return;
    }
    setNeedKeyGuide(false);
    onHomeSubmit();
  };

  return (
    <main className="home-page">
      {showLoginHint && (
        <div className="home-statusbar">
          <span>登录太极 AI 账号即可直接开始，无需手动填写 API Key。</span>
          <button type="button" onClick={onOauthLogin}>
            登录
          </button>
        </div>
      )}

      {/* 一级导航由全局 AppHeader 承担（App 分支渲染），页面内不再各自持有 */}

      <section className="home-hero">
        <h1>Image Studio</h1>
        <p className="home-hero-sub">一句提示词，一组可复用的视觉资产。</p>

        <div className="home-composer">
          <textarea
            ref={promptRef}
            value={homePrompt}
            onChange={(event) => onHomePromptChange(event.target.value)}
            onKeyDown={(event) => {
              // 中文/日文输入法选词时的回车属于组合态，必须放行，否则会用半截拼音提前提交
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                guardedSubmit();
              }
            }}
            placeholder="描述你想生成的图片，例如：温暖木质感的咖啡厅菜单海报"
            rows={3}
          />
          <div className="home-composer-bar">
            <button type="button" className="home-composer-attach" onClick={onEnter} aria-label="添加参考图" title="在工作台添加参考图">
              <ImagePlus size={17} />
            </button>
            <button
              type="button"
              className="home-composer-send"
              onClick={guardedSubmit}
              disabled={!homePrompt.trim()}
              aria-label="开始生成"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>

        {needKeyGuide && (
          <div className="home-key-guide" role="alert">
            <div className="home-key-guide-head">
              <strong>还差一步：配置 API Key</strong>
              <button type="button" className="home-key-guide-close" onClick={() => setNeedKeyGuide(false)} aria-label="关闭">
                <X size={15} />
              </button>
            </div>
            <p>
              ImageHub 用你自己的 API Key 生成图片，Key 只保存在这台设备的浏览器里，不会上传服务器。
              你的提示词已经留好了，配置完可以直接生成。
            </p>
            {runtimeTokenGuide?.tokenUrl && (
              <ol className="home-key-guide-steps">
                <li>
                  打开 <a href={runtimeTokenGuide.tokenUrl} target="_blank" rel="noreferrer noopener">
                    {runtimeTokenGuide.siteName || "中转站"}令牌管理页
                  </a>
                  <code>{runtimeTokenGuide.tokenUrl}</code>
                </li>
                {runtimeTokenGuide.groupName && (
                  <li>新建令牌，分组选择 <b>{runtimeTokenGuide.groupName}</b></li>
                )}
                <li>复制生成的 Key，回到这里填写</li>
              </ol>
            )}
            <div className="home-key-guide-actions">
              {runtimeTokenGuide?.tokenUrl && (
                <a
                  className="home-key-guide-primary"
                  href={runtimeTokenGuide.tokenUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  去获取 API Key
                  <small>{runtimeTokenGuide.groupName ? `记得选「${runtimeTokenGuide.groupName}」分组` : "打开令牌管理页"}</small>
                </a>
              )}
              {oauthEnabled && !oauthUser && (
                <button type="button" className="home-key-guide-secondary" onClick={onOauthLogin}>
                  登录太极 AI 账号
                  <small>自动获取 Key，无需手动填写</small>
                </button>
              )}
              <button
                type="button"
                className="home-key-guide-secondary"
                onClick={() => { setNeedKeyGuide(false); onHomeSubmit(); }}
              >
                我已有 Key，去填写
                <small>{primaryEndpoint ? `将使用 ${primaryEndpoint.label}` : "去工作台配置"}</small>
              </button>
            </div>
          </div>
        )}

        <div className="home-chips" role="group" aria-label="模型与场景">
          {models.slice(0, 4).map((model) => {
            const stat = modelStats[normalizedModelId(model)];
            const active = normalizedModelId(model) === normalizedModelId(selectedModel);
            return (
              <button
                type="button"
                key={model}
                className={`home-chip${active ? " is-active" : ""}`}
                onClick={() => onSelectModel(model)}
              >
                {runtimeModelDisplayName(model)}
                {stat && stat.samples >= 3 && <em>· {stat.successRate}%</em>}
              </button>
            );
          })}
          {agents.length > 0 && <span className="home-chip-divider" aria-hidden="true" />}
          {agents.map((agent) => (
            <button
              type="button"
              key={agent.id}
              className="home-chip home-chip-agent"
              onClick={() => {
                onHomePromptChange(agent.scenario);
                focusPrompt();
              }}
              title={agent.description}
            >
              <span aria-hidden="true">{agent.icon}</span>
              {agent.name}
            </button>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="home-recent">
          <div className="home-section-head">
            <h2>最近生成</h2>
            <button type="button" onClick={onEnter}>
              查看全部
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="home-recent-row">
            <button type="button" className="home-recent-new" onClick={focusPrompt}>
              <Plus size={18} />
              <span>新建生成</span>
            </button>
            {recent.map((record) => (
              <button type="button" className="home-recent-card" key={record.id} onClick={onEnter} title={record.prompt}>
                <img src={record.thumbUrl ?? record.objectUrl} alt="" loading="lazy" decoding="async" />
                <span>{record.prompt.slice(0, 18)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="home-inspire">
        <div className="home-section-head">
          <h2>灵感发现</h2>
          <button type="button" onClick={onSquare}>
            进入广场
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="home-inspire-tabs" role="group" aria-label="灵感分类">
          {HOME_FEED_TABS.map((tab) => (
            <button
              type="button"
              key={tab.value}
              className={`home-chip${feedTab === tab.value ? " is-active" : ""}`}
              onClick={() => setFeedTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {feedLoading ? (
          <div className="home-inspire-empty">正在加载灵感…</div>
        ) : feedItems.length === 0 ? (
          <div className="home-inspire-empty">还没有作品被推荐到广场，去生成第一张吧。</div>
        ) : (
          <div className="home-masonry">
            {feedItems.map((item) => (
              <button type="button" className="home-masonry-item" key={item.id} onClick={onSquare} title={item.prompt}>
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  style={{ aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : "1 / 1" }}
                />
                <span className="home-masonry-meta">
                  <span>{item.recommenderLabel || "匿名创作者"}</span>
                  <span className="home-masonry-like">
                    <Heart size={12} />
                    {item.likeCount}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="home-footer">
        <span>本地优先 · 图片与历史保存在当前浏览器，服务端仅保留一份供后台回看</span>
        <span className="home-footer-meta">
          <span>v{CURRENT_FRONTEND_VERSION}</span>
          <a href="https://github.com/d100000/ImageHub" target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
        </span>
      </footer>
    </main>
  );
}


function SquarePage({
  apiKey,
  onBackHome,
  onEnterStudio,
  onCanvas,
  runningCount,
  onReproduce,
}: {
  apiKey: string;
  onBackHome: () => void;
  onEnterStudio: () => void;
  onCanvas: () => void;
  runningCount: number;
  onReproduce: (item: SquareFeedItem) => void;
}) {
  const [tab, setTab] = useState<SquareFeedTab>("latest");
  const [items, setItems] = useState<SquareFeedItem[]>([]);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<SquareQuotaResponse | null>(null);
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<string>>(() => new Set());
  const [previewItem, setPreviewItem] = useState<SquareFeedItem | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const apiKeyReady = apiKey.trim().length >= API_KEY_MIN_LENGTH;

  async function fetchQuota() {
    if (!apiKeyReady) {
      setQuota(null);
      return;
    }
    try {
      const response = await fetch("/api/square/quota", {
        headers: { "x-imagehub-api-key": apiKey },
      });
      const payload = await readApiJson<SquareQuotaResponse>(response, "/api/square/quota");
      if (!response.ok || !payload.ok) throw payload;
      setQuota(payload);
    } catch {
      setQuota(null);
    }
  }

  async function loadFeed(reset = false) {
    if (isLoading) return;
    if (!reset && !hasMore) return;
    setIsLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        tab,
        limit: String(SQUARE_PAGE_SIZE),
      });
      if (!reset && cursor) query.set("cursor", cursor);
      const headers: Record<string, string> = {};
      if (apiKeyReady) headers["x-imagehub-api-key"] = apiKey;
      const response = await fetch(`/api/square/feed?${query.toString()}`, { headers });
      const payload = await readApiJson<SquareFeedResponse>(response, "/api/square/feed");
      if (!response.ok || !payload.ok) throw payload;
      setItems((current) => reset ? payload.items : mergeSquareItems(current, payload.items));
      setCursor(payload.nextCursor || "");
      setHasMore(payload.hasMore);
    } catch (loadError) {
      setError(formatError(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setCursor("");
    setHasMore(true);
    void loadFeed(true);
    void fetchQuota();
  }, [tab, apiKey]);

  const loadFeedRef = useRef(loadFeed);
  loadFeedRef.current = loadFeed;
  const canLoadMore = hasMore && !isLoading;

  useEffect(() => {
    const marker = loadMoreRef.current;
    const root = pageRef.current;
    if (!marker || !root || !canLoadMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadFeedRef.current(false);
      },
      { root, rootMargin: "420px 0px", threshold: 0 },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [canLoadMore]);

  useEffect(() => {
    if (!previewItem) return;
    const updated = items.find((item) => item.id === previewItem.id);
    if (updated && updated !== previewItem) setPreviewItem(updated);
  }, [items, previewItem]);

  async function toggleLike(item: SquareFeedItem) {
    if (!apiKeyReady) {
      setError("配置 API Key 后可点赞");
      return;
    }
    setPendingLikeIds((current) => new Set(current).add(item.id));
    setError("");
    try {
      const action = item.likedByRequester ? "unlike" : "like";
      const response = await fetch("/api/square/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, itemId: item.id, action }),
      });
      const payload = await readApiJson<SquareLikeResponse>(response, "/api/square/like");
      if (!response.ok || !payload.ok) throw payload;
      setItems((current) => current.map((candidate) =>
        candidate.id === item.id
          ? {
            ...candidate,
            likeCount: typeof payload.likeCount === "number" ? payload.likeCount : candidate.likeCount,
            likedByRequester: payload.status === "liked" ? true : payload.status === "unliked" ? false : candidate.likedByRequester,
          }
          : candidate,
      ));
      void fetchQuota();
    } catch (likeError) {
      setError(formatError(likeError));
    } finally {
      setPendingLikeIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <main className="square-page" ref={pageRef}>
      {/* 一级导航由全局 AppHeader 承担 */}

      <section className="square-hero">
        <div className="square-hero-copy">
          <span className="home-kicker">Square</span>
          <h1>广场</h1>
          <p>创作者推荐的 AI 生成作品在这里展示。点赞你喜欢的创作，或者推荐你的得意之作。</p>
          {items.length > 0 && (
            <div className="square-metric-row">
              <div className="square-metric">
                <strong>{quota ? `${quota.shelfCount}/${quota.shelfLimit}` : "-/4"}</strong>
                <span>我的展示位</span>
              </div>
              <div className="square-metric">
                <strong>{quota ? quota.dailyRecommendLeft : "-"}</strong>
                <span>今日推荐</span>
              </div>
              <div className="square-metric">
                <strong>{quota ? quota.dailyLikeLeft : "-"}</strong>
                <span>今日点赞</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="square-controls">
        <div className="square-tabs" role="tablist" aria-label="广场排序">
          {SQUARE_FEED_TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={tab === item.value}
                className={tab === item.value ? "active" : ""}
                onClick={() => setTab(item.value)}
              >
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </div>
        <button type="button" className="subtle-button" onClick={() => void loadFeed(true)} disabled={isLoading}>
          {isLoading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
          刷新
        </button>
      </section>

      {error && (
        <div className="square-alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <section className="square-grid" aria-label="广场作品">
        {items.map((item) => (
          <SquareCard
            key={item.id}
            item={item}
            apiKeyReady={apiKeyReady}
            pendingLike={pendingLikeIds.has(item.id)}
            onLike={() => void toggleLike(item)}
            onCopyPrompt={() => void navigator.clipboard.writeText(item.prompt)}
            onPreview={() => setPreviewItem(item)}
          />
        ))}
        {isLoading && Array.from({ length: Math.max(4, SQUARE_PAGE_SIZE / 4) }, (_, index) => (
          <div className="square-card square-skeleton" key={`square-skeleton-${index}`}>
            <span />
            <div />
          </div>
        ))}
      </section>

      {!isLoading && items.length === 0 && (
        <div className="square-onboarding">
          <div className="square-onboarding-header">
            <h2>还没有作品，成为第一个推荐者</h2>
            <p>只需三步，你的创作就会出现在广场上。</p>
          </div>
          <div className="square-steps">
            <article className="square-step">
              <span className="square-step-icon"><WandSparkles size={22} /></span>
              <strong>生成作品</strong>
              <p>在工作台输入提示词，选择模型和参数，提交生成。</p>
            </article>
            <span className="square-step-arrow"><ArrowRight size={18} /></span>
            <article className="square-step">
              <span className="square-step-icon"><ImagePlus size={22} /></span>
              <strong>点击推荐</strong>
              <p>生成成功后，点击结果左下角的「推荐广场」按钮。</p>
            </article>
            <span className="square-step-arrow"><ArrowRight size={18} /></span>
            <article className="square-step">
              <span className="square-step-icon"><Star size={22} /></span>
              <strong>展示与互动</strong>
              <p>作品出现在广场，其他创作者可以浏览和点赞。</p>
            </article>
          </div>
          <button type="button" className="square-onboarding-cta" onClick={onEnterStudio}>
            开始创作
            <ArrowRight size={18} />
          </button>
          <div className="square-ghost-grid" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div className="square-ghost-card" key={i}>
                <div className="square-ghost-image" />
                <div className="square-ghost-body">
                  <div className="square-ghost-line wide" />
                  <div className="square-ghost-line narrow" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasMore && <div ref={loadMoreRef} className="load-more-sentinel" />}
      {isLoading && <div className="load-more-state">加载中...</div>}
      {!hasMore && items.length > 0 && <div className="load-more-state">已经到底了</div>}
      {previewItem && (
        <SquarePreviewModal
          item={previewItem}
          apiKeyReady={apiKeyReady}
          pendingLike={pendingLikeIds.has(previewItem.id)}
          onClose={() => setPreviewItem(null)}
          onLike={() => void toggleLike(previewItem)}
          onCopyPrompt={() => void navigator.clipboard.writeText(previewItem.prompt)}
          onDownload={() => downloadUrl(previewItem.thumbnailUrl, `${sanitizeFilename(previewItem.caption || previewItem.id)}.png`)}
          onReproduce={() => { setPreviewItem(null); onReproduce(previewItem); }}
        />
      )}
    </main>
  );
}

function mergeSquareItems(current: SquareFeedItem[], incoming: SquareFeedItem[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

function SquareCard({
  item,
  apiKeyReady,
  pendingLike,
  onLike,
  onCopyPrompt,
  onPreview,
}: {
  item: SquareFeedItem;
  apiKeyReady: boolean;
  pendingLike: boolean;
  onLike: () => void;
  onCopyPrompt: () => void;
  onPreview: () => void;
}) {
  const params = item.params || {};
  const sizeLabel = item.width && item.height ? `${item.width} x ${item.height}` : String(params.size || "-");
  return (
    <article className="square-card">
      <button className="square-card-image" type="button" title="预览作品" onClick={onPreview}>
        <img src={item.thumbnailUrl} alt={item.caption || item.prompt} loading="lazy" decoding="async" />
        <span>{item.pageLabel || item.recommenderLabel}</span>
        <strong>
          <Maximize2 size={15} />
          预览
        </strong>
      </button>
      <div className="square-card-body">
        <div className="square-card-title">
          <strong title={item.caption || item.prompt}>{item.caption || "未命名作品"}</strong>
          <small>{formatDate(item.createdAt)} · {item.recommenderLabel}</small>
        </div>
        <div className="square-card-tags">
          <span>{item.model}</span>
          <span>{String(params.aspectRatio || item.aspectRatio || "-")}</span>
          <span>{String(params.resolution || DEFAULT_IMAGE_RESOLUTION)}</span>
          <span>{sizeLabel}</span>
        </div>
        <p title={item.prompt}>{item.prompt}</p>
        <div className="square-card-actions">
          <button
            type="button"
            className={`square-like-button ${item.likedByRequester ? "liked" : ""}`}
            disabled={!apiKeyReady || pendingLike}
            title={apiKeyReady ? item.likedByRequester ? "取消点赞" : "点赞" : "配置 API Key 后可点赞"}
            onClick={onLike}
          >
            {pendingLike ? <Loader2 size={15} className="spin" /> : <Heart size={15} />}
            <span>{item.likeCount}</span>
          </button>
          <button type="button" className="icon-button" title="复制提示词" onClick={onCopyPrompt}>
            <Copy size={15} />
          </button>
          <button type="button" className="icon-button" title="预览作品" onClick={onPreview}>
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function SquarePreviewModal({
  item,
  apiKeyReady,
  pendingLike,
  onClose,
  onLike,
  onCopyPrompt,
  onDownload,
  onReproduce,
}: {
  item: SquareFeedItem;
  apiKeyReady: boolean;
  pendingLike: boolean;
  onClose: () => void;
  onLike: () => void;
  onCopyPrompt: () => void;
  onDownload: () => void;
  onReproduce: () => void;
}) {
  const params = item.params || {};
  const sizeLabel = item.width && item.height ? `${item.width} x ${item.height}` : String(params.size || "-");
  const promptTitle = item.caption || "广场作品";
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="square-preview-modal" role="dialog" aria-modal="true" aria-label="广场作品预览">
      <button className="preview-backdrop" type="button" aria-label="关闭预览" onClick={onClose} />
      <div className="square-preview-shell">
        <div className="square-preview-stage">
          <img src={item.thumbnailUrl} alt={promptTitle} />
        </div>
        <aside className="square-preview-side">
          <div className="preview-head">
            <div>
              <strong title={promptTitle}>{promptTitle}</strong>
              <span>{formatDate(item.createdAt)} · {item.recommenderLabel}</span>
            </div>
            <button type="button" className="icon-button" onClick={onClose} title="关闭">
              <X size={17} />
            </button>
          </div>
          <div className="square-preview-meta">
            <span>{item.model}</span>
            <span>{String(params.aspectRatio || item.aspectRatio || "-")}</span>
            <span>{String(params.resolution || DEFAULT_IMAGE_RESOLUTION)}</span>
            <span>{sizeLabel}</span>
            {item.pageLabel && <span>{item.pageLabel}</span>}
          </div>
          <div className="square-preview-prompt">
            {item.prompt || (item.promptHidden ? "创作者选择不公开提示词" : "")}
          </div>
          <div className="square-preview-actions">
            <button
              type="button"
              className={`square-like-button ${item.likedByRequester ? "liked" : ""}`}
              disabled={!apiKeyReady || pendingLike}
              title={apiKeyReady ? item.likedByRequester ? "取消点赞" : "点赞" : "配置 API Key 后可点赞"}
              onClick={onLike}
            >
              {pendingLike ? <Loader2 size={15} className="spin" /> : <Heart size={15} />}
              <span>{item.likeCount}</span>
            </button>
            <button type="button" className="subtle-button" onClick={onReproduce} title="把这张图的提示词与参数带回工作台直接生成">
              <WandSparkles size={15} />
              用同款参数生成
            </button>
            {item.prompt && (
              <button type="button" className="subtle-button" onClick={onCopyPrompt}>
                <Copy size={15} />
                复制提示词
              </button>
            )}
            <button type="button" className="subtle-button" onClick={onDownload}>
              <Download size={15} />
              下载预览图
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

// 管理端用户反馈面板：列表 + 状态流转 + 回复（用户端按 Key 哈希可见）
type AdminFeatureRequest = FeatureRequestItem & { userTag: string; contentRaw: string };

function AdminFeedbackPanel() {
  const [items, setItems] = useState<AdminFeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { status: FeatureRequestItem["status"]; adminReply: string }>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/feature-requests", { credentials: "same-origin" });
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setDrafts(Object.fromEntries((data.items || []).map((item: AdminFeatureRequest) => [
          item.id, { status: item.status, adminReply: item.adminReply },
        ])));
      }
    } catch { /* 刷新按钮兜底 */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  async function save(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/feature-requests/${id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(String(data.error || "保存失败"));
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...draft, updatedAt: Date.now() } : item)));
    } catch { /* 保持草稿，管理员可重试 */ }
    setSavingId("");
  }

  return (
    <section className="admin-feedback">
      <div className="admin-feedback-head">
        <h2>用户反馈（{items.length}）</h2>
        <button type="button" className="subtle-button" onClick={() => void load()}>
          <RefreshCw size={15} /> 刷新
        </button>
      </div>
      {loading ? (
        <div className="muted-box">加载中…</div>
      ) : items.length === 0 ? (
        <div className="muted-box">还没有用户提交反馈</div>
      ) : (
        <div className="admin-feedback-list">
          {items.map((item) => (
            <article key={item.id} className="admin-feedback-item">
              <header>
                <span className={`feedback-status is-${item.status}`}>{FEATURE_STATUS_LABELS[item.status]}</span>
                <code title="API Key 哈希前 6 位，仅用于辨识同一用户">用户 {item.userTag}</code>
                <small>{formatDate(item.createdAt)}</small>
              </header>
              <p className="admin-feedback-content">{item.content}</p>
              {item.contentRaw !== item.content && (
                <details className="admin-feedback-raw">
                  <summary>查看用户原文</summary>
                  <p>{item.contentRaw}</p>
                </details>
              )}
              <div className="admin-feedback-actions">
                <select
                  value={drafts[item.id]?.status || item.status}
                  onChange={(event) => setDrafts((prev) => ({
                    ...prev,
                    [item.id]: { status: event.target.value as FeatureRequestItem["status"], adminReply: prev[item.id]?.adminReply ?? item.adminReply },
                  }))}
                >
                  {(Object.keys(FEATURE_STATUS_LABELS) as Array<FeatureRequestItem["status"]>).map((key) => (
                    <option key={key} value={key}>{FEATURE_STATUS_LABELS[key]}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={drafts[item.id]?.adminReply ?? item.adminReply}
                  onChange={(event) => setDrafts((prev) => ({
                    ...prev,
                    [item.id]: { status: prev[item.id]?.status ?? item.status, adminReply: event.target.value },
                  }))}
                  placeholder="给用户的回复（用户端可见）"
                  maxLength={2000}
                />
                <button
                  type="button"
                  className="subtle-button"
                  disabled={savingId === item.id}
                  onClick={() => void save(item.id)}
                >
                  {savingId === item.id ? "保存中…" : "保存"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

// 站点加固（2026-07-27）：把原本硬编码、静默的防爆破机制暴露到后台——
// 阈值可调、封禁名单可管、安全事件可见。封禁按 clientIpKey 的 16 位哈希做，
// 管理员从事件/锁定列表里复制哈希即可封禁，既不泄露原始 IP，又与 request_logs 同源。
type SecurityThresholds = {
  adminMaxFails: number;
  adminLockMinutes: number;
  anonGeneratePerMin: number;
  anonAnalyzePerMin: number;
  anonFeedbackPerMin: number;
  anonFeaturePerMin: number;
};
type SecurityBan = { hash: string; reason: string; createdAt: number };
type SecurityLockout = { ipHash: string; fails: number; lockedUntil: number };
type SecurityEventRow = { at: number; type: string; ipHash: string; detail: string };

const SECURITY_EVENT_LABELS: Record<string, string> = {
  login_fail: "登录失败",
  login_lock: "登录锁定",
  rate_limit: "触发限流",
  ban_hit: "命中封禁",
  ban_add: "新增封禁",
};

const THRESHOLD_FIELDS: Array<{ key: keyof SecurityThresholds; label: string; hint: string }> = [
  { key: "adminMaxFails", label: "登录失败锁定阈值", hint: "连续失败多少次后锁定（次）" },
  { key: "adminLockMinutes", label: "锁定时长", hint: "触发后锁定多久（分钟）" },
  { key: "anonGeneratePerMin", label: "生成接口限流", hint: "每 IP 每分钟（次）" },
  { key: "anonAnalyzePerMin", label: "分析接口限流", hint: "每 IP 每分钟（次）" },
  { key: "anonFeedbackPerMin", label: "点赞/反馈限流", hint: "每 IP 每分钟（次）" },
  { key: "anonFeaturePerMin", label: "需求提交限流", hint: "每 IP 每分钟（次）" },
];

function AdminSecurityPanel() {
  const [thresholds, setThresholds] = useState<SecurityThresholds | null>(null);
  const [draft, setDraft] = useState<SecurityThresholds | null>(null);
  const [bans, setBans] = useState<SecurityBan[]>([]);
  const [lockouts, setLockouts] = useState<SecurityLockout[]>([]);
  const [events, setEvents] = useState<SecurityEventRow[]>([]);
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banHash, setBanHash] = useState("");
  const [banReason, setBanReason] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/security", { credentials: "same-origin" });
      const data = await res.json();
      if (data.ok) {
        setThresholds(data.thresholds);
        setDraft(data.thresholds);
        setBans(data.bans || []);
        setLockouts(data.lockouts || []);
        setEvents(data.events || []);
        setCounters(data.counters || {});
      }
    } catch { /* 刷新按钮兜底 */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  async function saveThresholds() {
    if (!draft) return;
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/config/security", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(String(data.error || "保存失败"));
      setThresholds(data.thresholds);
      setDraft(data.thresholds);
      setNotice("阈值已保存，立即对后续请求生效");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    }
    setSaving(false);
  }

  async function ban(hash: string, reason: string) {
    const clean = hash.trim().toLowerCase();
    if (!/^[0-9a-f]{16}$/.test(clean)) {
      setNotice("IP 标识需为 16 位十六进制哈希（可从下方事件/锁定列表复制）");
      return;
    }
    try {
      const res = await fetch("/api/admin/security/ban", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: clean, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(String(data.error || "封禁失败"));
      setBans(data.bans || []);
      setBanHash("");
      setBanReason("");
      setNotice(`已封禁 ${clean}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "封禁失败");
    }
  }

  async function unban(hash: string) {
    try {
      const res = await fetch("/api/admin/security/unban", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash }),
      });
      const data = await res.json();
      if (data.ok) setBans(data.bans || []);
    } catch { /* 忽略：列表会在下次刷新校正 */ }
  }

  const bannedSet = new Set(bans.map((item) => item.hash));

  return (
    <section className="admin-security">
      <div className="admin-security-head">
        <h2><ShieldAlert size={18} /> 站点加固</h2>
        <button type="button" className="subtle-button" onClick={() => void load()}>
          <RefreshCw size={15} /> 刷新
        </button>
      </div>
      {notice && <div className="admin-security-notice">{notice}</div>}

      {loading || !draft ? (
        <div className="muted-box">加载中…</div>
      ) : (
        <>
          <div className="admin-security-counters">
            {[
              { key: "login_fail", label: "登录失败" },
              { key: "login_lock", label: "登录锁定" },
              { key: "rate_limit", label: "触发限流" },
              { key: "ban_hit", label: "命中封禁" },
            ].map((item) => (
              <div key={item.key} className="admin-security-counter">
                <strong>{counters[item.key] || 0}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div className="admin-security-card">
            <h3>防爆破阈值</h3>
            <p className="admin-muted admin-config-hint">
              <ShieldCheck size={13} /> 改完立即对下一次请求生效，无需重启。生成/分析等接口按每 IP 每分钟限流；管理员登录连续失败超阈值即锁定。
            </p>
            <div className="admin-security-grid">
              {THRESHOLD_FIELDS.map((field) => (
                <label key={field.key} className="admin-security-field">
                  <span>{field.label}</span>
                  <input
                    type="number"
                    min={1}
                    value={draft[field.key]}
                    onChange={(event) => setDraft((prev) => prev && ({ ...prev, [field.key]: Number(event.target.value) }))}
                  />
                  <small>{field.hint}</small>
                </label>
              ))}
            </div>
            <div className="admin-security-actions">
              <button type="button" className="primary-button" disabled={saving} onClick={() => void saveThresholds()}>
                <Save size={15} /> {saving ? "保存中…" : "保存阈值"}
              </button>
              {thresholds && <span className="admin-muted">当前生效：失败 {thresholds.adminMaxFails} 次锁 {thresholds.adminLockMinutes} 分钟</span>}
            </div>
          </div>

          <div className="admin-security-card">
            <h3><Ban size={15} /> IP 封禁名单（{bans.length}）</h3>
            <p className="admin-muted admin-config-hint">
              被封禁的 IP 访问生成、分析、反馈、需求提交及管理员登录时一律 403。封禁按 IP 哈希做，从下方「实时锁定 / 安全事件」里复制哈希最省事。
            </p>
            <div className="admin-security-banadd">
              <input
                type="text"
                value={banHash}
                onChange={(event) => setBanHash(event.target.value)}
                placeholder="16 位 IP 哈希"
                maxLength={16}
              />
              <input
                type="text"
                value={banReason}
                onChange={(event) => setBanReason(event.target.value)}
                placeholder="封禁原因（可选）"
                maxLength={200}
              />
              <button type="button" className="subtle-button" onClick={() => void ban(banHash, banReason)}>
                <Ban size={14} /> 封禁
              </button>
            </div>
            {bans.length === 0 ? (
              <div className="muted-box">暂无封禁记录</div>
            ) : (
              <ul className="admin-security-banlist">
                {bans.map((item) => (
                  <li key={item.hash}>
                    <code>{item.hash}</code>
                    <span className="admin-security-reason">{item.reason}</span>
                    <small>{formatDate(item.createdAt)}</small>
                    <button type="button" className="subtle-button" onClick={() => void unban(item.hash)}>解除</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-security-cols">
            <div className="admin-security-card">
              <h3>实时锁定 / 高频失败（{lockouts.length}）</h3>
              {lockouts.length === 0 ? (
                <div className="muted-box">当前没有被锁定或高频失败的 IP</div>
              ) : (
                <ul className="admin-security-lockouts">
                  {lockouts.map((item) => (
                    <li key={item.ipHash}>
                      <code>{item.ipHash}</code>
                      <span className={item.lockedUntil > Date.now() ? "sec-locked" : "sec-fails"}>
                        {item.lockedUntil > Date.now() ? `锁定至 ${formatDate(item.lockedUntil)}` : `失败 ${item.fails} 次`}
                      </span>
                      {!bannedSet.has(item.ipHash) && (
                        <button type="button" className="subtle-button" onClick={() => void ban(item.ipHash, "登录高频失败")}>封禁</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="admin-security-card">
              <h3>安全事件（近 {events.length}）</h3>
              {events.length === 0 ? (
                <div className="muted-box">暂无安全事件</div>
              ) : (
                <ul className="admin-security-events">
                  {events.map((item, index) => (
                    <li key={`${item.at}-${index}`}>
                      <span className={`sec-event-tag is-${item.type}`}>{SECURITY_EVENT_LABELS[item.type] || item.type}</span>
                      <code>{item.ipHash}</code>
                      {item.detail && <span className="admin-security-detail">{item.detail}</span>}
                      <small>{formatDate(item.at)}</small>
                      {!bannedSet.has(item.ipHash) && /^[0-9a-f]{16}$/.test(item.ipHash) && (
                        <button type="button" className="link-button" onClick={() => void ban(item.ipHash, `来自事件：${item.type}`)}>封禁</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// 用户需求反馈（2026-07-27）：提交需 API Key + 服务端滑块验证（防爆破），
// 内容经大模型润色后进管理后台；用户按 Key 哈希看到自己的提交与管理员回复。
type FeatureRequestItem = {
  id: string;
  content: string;
  status: "pending" | "planned" | "done" | "rejected";
  adminReply: string;
  createdAt: number;
  updatedAt: number;
};

const FEATURE_STATUS_LABELS: Record<FeatureRequestItem["status"], string> = {
  pending: "待处理",
  planned: "已排期",
  done: "已完成",
  rejected: "暂不考虑",
};

function FeedbackModal({
  apiKey,
  baseUrl,
  analysisModel,
  onClose,
}: {
  apiKey: string;
  baseUrl: string;
  analysisModel: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
  const [captchaX, setCaptchaX] = useState<number | null>(null);
  const [captchaError, setCaptchaError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [myItems, setMyItems] = useState<FeatureRequestItem[]>([]);

  const loadCaptcha = async () => {
    setCaptchaX(null);
    setCaptchaError("");
    try {
      const data = await fetch("/api/feature-requests/captcha").then((r) => r.json());
      if (data.ok) setChallenge(data);
    } catch { /* 稍后可手动刷新 */ }
  };

  const loadMine = async () => {
    try {
      const data = await fetch("/api/feature-requests/mine", {
        headers: { "x-imagehub-api-key": apiKey },
      }).then((r) => r.json());
      if (data.ok) setMyItems(data.items || []);
    } catch { /* 列表加载失败不影响提交 */ }
  };

  useEffect(() => {
    void loadCaptcha();
    void loadMine();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    const trimmed = content.trim();
    if (trimmed.length < 5) { setNotice("请至少写 5 个字，让我们能看懂你的需求"); return; }
    if (!challenge || captchaX == null) { setNotice("请先完成滑块验证"); return; }
    setSubmitting(true);
    setNotice("");
    try {
      const res = await fetch("/api/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          baseUrl,
          analysisModel,
          content: trimmed,
          captchaToken: challenge.token,
          captchaX,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setNotice(String(data.error || "提交失败"));
        // 滑块 token 一次性：无论成败都要换一个新的
        void loadCaptcha();
        return;
      }
      setContent("");
      setNotice("已提交，感谢反馈！内容已由 AI 整理，管理员处理后可在下方看到回复。");
      void loadCaptcha();
      void loadMine();
    } catch {
      setNotice("网络异常，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="feedback-modal" role="dialog" aria-modal="true" aria-label="需求反馈">
      <button className="preview-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <div className="feedback-shell">
        <div className="feedback-head">
          <strong>需求反馈</strong>
          <span>写下你想要的功能或遇到的问题</span>
          <button type="button" className="icon-button" onClick={onClose} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="例如：希望画布支持一键导出全部原图…（5–2000 字）"
          rows={4}
          maxLength={2000}
        />
        <SliderCaptcha
          challenge={challenge}
          solved={captchaX != null}
          error={captchaError}
          onRefresh={() => void loadCaptcha()}
          onSolved={(x) => { setCaptchaX(x); setCaptchaError(""); }}
        />
        {notice && <div className="feedback-notice">{notice}</div>}
        <button
          type="button"
          className="primary-action"
          disabled={submitting || content.trim().length < 5 || captchaX == null}
          onClick={() => void submit()}
        >
          {submitting ? <Loader2 size={16} className="spin" /> : <Send size={16} />} 提交反馈
        </button>
        <div className="feedback-mine">
          <strong>我的反馈（{myItems.length}）</strong>
          {myItems.length === 0 ? (
            <span className="feedback-empty">还没有提交过反馈</span>
          ) : (
            myItems.map((item) => (
              <div key={item.id} className="feedback-item">
                <div className="feedback-item-head">
                  <span className={`feedback-status is-${item.status}`}>{FEATURE_STATUS_LABELS[item.status]}</span>
                  <small>{formatDate(item.createdAt)}</small>
                </div>
                <p>{item.content}</p>
                {item.adminReply && (
                  <div className="feedback-reply">
                    <strong>管理员回复：</strong>{item.adminReply}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// 参考图库（roadmap PRD B3）：本机收藏的参考图，跨 Studio/画布复用。
// objectUrl 随 items 变化重建、卸载时统一 revoke。
function ReferenceLibraryModal({
  items,
  onUse,
  onDelete,
  onClose,
}: {
  items: ReferenceLibraryItem[];
  onUse: (item: ReferenceLibraryItem) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    items.forEach((item) => { map[item.id] = URL.createObjectURL(item.blob); });
    setUrls(map);
    return () => Object.values(map).forEach((url) => URL.revokeObjectURL(url));
  }, [items]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="ref-library-modal" role="dialog" aria-modal="true" aria-label="参考图库">
      <button className="preview-backdrop" type="button" aria-label="关闭图库" onClick={onClose} />
      <div className="ref-library-shell">
        <div className="ref-library-head">
          <strong>参考图库</strong>
          <span>{items.length}/{REFERENCE_LIBRARY_LIMIT} · 仅存本机浏览器</span>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        {items.length === 0 ? (
          <div className="muted-box">还没有收藏。上传参考图后点击 ★ 即可收藏到这里。</div>
        ) : (
          <div className="ref-library-grid">
            {items.map((item) => (
              <div key={item.id} className="ref-library-item">
                <button type="button" className="ref-library-pick" title="用作参考图" onClick={() => onUse(item)}>
                  {urls[item.id] ? <img src={urls[item.id]} alt={item.name} loading="lazy" /> : null}
                </button>
                <div className="ref-library-meta">
                  <span title={item.name}>{item.name}</span>
                  <small>{formatBytes(item.bytes)}</small>
                  <button type="button" className="icon-button" title="从图库删除" onClick={() => onDelete(item.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OnboardingGuide({
  step,
  canGenerate,
  modelState,
  selectedModel,
  apiKeyReady,
  onStepChange,
  onOpenSettings,
  onFinish,
}: {
  step: number;
  canGenerate: boolean;
  modelState: ModelLoadState;
  selectedModel: string;
  apiKeyReady: boolean;
  onStepChange: (step: number) => void;
  onOpenSettings: () => void;
  onFinish: () => void;
}) {
  const steps = [
    {
      target: "api",
      title: "连接你的生图服务",
      body: "先在右侧配置里选择服务地址并填入 API Key。可用地址由管理后台统一配置，避免请求落到未知服务。",
      status: apiKeyReady ? "API Key 已填写" : "等待填写 API Key",
    },
    {
      target: "model",
      title: "读取并选择模型",
      body: "点击读取模型列表，只能从接口返回的模型中选择。模型就绪后，顶部会显示已连接状态。",
      status: modelState.status === "ready" && selectedModel ? `已选择 ${selectedModel}` : modelState.message,
    },
    {
      target: "composer",
      title: "输入提示词并生成",
    body: "回到底部输入框描述画面，选择宽高比、分辨率、张数和并发。提交后提示词会在发送动画完成后自动清空。",
      status: canGenerate ? "现在可以提交生成" : "等待提示词、模型和比例就绪",
    },
  ];
  const current = steps[step] || steps[0];
  const last = step >= steps.length - 1;
  const [spotlightStyle, setSpotlightStyle] = useState<CSSProperties>({});
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    let raf = 0;
    let scrollTimer = 0;
    const targetSelector = `[data-onboarding-target="${current.target}"]`;

    if (current.target !== "composer") {
      onOpenSettings();
    }

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const measure = () => {
      const target = document.querySelector<HTMLElement>(targetSelector);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const padding = 10;
      const left = clamp(rect.left - padding, 10, window.innerWidth - 40);
      const top = clamp(rect.top - padding, 10, window.innerHeight - 40);
      const width = Math.max(44, Math.min(rect.width + padding * 2, window.innerWidth - left - 10));
      const height = Math.max(44, Math.min(rect.height + padding * 2, window.innerHeight - top - 10));
      const panelWidth = Math.min(420, window.innerWidth - 28);
      const panelHeightEstimate = 250;
      const gap = 18;
      let panelLeft = 14;
      let panelTop = 14;

      if (left > panelWidth + gap + 14) {
        panelLeft = left - panelWidth - gap;
        panelTop = clamp(top, 14, window.innerHeight - panelHeightEstimate - 14);
      } else if (left + width + panelWidth + gap < window.innerWidth - 14) {
        panelLeft = left + width + gap;
        panelTop = clamp(top, 14, window.innerHeight - panelHeightEstimate - 14);
      } else if (top > panelHeightEstimate + gap + 14) {
        panelLeft = clamp(left, 14, window.innerWidth - panelWidth - 14);
        panelTop = top - panelHeightEstimate - gap;
      } else {
        panelLeft = clamp(left, 14, window.innerWidth - panelWidth - 14);
        panelTop = clamp(top + height + gap, 14, window.innerHeight - panelHeightEstimate - 14);
      }

      setSpotlightStyle({
        left,
        top,
        width,
        height,
      });
      setPanelStyle({
        left: panelLeft,
        top: panelTop,
        right: "auto",
        bottom: "auto",
      });
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(measure);
    };

    const target = document.querySelector<HTMLElement>(targetSelector);
    target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    scheduleMeasure();
    scrollTimer = window.setTimeout(scheduleMeasure, 260);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(scrollTimer);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
    };
  }, [current.target]);

  return (
    <div className="onboarding-overlay" role="presentation">
      <div className="onboarding-click-catcher" aria-hidden="true" />
      <div className="onboarding-spotlight" aria-hidden="true" style={spotlightStyle} />
      <div className="onboarding-panel" role="dialog" aria-modal="true" aria-label="首次使用引导" style={panelStyle}>
        <div className="onboarding-progress">
          {steps.map((item, index) => (
            <button
              key={item.title}
              type="button"
              className={index === step ? "active" : ""}
              aria-label={`第 ${index + 1} 步`}
              onClick={() => onStepChange(index)}
            />
          ))}
        </div>
        <div className="onboarding-copy">
          <span>首次使用 · 第 {step + 1} 步 / {steps.length}</span>
          <strong>{current.title}</strong>
          <p>{current.body}</p>
          <small>{current.status}</small>
        </div>
        <div className="onboarding-actions">
          <button type="button" className="subtle-button" onClick={onFinish}>
            跳过
          </button>
          {step === 0 && (
            <button type="button" className="subtle-button" onClick={onOpenSettings}>
              打开配置
            </button>
          )}
          <button
            type="button"
            className="primary-action"
            onClick={() => (last ? onFinish() : onStepChange(step + 1))}
          >
            {last ? "完成引导" : "下一步"}
            {!last && <ArrowRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// 签名元素：生成链路脉冲线 —— 段宽 = 各环节真实耗时占比（接收→上游生成→落盘→返回），
// 失败时停在断掉的那一段并转红；运行中为品牌色流光。结构装置编码真实信息，非装饰。
function JobPulseLine({ status, stages }: { status: JobStatus; stages?: JobStages }) {
  if (status === "submitting" || status === "queued") return null;
  if (status === "running") {
    return (
      <div className="pulse-line running" aria-hidden="true">
        <span />
      </div>
    );
  }
  const s = stages;
  if (!s?.receivedAt || !s.upstreamRequestedAt) {
    return status === "error" ? (
      <div className="pulse-line" aria-hidden="true"><span className="err" style={{ flexGrow: 1 }} /></div>
    ) : null;
  }
  const segments: Array<{ key: string; label: string; ms: number | null }> = [
    { key: "recv", label: "接收→请求上游", ms: s.upstreamRequestedAt - s.receivedAt },
    { key: "gen", label: "上游生成", ms: s.upstreamRespondedAt ? s.upstreamRespondedAt - s.upstreamRequestedAt : null },
    { key: "save", label: "图片落盘", ms: s.imageSavedAt && s.upstreamRespondedAt ? s.imageSavedAt - s.upstreamRespondedAt : null },
    { key: "ret", label: "返回", ms: s.returnedAt && s.imageSavedAt ? s.returnedAt - s.imageSavedAt : null },
  ];
  const failedIndex = status === "error" ? segments.findIndex((seg) => seg.ms === null) : -1;
  const title = segments
    .filter((seg) => seg.ms !== null)
    .map((seg) => `${seg.label} ${formatCompactDuration(seg.ms || 0)}`)
    .join(" · ");
  return (
    <div className={`pulse-line ${status === "error" ? "failed" : "done"}`} title={`生成链路：${title}`}>
      {segments.map((seg, index) => {
        if (seg.ms === null && index !== failedIndex) return null;
        const isFailed = index === failedIndex || (status === "error" && index === segments.length - 1 && failedIndex === -1);
        return (
          <span
            key={seg.key}
            className={isFailed ? "err" : ""}
            style={{ flexGrow: Math.max(seg.ms ?? 120, 40) }}
          />
        );
      })}
    </div>
  );
}

const JobCard = memo(function JobCard({
  job,
  highlighted,
  recordRef,
  selected,
  selectionMode,
  selectable,
  onToggleSelect,
  onRetry,
  onPreview,
  onDownload,
  onCopyPrompt,
  onRecommend,
  onOpenInCanvas,
  recommendState,
  canRecommend,
  feedback,
  onFeedback,
}: {
  job: Job;
  highlighted: boolean;
  recordRef: (element: HTMLElement | null) => void;
  selected: boolean;
  selectionMode: boolean;
  selectable: boolean;
  onToggleSelect: () => void;
  onRetry: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onCopyPrompt: () => void;
  onRecommend: () => void;
  onOpenInCanvas?: () => void;
  recommendState?: SquareRecommendStatus;
  canRecommend: boolean;
  feedback?: 1 | -1;
  onFeedback?: (rating: 1 | -1) => void;
}) {
  const [tickNow, setTickNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.status !== "running" || !job.startedAt) return;
    setTickNow(Date.now());
    const timer = window.setInterval(() => setTickNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.status, job.startedAt]);
  const elapsed = job.status === "running" && job.startedAt ? tickNow - job.startedAt : job.durationMs || 0;
  const previewClass = aspectClass(job.width, job.height, job.params.aspectRatio);
  const sizeLabel = job.width && job.height ? `${job.width} x ${job.height}` : job.params.size;
  const durationLabel = job.status === "submitting"
    ? "确认"
    : job.status === "queued"
      ? "等待"
      : elapsed > 0
        ? formatDuration(elapsed)
        : "-";
  const compactPrompt = job.prompt.replace(/\s+/g, " ").trim();
  const compactPromptChars = Array.from(compactPrompt);
  const promptPreview = compactPromptChars.length > 64 ? `${compactPromptChars.slice(0, 64).join("")}...` : compactPrompt;
  const storedReferenceImages = normalizeStoredReferenceImages(job.referenceImages);
  return (
    <article
      ref={recordRef}
      className={`job-card ${job.status} ${highlighted ? "highlighted" : ""} ${selected ? "selected" : ""} ${selectionMode ? "selection-mode" : ""}`}
    >
      <div className={`tile-preview ${previewClass}`}>
        {(selectionMode || selectable) && (
          <button
            type="button"
            className={`selection-toggle ${selected ? "selected" : ""}`}
            title={selectable ? "选择图片" : "运行中不可选择"}
            aria-pressed={selected}
            disabled={!selectable}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelect();
            }}
          >
            {selected ? <CheckSquare size={18} /> : <Square size={18} />}
          </button>
        )}
        {job.status === "success" && job.imageUrl && (
          <button type="button" className="preview-button" onClick={onPreview} title="预览图片">
            {/* 列表用缩略图；无缩略图的老记录回退原图，不会白屏 */}
            <img src={job.thumbUrl ?? job.imageUrl} alt="" loading="lazy" decoding="async" />
            <span>
              <Maximize2 size={16} />
            </span>
          </button>
        )}
        {job.status === "running" && (
          <div className="tile-state running">
            <Loader2 className="spin" size={24} />
            <strong>{formatDuration(elapsed)}</strong>
          </div>
        )}
        {job.status === "submitting" && (
          <div className="tile-state submitting">
            <Loader2 className="spin" size={24} />
            <strong>{job.errorDetail ? "状态确认中" : "提交中"}</strong>
          </div>
        )}
        {job.status === "queued" && (
          <div className="tile-state queued">
            <Clock3 size={22} />
            <strong>{(job.attempt ?? 1) > 1 ? `重试中 ${job.attempt}/${job.maxAttempts}` : "排队中"}</strong>
          </div>
        )}
        {job.status === "error" && (
          <button type="button" className="tile-state tile-state-button error" onClick={onPreview} title="查看失败详情">
            <AlertCircle size={22} />
            <strong>生成失败</strong>
            <span>{(job.attempt ?? 1) > 1 ? `重试 ${(job.attempt ?? 1) - 1} 次后仍失败 · 查看详情` : "查看详情"}</span>
          </button>
        )}
        <div className="tile-index">#{job.index}</div>
        {storedReferenceImages.length > 0 && (
          <div className="tile-reference-stack" title={`已保存 ${storedReferenceImages.length} 张参考图`}>
            <span>参考图 {storedReferenceImages.length}</span>
            <div>
              {storedReferenceImages.slice(0, 3).map((image) => (
                <img key={image.id} src={image.thumbnailDataUrl || image.dataUrl} alt="" loading="lazy" decoding="async" />
              ))}
            </div>
          </div>
        )}
        {job.status === "success" && job.imageUrl && (
          <button
            type="button"
            className={`tile-square-action ${recommendState?.status || ""}`}
            title={canRecommend ? recommendState?.message || "推荐到广场" : "配置 API Key 后可推荐到广场"}
            disabled={!canRecommend || recommendState?.status === "submitting"}
            onClick={(event) => {
              event.stopPropagation();
              onRecommend();
            }}
          >
            {recommendState?.status === "submitting" ? <Loader2 size={13} className="spin" /> : <ExternalLink size={13} />}
            <span>{recommendState?.status === "success" ? "已推荐" : recommendState?.status === "submitting" ? "推荐中" : "推荐广场"}</span>
          </button>
        )}
      </div>

      <div className="tile-body">
        <div className="tile-summary-line">
          <StatusBadge status={job.status} elapsed={elapsed} />
          <strong className="tile-model" title={job.model}>{job.model}</strong>
          <div className="tile-meta-compact">
            <span>{job.params.aspectRatio}</span>
            <span>{job.params.resolution || DEFAULT_IMAGE_RESOLUTION}</span>
            <span title={sizeLabel}>{sizeLabel}</span>
            <span>{durationLabel}</span>
          </div>
        </div>

        {job.agentName && (
          <div className="tile-agent-line" title={job.agentScenario || ""}>
            <WandSparkles size={13} />
            <span>{job.agentName}</span>
            {job.promptVariant && <small>{PROMPT_VARIANT_LABELS[job.promptVariant]}</small>}
          </div>
        )}

        {job.status === "error" && (
          <button type="button" className="tile-error-line" title={serializeError(job.errorDetail)} onClick={onPreview}>
            {formatError(job.errorDetail)}
          </button>
        )}

        <div className="tile-bottom-line">
          <div className="tile-prompt" title={job.prompt}>{promptPreview}</div>
          <div className="job-actions">
            <button type="button" className="icon-button" title="复制提示词" onClick={onCopyPrompt}>
              <Copy size={16} />
            </button>
            {job.status === "success" && (
              <button type="button" className="icon-button" title="预览图片" onClick={onPreview}>
                <Maximize2 size={16} />
              </button>
            )}
            {job.status === "success" && (
              <button type="button" className="icon-button" title="下载图片" onClick={onDownload}>
                <Download size={16} />
              </button>
            )}
            {job.status === "success" && onOpenInCanvas && (
              <button type="button" className="icon-button" title="在画布中打开：作为节点继续迭代" onClick={onOpenInCanvas}>
                <Frame size={16} />
              </button>
            )}
            {job.status === "success" && onFeedback && (
              <button
                type="button"
                className={`icon-button feedback-button ${feedback === 1 ? "feedback-up-active" : ""}`}
                title="好评：这张图符合预期"
                onClick={() => onFeedback(1)}
              >
                <ThumbsUp size={16} />
              </button>
            )}
            {job.status === "success" && onFeedback && (
              <button
                type="button"
                className={`icon-button feedback-button ${feedback === -1 ? "feedback-down-active" : ""}`}
                title="差评：这张图不符合预期"
                onClick={() => onFeedback(-1)}
              >
                <ThumbsDown size={16} />
              </button>
            )}
            {job.status === "error" && (
              <button type="button" className="icon-button" title="查看失败详情" onClick={onPreview}>
                <AlertCircle size={16} />
              </button>
            )}
            {job.status === "error" && (
              <button type="button" className="icon-button" title="重试" onClick={onRetry}>
                <RefreshCw size={16} />
              </button>
            )}
            {job.status === "queued" && (
              <button type="button" className="icon-button" title="排队中" disabled>
                <Clock3 size={16} />
              </button>
            )}
            {job.status === "submitting" && (
              <button type="button" className="icon-button" title="正在确认服务端接单状态" disabled>
                <Loader2 size={16} className="spin" />
              </button>
            )}
            {job.status === "running" && (
              <button type="button" className="icon-button" title="生成中" disabled>
                <Loader2 size={16} className="spin" />
              </button>
            )}
          </div>
        </div>

        <JobPulseLine status={job.status} stages={job.stages} />
      </div>
    </article>
  );
}, (previous, next) =>
  previous.job === next.job &&
  previous.highlighted === next.highlighted &&
  previous.selected === next.selected &&
  previous.selectionMode === next.selectionMode &&
  previous.selectable === next.selectable &&
  previous.recommendState === next.recommendState &&
  previous.canRecommend === next.canRecommend &&
  previous.feedback === next.feedback
);

function SidebarToggleButton({
  side,
  open,
  title,
  onClick,
}: {
  side: "left" | "right";
  open: boolean;
  title: string;
  onClick: () => void;
}) {
  const Icon = side === "left"
    ? open ? PanelLeftClose : PanelLeftOpen
    : open ? PanelRightClose : PanelRightOpen;
  return (
    <button type="button" className="topbar-toggle" title={title} onClick={onClick} aria-pressed={open}>
      <Icon size={18} />
    </button>
  );
}

function FrontendUpdateNotice({
  version,
  onRefresh,
  onDismiss,
}: {
  version: string;
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="version-update-notice" role="status" aria-live="polite">
      <div>
        <strong>新版本可用</strong>
        <span>检测到前端版本 v{version}，刷新后会加载最新样式和脚本。</span>
      </div>
      <button type="button" className="primary-action compact" onClick={onRefresh}>
        <RefreshCw size={15} />
        刷新
      </button>
      <button type="button" className="icon-button" title="稍后提醒" onClick={onDismiss}>
        <X size={15} />
      </button>
    </div>
  );
}

function BulkActionBar({
  selectedCount,
  downloadableCount,
  selectableCount,
  failedCount,
  isDownloading,
  onSelectAll,
  onClearFailed,
  onInvert,
  onDownload,
  onDelete,
  onCancel,
}: {
  selectedCount: number;
  downloadableCount: number;
  selectableCount: number;
  failedCount: number;
  isDownloading: boolean;
  onSelectAll: () => void;
  onClearFailed: () => void;
  onInvert: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <strong>已选 {selectedCount} / 可选 {selectableCount}</strong>
      <button type="button" className="subtle-button" onClick={onSelectAll} disabled={selectableCount === 0}>
        全选已显示
      </button>
      <button type="button" className="subtle-button danger" onClick={onClearFailed} disabled={failedCount === 0}>
        <Trash2 size={16} />
        清除失败 {failedCount || ""}
      </button>
      <button type="button" className="subtle-button" onClick={onInvert} disabled={selectableCount === 0}>
        反选
      </button>
      <button type="button" className="subtle-button" onClick={onDownload} disabled={downloadableCount === 0 || isDownloading}>
        {isDownloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
        下载 {downloadableCount || ""}
      </button>
      <button type="button" className="subtle-button danger" onClick={onDelete} disabled={selectedCount === 0}>
        <Trash2 size={16} />
        删除
      </button>
      <button type="button" className="subtle-button" onClick={onCancel}>
        <X size={16} />
        取消选择
      </button>
    </>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="confirm-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button className="confirm-backdrop" type="button" aria-label="取消" onClick={onCancel} />
      <div className="confirm-card">
        <div>
          <strong>{title}</strong>
          <p>{body}</p>
        </div>
        <div className="confirm-actions">
          <button type="button" className="subtle-button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="subtle-button danger solid" onClick={onConfirm}>
            <Trash2 size={16} />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentModeSwitch({
  enabled,
  status,
  onToggle,
}: {
  enabled: boolean;
  status: AgentModeStatus;
  onToggle: () => void;
}) {
  // 未启用时只留一个 chip：默认关闭的功能不该常驻占两行说明
  if (!enabled) {
    return (
      <button
        type="button"
        className="composer-tool-chip"
        onClick={onToggle}
        title="开启 Agent 模式 A：自动编排单图、多图与宣传画册"
      >
        <Bot size={14} />
        {AGENT_MODE_NAME}
      </button>
    );
  }
  return (
    <div className={`agent-mode-switch is-on status-${status}`}>
      <div className="agent-mode-switch-copy">
        <strong>{AGENT_MODE_NAME}</strong>
        <span>理解任务并自动拆解</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className="agent-mode-toggle is-on"
        onClick={onToggle}
        title="关闭 Agent 模式 A"
      >
        <span className="agent-mode-toggle-track">
          <span className="agent-mode-toggle-thumb">
            <Bot size={14} />
          </span>
        </span>
      </button>
    </div>
  );
}

function AgentModeStatusPanel({
  state,
  onClear,
  onReanalyze,
}: {
  state: AgentModeState;
  onClear: () => void;
  onReanalyze: () => void;
}) {
  if (!state.message && state.status === "idle") return null;
  const icon = state.status === "analyzing" || state.status === "receiving" || state.status === "executing"
    ? <Loader2 size={16} className="spin" />
    : state.status === "error"
      ? <AlertCircle size={16} />
      : state.status === "planned"
        ? <Bot size={16} />
        : <CheckCircle2 size={16} />;
  return (
    <div className={`agent-mode-status-panel ${state.status}`} role="status" aria-live="polite">
      <div className="agent-mode-status-head">
        <div className="agent-mode-status-mark">{icon}</div>
        <div>
          <strong>
            {state.status === "analyzing"
              ? "正在理解任务"
              : state.status === "receiving"
                ? "AI 输出中"
              : state.status === "needs_confirmation"
                ? "等待确认"
                : state.status === "planned"
                  ? "画册规划已准备好"
                  : state.status === "executing"
                    ? "任务已进入队列"
                    : state.status === "error"
                      ? "解析失败"
                      : AGENT_MODE_NAME}
          </strong>
          <span>{state.message}</span>
          {(state.streamChunks || state.streamCharacters) && (
            <small className="agent-mode-status-progress">
              {`进度 · ${state.streamChunks || 0} 段 / ${state.streamCharacters || 0} 字`}
            </small>
          )}
          {state.streamPreview && (
            <pre className="agent-mode-status-stream">{state.streamPreview}</pre>
          )}
          {state.error && <small>{state.error}</small>}
        </div>
      </div>
      <div className="agent-mode-status-actions">
        {(state.status === "planned" || state.status === "needs_confirmation" || state.status === "error") && (
          <button type="button" className="subtle-button" title="重新分析当前需求" onClick={onReanalyze}>
            <RefreshCw size={15} />
            重新分析
          </button>
        )}
        {state.status !== "analyzing" && state.status !== "receiving" && (
          <button type="button" className="icon-button" title="清除 Agent 状态" onClick={onClear}>
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function AgentModePlanModal({
  plan,
  onCancel,
  onConfirm,
  onReanalyze,
}: {
  plan: AgentModeAnalysisResult;
  onCancel: () => void;
  onConfirm: () => void;
  onReanalyze: () => void;
}) {
  return (
    <div className="confirm-modal" role="dialog" aria-modal="true" aria-label="Agent 任务拆解">
      <button className="confirm-backdrop" type="button" aria-label="关闭 Agent 任务拆解" onClick={onCancel} />
      <div className="confirm-card agent-plan-modal">
        <div className="agent-plan-modal-head">
          <div>
            <strong>{AGENT_MODE_NAME} 任务拆解</strong>
            <p>{plan.reasoningSummary}</p>
          </div>
          <span className={`risk-badge ${plan.estimatedCostLevel === "high" ? "high" : plan.estimatedCostLevel === "medium" ? "medium" : "low"}`}>
            {plan.estimatedCostLevel === "high" ? "高消耗" : plan.estimatedCostLevel === "medium" ? "中消耗" : "低消耗"}
          </span>
        </div>
        <div className="agent-plan-modal-list">
          {plan.jobs.map((job, index) => (
            <article className="agent-plan-job-card" key={job.id || `${job.title}-${index}`}>
              <div className="agent-plan-job-head">
                <strong>{job.title}</strong>
                <small>{job.count || 1} 张 · {job.aspectRatio || "自动比例"} · {job.resolution || "自动清晰度"}</small>
              </div>
              {job.objective && <span className="agent-plan-job-objective">{job.objective}</span>}
              <p>{job.prompt}</p>
            </article>
          ))}
        </div>
        <div className="confirm-actions">
          <button type="button" className="subtle-button" onClick={onReanalyze}>
            <RefreshCw size={15} />
            重新分析
          </button>
          <button type="button" className="subtle-button" onClick={onCancel}>
            返回编辑
          </button>
          <button type="button" className="primary-action compact" onClick={onConfirm}>
            <ArrowRight size={15} />
            确认并生成 {plan.jobs.reduce((sum, job) => sum + (job.count || 1), 0)} 张
          </button>
        </div>
      </div>
    </div>
  );
}

function BrochurePlannerModal({
  project,
  onCancel,
  onGenerateBoards,
  onReanalyze,
}: {
  project: AgentModeBrochureProject;
  onCancel: () => void;
  onGenerateBoards: () => void;
  onReanalyze: () => void;
}) {
  return (
    <div className="confirm-modal" role="dialog" aria-modal="true" aria-label="宣传画册规划">
      <button className="confirm-backdrop" type="button" aria-label="关闭宣传画册规划" onClick={onCancel} />
      <div className="confirm-card brochure-plan-modal">
        <div className="agent-plan-modal-head">
          <div>
            <strong>{project.title}</strong>
            <p>{project.summary}</p>
          </div>
          <span className="brochure-plan-count">{project.pageCount} 页</span>
        </div>
        <div className="brochure-plan-meta">
          <span>{project.companyName || "未指定公司名"}</span>
          <span>{project.industry || "行业待细化"}</span>
          <span>{project.purpose || "公司宣传"}</span>
        </div>
        <div className="brochure-plan-section">
          <strong>页结构</strong>
          <div className="brochure-outline-list">
            {project.outline.map((page) => (
              <div className="brochure-outline-item" key={`${page.pageNo}-${page.role}`}>
                <span>#{page.pageNo}</span>
                <div>
                  <strong>{page.title}</strong>
                  <small>{page.objective}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="brochure-plan-section">
          <strong>推荐模板方向</strong>
          <div className="brochure-style-chip-row">
            {project.styleDirections.map((direction) => (
              <span key={direction}>{direction}</span>
            ))}
          </div>
        </div>
        <div className="confirm-actions">
          <button type="button" className="subtle-button" onClick={onReanalyze}>
            <RefreshCw size={15} />
            重新分析
          </button>
          <button type="button" className="subtle-button" onClick={onCancel}>
            稍后再说
          </button>
          <button type="button" className="primary-action compact" onClick={onGenerateBoards}>
            <WandSparkles size={15} />
            生成整本模板板
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, elapsed }: { status: JobStatus; elapsed: number }) {
  const map = {
    submitting: { label: "状态确认", icon: <Loader2 size={15} className="spin" /> },
    queued: { label: "排队", icon: <Clock3 size={15} /> },
    running: { label: formatDuration(elapsed), icon: <Loader2 size={15} className="spin" /> },
    success: { label: formatDuration(elapsed), icon: <CheckCircle2 size={15} /> },
    error: { label: formatDuration(elapsed), icon: <AlertCircle size={15} /> },
  };
  return (
    <div className={`status-badge ${status}`}>
      {map[status].icon}
      <span>{map[status].label}</span>
    </div>
  );
}

function ImageInfo({ job }: { job: Job | HistoryRecord | PreviewItem }) {
  const params = job.params;
  return (
    <dl className="image-info">
      <div>
        <dt>协议</dt>
        <dd>{job.protocol ? getProtocolDefinition(job.protocol).label : "-"}</dd>
      </div>
      <div>
        <dt>宽高比</dt>
        <dd>{params.aspectRatio || "-"}</dd>
      </div>
      <div>
        <dt>分辨率</dt>
        <dd>{params.resolution || DEFAULT_IMAGE_RESOLUTION}</dd>
      </div>
      <div>
        <dt>实际尺寸</dt>
        <dd>{job.width && job.height ? `${job.width} x ${job.height}` : "-"}</dd>
      </div>
      <div>
        <dt>请求尺寸</dt>
        <dd>{params.size}</dd>
      </div>
      <div>
        <dt>质量</dt>
        <dd>{params.quality}</dd>
      </div>
      <div>
        <dt>格式</dt>
        <dd>{params.outputFormat.toUpperCase()}</dd>
      </div>
      <div>
        <dt>开始</dt>
        <dd>{formatFullDate(job.startedAt)}</dd>
      </div>
      <div>
        <dt>完成</dt>
        <dd>{formatFullDate(job.finishedAt)}</dd>
      </div>
      <div>
        <dt>耗时</dt>
        <dd>{formatDuration(job.durationMs)}</dd>
      </div>
      {"agentName" in job && job.agentName && (
        <div>
          <dt>Agent</dt>
          <dd>{job.agentName}{job.promptVariant ? ` · ${PROMPT_VARIANT_LABELS[job.promptVariant]}` : ""}</dd>
        </div>
      )}
    </dl>
  );
}

function HistoryDetail({
  record,
  onPreview,
  onDownload,
  onCopyPrompt,
  onDelete,
}: {
  record: HistoryRecord;
  onPreview: () => void;
  onDownload: () => void;
  onCopyPrompt: () => void;
  onDelete: () => void;
}) {
  const previewClass = aspectClass(record.width, record.height, record.params.aspectRatio);
  const previewAspect = previewStyle(record.width, record.height, record.params.aspectRatio);
  const storedReferenceImages = normalizeStoredReferenceImages(record.referenceImages);
  return (
    <article className={`history-detail ${record.status}`}>
      <div className="job-meta">
        <div>
          <span className="eyebrow">历史记录</span>
          <strong>{record.model}</strong>
        </div>
        <StatusBadge status={record.status} elapsed={record.durationMs || 0} />
      </div>

      {record.objectUrl ? (
        <div className="result-layout large">
          <button
            type="button"
            className={`result-preview-button ${previewClass}`}
            style={previewAspect}
            onClick={onPreview}
          >
            <img className="result-image" src={record.objectUrl} alt="" />
            <span>
              <Maximize2 size={17} />
              预览
            </span>
          </button>
          <ImageInfo job={record} />
        </div>
      ) : record.status === "submitting" || record.status === "queued" || record.status === "running" ? (
        <div className="loading-frame queued">
          <Loader2 size={20} className="spin" />
          <span>{record.status === "submitting" ? "正在确认服务端接单状态" : record.status === "queued" ? "任务排队中" : "任务生成中"}</span>
        </div>
      ) : (
        <div className="error-box">
          <div>
            <AlertCircle size={18} />
            <strong>{formatError(record.errorDetail)}</strong>
          </div>
          <details open>
            <summary>错误详情</summary>
            <pre>{serializeError(record.errorDetail)}</pre>
          </details>
        </div>
      )}

      <div className="prompt-block">{record.prompt}</div>

      {storedReferenceImages.length > 0 && (
        <div className="reference-readonly">
          {storedReferenceImages.map((image) => (
            <div key={image.id}>
              <img src={image.thumbnailDataUrl || image.dataUrl} alt="" />
              <span>{image.name}</span>
              <small>{referenceDimensionLabel(image)} · {formatBytes(image.size)}</small>
            </div>
          ))}
        </div>
      )}

      <div className="job-actions">
        {record.objectUrl && (
          <button type="button" className="subtle-button" onClick={onPreview}>
            <Maximize2 size={16} />
            预览
          </button>
        )}
        <button type="button" className="subtle-button" onClick={onCopyPrompt}>
          <Copy size={16} />
          复制提示词
        </button>
        {record.objectUrl && (
          <button type="button" className="subtle-button" onClick={onDownload}>
            <Download size={16} />
            下载
          </button>
        )}
        <button type="button" className="subtle-button danger" onClick={onDelete}>
          <Trash2 size={16} />
          删除
        </button>
      </div>
    </article>
  );
}

function ImagePreviewModal({
  item,
  onClose,
  onDownload,
  onCopyPrompt,
  onRecommend,
  recommendState,
  canRecommend,
}: {
  item: PreviewItem;
  onClose: () => void;
  onDownload: () => void;
  onCopyPrompt: () => void;
  onRecommend: () => void;
  recommendState?: SquareRecommendStatus;
  canRecommend: boolean;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 原图加载三态：loading 期间用缩略图作底但必须有可见的加载提示；error 时清掉缩略图并明确报错
  const [fullImageState, setFullImageState] = useState<"loading" | "ready" | "error">("loading");
  const [fullImageAttempt, setFullImageAttempt] = useState(0);
  const previewClass = aspectClass(item.width, item.height, item.params.aspectRatio);
  const hasImage = Boolean(item.url);
  const fullImageFail = item.url
    ? { title: "原图加载失败", hint: "可能是网络问题，或图片已被服务器清理。", canRetry: true }
    : { title: "本地图片数据已丢失", hint: "可能是浏览器清理了存储空间。", canRetry: false };
  const retryFullImage = () => {
    setFullImageState("loading");
    setFullImageAttempt((n) => n + 1);
  };
  useEffect(() => {
    setFullImageState("loading");
    setFullImageAttempt(0);
  }, [item.id, item.url]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isFullscreen) {
        setIsFullscreen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen, onClose]);

  return (
    <div className="preview-modal" role="dialog" aria-modal="true" aria-label={hasImage ? "图片预览" : "失败详情"}>
      <button className="preview-backdrop" type="button" aria-label="关闭预览" onClick={onClose} />
      <div className={`preview-shell ${isFullscreen ? "is-fullscreen" : ""}`}>
        <div className={`preview-stage ${hasImage ? previewClass : "is-error-detail"}`}>
          {hasImage && fullImageState === "error" ? (
            // 原图不可用：明确报错，绝不用缩略图充数（生图工具靠原图判断成片质量）
            <div className="preview-error-frame">
              <AlertCircle size={30} />
              <strong>{fullImageFail.title}</strong>
              <span>{fullImageFail.hint}</span>
              {fullImageFail.canRetry && (
                <button type="button" className="subtle-button" onClick={retryFullImage}>
                  <RefreshCw size={15} />
                  重试
                </button>
              )}
              {item.requestId && <code>requestID: {item.requestId}</code>}
            </div>
          ) : hasImage ? (
            <button
              type="button"
              className={`preview-image-frame${fullImageState === "loading" ? " is-loading-full" : ""}`}
              title={isFullscreen ? "退出全屏查看" : "全屏查看图片"}
              onClick={() => setIsFullscreen((value) => !value)}
            >
              <img
                key={fullImageAttempt}
                src={item.url}
                alt=""
                onLoad={() => setFullImageState("ready")}
                onError={() => setFullImageState("error")}
              />
              {fullImageState === "loading" && (
                <span className="preview-loading-hint">
                  <Loader2 size={14} className="spin" />
                  正在加载原图…
                </span>
              )}
            </button>
          ) : (
            <div className="preview-error-frame">
              <AlertCircle size={30} />
              <strong>生成失败</strong>
              <span>{formatError(item.errorDetail)}</span>
              {item.requestId && <code>requestID: {item.requestId}</code>}
            </div>
          )}
          {hasImage && isFullscreen && (
            <div className="preview-fullscreen-toolbar">
              <button type="button" className="icon-button" onClick={() => setIsFullscreen(false)} title="退出全屏">
                <X size={17} />
              </button>
            </div>
          )}
          {hasImage && (
            <div className="preview-square-toolbar">
              <button
                type="button"
                className={`subtle-button ${recommendState?.status === "success" ? "square-success" : ""}`}
                title={canRecommend ? recommendState?.message || "推荐到广场" : "配置 API Key 后可推荐到广场"}
                disabled={!canRecommend || recommendState?.status === "submitting"}
                onClick={onRecommend}
              >
                {recommendState?.status === "submitting" ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}
                {recommendState?.status === "success" ? "已推荐到广场" : recommendState?.status === "submitting" ? "推荐中" : "推荐到广场"}
              </button>
              {recommendState?.message && <span>{recommendState.message}</span>}
            </div>
          )}
        </div>
        <aside className="preview-side">
          <div className="preview-head">
            <div>
              <span className="eyebrow">{hasImage ? "预览" : "失败详情"}</span>
              <strong>{item.model}</strong>
            </div>
            <div className="preview-head-actions">
              <button type="button" className="icon-button" onClick={onCopyPrompt} title="复制提示词">
                <Copy size={16} />
              </button>
              {hasImage && (
                <button type="button" className="icon-button" onClick={onDownload} title="下载图片">
                  <Download size={16} />
                </button>
              )}
              <button className="icon-button" type="button" onClick={onClose} title="关闭">
                <X size={17} />
              </button>
            </div>
          </div>
          <ImageInfo job={item} />
          {item.agentName && (
            <div className="preview-agent-meta">
              <span>{item.agentName}</span>
              <small>{item.promptVariant ? PROMPT_VARIANT_LABELS[item.promptVariant] : "Agent"}</small>
            </div>
          )}
          {item.submittedReferenceImages && item.submittedReferenceImages.length > 0 && (
            <div className="preview-submitted-refs">
              <div className="preview-submitted-refs-head">
                <strong>提交的参考图</strong>
                <small>压缩后 · 实际发送给上游的版本</small>
              </div>
              <div className="preview-submitted-refs-grid">
                {item.submittedReferenceImages.map((ref, index) => (
                  <a
                    key={`${ref.name}-${index}`}
                    className="preview-submitted-ref"
                    href={ref.dataUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={`${ref.name} · ${formatBytes(ref.requestBytes)}${ref.compressed ? `（原 ${formatBytes(ref.originalBytes)}）` : ""}`}
                  >
                    <img src={ref.dataUrl} alt={ref.name} />
                    <span>
                      <strong>#{index + 1}</strong>
                      <small>{formatBytes(ref.requestBytes)}{ref.compressed ? ` · 压缩自 ${formatBytes(ref.originalBytes)}` : " · 原图"}</small>
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {!hasImage && (
            <div className="preview-error-detail">
              <strong>失败详情</strong>
              <pre>{serializeError(item.errorDetail)}</pre>
            </div>
          )}
          <div className="preview-prompt">{item.prompt}</div>
        </aside>
      </div>
    </div>
  );
}
