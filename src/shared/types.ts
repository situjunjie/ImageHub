// 共享类型层（canvas-v2-prd §5.2 C0 拆分）：被 App 与 canvas 层同时使用的类型。
// 叶子模块：不 import App.tsx / ../canvas/*。

export type ImageProtocol =
  | "custom-openai"
  | "openai-images"
  | "openai-responses"
  | "gemini-native"
  | "gemini-openai"
  | "google-imagen"
  | "stability-core";

export type ApiConfig = {
  protocol: ImageProtocol;
  baseUrl: string;
  apiKey: string;
  rememberKey: boolean;
};

export type ImageResolution = "1K" | "2K" | "4K";

export type ImageParams = {
  aspectRatio: string;
  size: string;
  resolution: ImageResolution;
  quality: string;
  outputFormat: "png" | "jpeg" | "webp";
  batchCount: number;
  concurrency: number;
  retryLimit: number;
  seed: string;
  negativePrompt: string;
};

export type SubmittedReference = {
  name: string;
  type: string;
  dataUrl: string;
  originalBytes: number;
  requestBytes: number;
  compressed: boolean;
};

export type ReferenceStatus = "ready" | "warning" | "error";

export type UploadedReference = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  thumbnailDataUrl?: string;
  width?: number;
  height?: number;
  status?: ReferenceStatus;
  message?: string;
};

export type JobStages = {
  // 客户端阶段使用浏览器时钟；服务端同时保存 recordedAt，便于识别明显的时钟偏差。
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
  // 出队开始执行的时刻。receivedAt→dispatchedAt 是服务端排队等待
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

export type GenerationTaskStatus = "submitting" | "queued" | "running" | "success" | "error";

export type GenerationSurface = "studio" | "canvas";

export type GenerationClientTrace = {
  surface: GenerationSurface;
  localRecordId?: string;
  submittedAt: number;
  persistedAt?: number;
  requestStartedAt?: number;
};

export type GenerationLifecycleEvent = {
  id: string;
  phase: string;
  source: "client" | "server" | "upstream";
  at: number;
  recordedAt?: number;
  detail?: string;
};

export type GenerationClientLifecyclePhase =
  | "client_submitted"
  | "client_persisted"
  | "client_request_started"
  | "client_accepted"
  | "client_transport_ambiguous"
  | "client_reconcile_started"
  | "client_reconcile_found"
  | "client_reconcile_miss"
  | "client_idempotent_retry"
  | "client_submission_rejected"
  | "client_submission_unconfirmed"
  | "client_result_received"
  | "client_error_received";

export type GenerationClientEventPayload = {
  requestId: string;
  clientId: string;
  phase: GenerationClientLifecyclePhase;
  occurredAt?: number;
  surface?: GenerationSurface;
  localRecordId?: string;
  detail?: string;
  context?: {
    protocol?: ImageProtocol;
    model?: string;
    prompt?: string;
    baseUrl?: string;
    batchId?: string;
    batchIndex?: number;
    batchTotal?: number;
    aspectRatio?: string;
    resolution?: string;
    size?: string;
    referenceCount?: number;
  };
};

export type GenerationRequestPayload = {
  protocol: ImageProtocol;
  model: string;
  prompt: string;
  size?: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  outputFormat?: string;
  seed?: string;
  negativePrompt?: string;
  referenceImages?: Array<{ name: string; type: string; dataUrl: string }>;
  batchId?: string;
  index?: number;
  total?: number;
  agentId?: string;
  agentName?: string;
  agentScenario?: string;
  promptVariant?: string;
};

export type GenerationSubmissionBody = {
  requestId: string;
  baseUrl: string;
  apiKey: string;
  clientId: string;
  trace?: GenerationClientTrace;
  request: GenerationRequestPayload;
};

export type ServerGenerationTask = {
  requestId: string;
  status: GenerationTaskStatus;
  model: string;
  protocol: ImageProtocol;
  prompt: string;
  negativePrompt?: string;
  createdAt: number;
  durationMs?: number;
  stages?: JobStages;
  lifecycleEvents?: GenerationLifecycleEvent[];
  sourceSurface?: GenerationSurface;
  idempotentReplayCount?: number;
  lastIdempotentReplayAt?: number;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  agentId?: string;
  agentName?: string;
  agentScenario?: string;
  promptVariant?: string;
  params?: {
    aspectRatio?: string;
    size?: string;
    resolution?: string;
    quality?: string;
    outputFormat?: string;
    seed?: string;
  };
  errorMessage?: string;
  errorType?: string;
  images?: Array<{ url: string; thumbUrl?: string; bytes?: number }>;
};

export type TasksResponse = {
  ok: boolean;
  tasks?: ServerGenerationTask[];
  serverTime?: number;
  error?: string;
};

// 工作台 → 画布的跨页导入载荷（roadmap PRD N2）。
// imageUrl 是当前会话的 objectUrl，只在同一次页面生命周期内有效——够用，
// 因为载荷只活在「点击按钮 → 画布挂载消费」这几百毫秒里，不做持久化。
export type CanvasImportPayload = {
  imageUrl: string;
  prompt: string;
  model: string;
  protocol: ImageProtocol;
  params: ImageParams;
  requestId?: string;
};

export type ModelLoadState = {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
};

export type GenerateProxyResponse = {
  ok: boolean;
  requestId?: string;
  status?: number | GenerationTaskStatus;
  images?: Array<{ dataUrl?: string; url?: string; revisedPrompt?: string }>;
  detail?: unknown;
  raw?: unknown;
  stages?: JobStages;
  idempotent?: boolean;
};

export type StyleEnhancement = {
  name: string;
  description: string;
  promptFragment: string;
};

export type PromptVariant = "stable" | "creative" | "commercial";

export type AgentField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "select";
  placeholder?: string;
  options?: string[];
  defaultValue?: string;
  required?: boolean;
};

export type IndustryAgent = {
  id: string;
  name: string;
  tag: string;
  icon: string;
  scenario: string;
  description: string;
  recommendedRatio: string;
  defaultCount: number;
  defaultQuality: string;
  defaultSubject: string;
  defaultGoal: string;
  defaultScene: string;
  defaultAudience: string;
  clickHint: string;
  emptyStateHint: string;
  defaultValues: Record<string, string>;
  promptBlueprint: string;
  negativePrompt: string;
  fields: AgentField[];
  supplements: string[];
  promptStructures: Record<PromptVariant, string>;
  qualityChecklist: string[];
};

export type SquareFeedItem = {
  id: string;
  requestId?: string;
  thumbnailUrl: string;
  prompt: string;
  caption: string;
  model: string;
  params: Partial<ImageParams> & Record<string, unknown>;
  promptHidden?: boolean;
  width?: number;
  height?: number;
  aspectRatio?: string;
  sourceType: string;
  reasonPlan?: unknown;
  recommenderLabel: string;
  pageLabel?: string;
  likeCount: number;
  createdAt: number;
  updatedAt: number;
  rankScore: number;
  likedByRequester?: boolean;
};

export type SquareRecommendResponse = {
  ok: boolean;
  status?: string;
  action?: "added" | "replaced" | "rejected";
  item?: SquareFeedItem;
  remainingDailyQuota?: number;
  remainingShelfSlots?: number;
  replacedItemId?: string;
  reasonCode?: string;
  error?: string;
};

export type Recipe = {
  id: string;
  name: string;
  prompt: string;
  model: string;
  params: ImageParams;
  createdAt: number;
};

export type ReferenceLibraryItem = {
  id: string;
  name: string;
  blob: Blob;
  mime: string;
  bytes: number;
  createdAt: number;
};
