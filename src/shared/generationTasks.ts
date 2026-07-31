import type {
  GenerateProxyResponse,
  GenerationClientEventPayload,
  GenerationClientLifecyclePhase,
  GenerationSubmissionBody,
  GenerationTaskStatus,
  JobStages,
  ServerGenerationTask,
  TasksResponse,
} from "./types";
import { readApiJson } from "./utils";

const GENERATE_ENDPOINT = "/api/images/generate";
const TASKS_ENDPOINT = "/api/tasks";
const CLIENT_EVENTS_ENDPOINT = "/api/generation-events";
const RECONCILE_DELAYS_MS = [0, 450, 1_200] as const;

export type GenerationSubmissionResult = {
  requestId: string;
  status: GenerationTaskStatus;
  stages?: JobStages;
  idempotent?: boolean;
  task?: ServerGenerationTask;
};

export class GenerationSubmissionError extends Error {
  readonly requestId: string;
  readonly ambiguous: boolean;
  readonly detail: unknown;

  constructor(
    message: string,
    options: { requestId: string; ambiguous: boolean; detail?: unknown },
  ) {
    super(message);
    this.name = "GenerationSubmissionError";
    this.requestId = options.requestId;
    this.ambiguous = options.ambiguous;
    this.detail = options.detail ?? { error: message };
  }
}

class AmbiguousTransportError extends Error {
  readonly detail: unknown;

  constructor(message: string, detail: unknown) {
    super(message);
    this.name = "AmbiguousTransportError";
    this.detail = detail;
  }
}

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function detailMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const value = detail as Record<string, unknown>;
    if (typeof value.error === "string" && value.error.trim()) return value.error;
    if (value.detail) return detailMessage(value.detail, fallback);
  }
  return fallback;
}

function normalizedTaskStatus(value: unknown): GenerationTaskStatus {
  return value === "submitting" || value === "running" || value === "success" || value === "error"
    ? value
    : "queued";
}

/**
 * 客户端链路日志是诊断旁路，任何上报失败都不能影响真实生成。
 * keepalive 让用户刚点击后立即切页/关页时，浏览器仍有机会把“已点击”事件发完。
 */
export async function reportGenerationClientEvent(
  event: GenerationClientEventPayload,
): Promise<void> {
  try {
    await fetch(CLIENT_EVENTS_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": event.requestId,
        "X-ImageHub-Client-ID": event.clientId,
      },
      body: JSON.stringify({
        ...event,
        occurredAt: event.occurredAt ?? Date.now(),
      }),
    });
  } catch {
    // 诊断旁路不可反向拖垮提交流程；主 POST 仍会携带 trace 作为兜底。
  }
}

function submissionEventContext(body: GenerationSubmissionBody): GenerationClientEventPayload["context"] {
  const request = body.request;
  return {
    protocol: request.protocol,
    model: request.model,
    prompt: request.prompt,
    baseUrl: body.baseUrl,
    batchId: request.batchId,
    batchIndex: request.index,
    batchTotal: request.total,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    size: request.size,
    referenceCount: request.referenceImages?.length || 0,
  };
}

function emitSubmissionEvent(
  body: GenerationSubmissionBody,
  phase: GenerationClientLifecyclePhase,
  options: { occurredAt?: number; detail?: string } = {},
) {
  void reportGenerationClientEvent({
    requestId: body.requestId,
    clientId: body.clientId,
    phase,
    occurredAt: options.occurredAt,
    surface: body.trace?.surface,
    localRecordId: body.trace?.localRecordId,
    detail: options.detail,
    context: submissionEventContext(body),
  });
}

export async function fetchGenerationTasks(options: {
  clientId: string;
  ids?: string[];
  since?: number;
}): Promise<ServerGenerationTask[]> {
  const query = new URLSearchParams({ clientId: options.clientId });
  if (options.ids?.length) query.set("ids", options.ids.join(","));
  if (typeof options.since === "number") query.set("since", String(options.since));
  const response = await fetch(`${TASKS_ENDPOINT}?${query.toString()}`, {
    headers: { "X-ImageHub-Client-ID": options.clientId },
  });
  const payload = await readApiJson<TasksResponse>(response, TASKS_ENDPOINT);
  if (!response.ok || !payload.ok) {
    throw new Error(detailMessage(payload.error || payload, `任务查询失败（HTTP ${response.status}）`));
  }
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

async function findGenerationTask(
  clientId: string,
  requestId: string,
): Promise<ServerGenerationTask | undefined> {
  const tasks = await fetchGenerationTasks({ clientId, ids: [requestId] });
  return tasks.find((task) => task.requestId === requestId);
}

async function reconcileSeveralTimes(
  body: GenerationSubmissionBody,
): Promise<ServerGenerationTask | undefined> {
  emitSubmissionEvent(body, "client_reconcile_started");
  for (const waitMs of RECONCILE_DELAYS_MS) {
    await delay(waitMs);
    try {
      const task = await findGenerationTask(body.clientId, body.requestId);
      if (task) {
        emitSubmissionEvent(body, "client_reconcile_found", {
          detail: `已找到服务端任务，状态：${task.status}`,
        });
        return task;
      }
    } catch {
      // 对账接口也可能短暂不可达；下一轮继续，最终保留“状态确认中”。
    }
  }
  emitSubmissionEvent(body, "client_reconcile_miss", {
    detail: "连续三次未查到服务端任务",
  });
  return undefined;
}

async function postGeneration(body: GenerationSubmissionBody): Promise<GenerationSubmissionResult> {
  let response: Response;
  try {
    response = await fetch(GENERATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": body.requestId,
        "X-ImageHub-Client-ID": body.clientId,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AmbiguousTransportError(message || "网络连接中断", {
      error: message || "网络连接中断",
      endpoint: GENERATE_ENDPOINT,
    });
  }

  let payload: GenerateProxyResponse;
  try {
    payload = await readApiJson<GenerateProxyResponse>(response, GENERATE_ENDPOINT);
  } catch (error) {
    // 收到了网关/浏览器错误但拿不到可判定的应用层 JSON，服务端是否受理仍是未知状态。
    throw new AmbiguousTransportError("无法确认服务端是否已接单", error);
  }

  if (!response.ok || !payload.ok) {
    const rawDetail = payload.detail ?? payload;
    const detail = rawDetail && typeof rawDetail === "object"
      ? { ...rawDetail as Record<string, unknown>, status: response.status }
      : { error: rawDetail, status: response.status };
    emitSubmissionEvent(body, "client_submission_rejected", {
      detail: detailMessage(detail, `HTTP ${response.status}`),
    });
    throw new GenerationSubmissionError(
      detailMessage(detail, `生成请求失败（HTTP ${response.status}）`),
      { requestId: body.requestId, ambiguous: false, detail },
    );
  }

  const result = {
    requestId: payload.requestId || body.requestId,
    status: normalizedTaskStatus(payload.status),
    stages: payload.stages,
    idempotent: payload.idempotent,
  };
  emitSubmissionEvent(body, "client_accepted", {
    detail: payload.idempotent ? `幂等接管已有任务，状态：${result.status}` : `服务端已接单，状态：${result.status}`,
  });
  return result;
}

/**
 * 提交一个预先分配 ID 的生成任务。
 *
 * 只有应用层明确拒绝才会立即失败。连接断开或响应不可解析时，先用 requestId 对账三次；
 * 仍查不到才用完全相同的 requestId 重投一次，从而把“是否已接单”的模糊状态收敛掉。
 */
export async function submitGenerationTask(
  body: GenerationSubmissionBody,
): Promise<GenerationSubmissionResult> {
  const requestStartedAt = body.trace?.requestStartedAt ?? Date.now();
  const tracedBody: GenerationSubmissionBody = body.trace
    ? { ...body, trace: { ...body.trace, requestStartedAt } }
    : body;
  emitSubmissionEvent(tracedBody, "client_request_started", { occurredAt: requestStartedAt });
  try {
    return await postGeneration(tracedBody);
  } catch (error) {
    if (!(error instanceof AmbiguousTransportError)) throw error;
    emitSubmissionEvent(tracedBody, "client_transport_ambiguous", {
      detail: error.message || "POST 响应无法确认",
    });

    const reconciled = await reconcileSeveralTimes(tracedBody);
    if (reconciled) {
      return {
        requestId: reconciled.requestId,
        status: reconciled.status,
        stages: reconciled.stages,
        idempotent: true,
        task: reconciled,
      };
    }

    try {
      emitSubmissionEvent(tracedBody, "client_idempotent_retry", {
        detail: "使用同一 requestId 幂等重投",
      });
      return await postGeneration(tracedBody);
    } catch (retryError) {
      if (!(retryError instanceof AmbiguousTransportError)) throw retryError;
      emitSubmissionEvent(tracedBody, "client_transport_ambiguous", {
        detail: "幂等重投后仍无法确认响应",
      });
      const retriedTask = await reconcileSeveralTimes(tracedBody);
      if (retriedTask) {
        return {
          requestId: retriedTask.requestId,
          status: retriedTask.status,
          stages: retriedTask.stages,
          idempotent: true,
          task: retriedTask,
        };
      }
      emitSubmissionEvent(tracedBody, "client_submission_unconfirmed", {
        detail: "重投与对账后仍无法确认，保留原 requestId",
      });
      throw new GenerationSubmissionError(
        "请求结果暂时无法确认，系统会继续使用同一 requestId 对账，不会自动创建第二个任务",
        {
          requestId: tracedBody.requestId,
          ambiguous: true,
          detail: {
            error: "提交状态确认中",
            requestId: tracedBody.requestId,
            firstError: error.detail,
            retryError: retryError.detail,
          },
        },
      );
    }
  }
}
