import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Dices,
  Download,
  DownloadCloud,
  ExternalLink,
  Group,
  ImagePlus,
  Loader2,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  RefreshCw,
  Redo2,
  Save,
  Send,
  StickyNote,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { API_KEY_MIN_LENGTH, normalizeApiBaseUrl } from "../shared/appConfig";
import { CANVAS_IMAGES_STORE, listRecipes, openDb, saveRecipe } from "../shared/db";
import { GenerationSubmissionError, fetchGenerationTasks, reportGenerationClientEvent, submitGenerationTask } from "../shared/generationTasks";
import {
  LIST_THUMB_MAX_EDGE,
  blobToDataUrl,
  createListThumbnail,
  createSquareThumbnail,
  generatedImageToBlob,
  getImageSize,
} from "../shared/imageUtils";
import {
  DEFAULT_IMAGE_RESOLUTION,
  explicitSizeOptionsForModel,
  getSupportedAspectRatios,
  gptImage2SizeOptionForSize,
  imageModelLaneLabel,
  isGptImage2ProModel,
  resolveRequestSize,
  usesOfficialGptImageSizing,
} from "../shared/modelSizing";
import type {
  ApiConfig,
  CanvasImportPayload,
  GenerationSubmissionBody,
  ImageParams,
  ImageResolution,
  ModelLoadState,
  Recipe,
  SquareRecommendResponse,
  SubmittedReference,
} from "../shared/types";
import { clampNumber, formatBytes, getClientId, readApiJson, uid } from "../shared/utils";
import { CanvasNodeView, type CanvasNodeHandlers } from "./CanvasNodeView";
import {
  canvasThumbKey,
  deleteCanvasImageFromDB,
  loadCanvasImageFromDB,
  loadCanvasStateFromDB,
  saveCanvasImageToDB,
  saveCanvasStateToDB,
} from "./canvasDb";
import {
  CANVAS_DEFAULT_NODE_WIDTH,
  CANVAS_SAVE_DEBOUNCE_MS,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasNode,
  type CanvasPanelMode,
  type CanvasPersistedState,
  type CanvasViewport,
} from "./types";

// ══════════════════════════════════════
// Canvas Page Component
// ══════════════════════════════════════

// 画布里抛出来的既可能是 Error，也可能是服务端 JSON（如 /api/square/recommend 直接 throw payload）
function canvasErrorText(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message || fallback;
  if (error && typeof error === "object") {
    const detail = error as { error?: unknown; message?: unknown };
    if (typeof detail.error === "string" && detail.error) return detail.error;
    if (typeof detail.message === "string" && detail.message) return detail.message;
  }
  return fallback;
}

// 快照导出里给便签文字断行：按字符宽度硬折，中英文混排都能用
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  let line = "";
  let cursorY = y;
  for (const char of text) {
    if (char === "\n") {
      ctx.fillText(line, x, cursorY);
      line = "";
      cursorY += lineHeight;
      continue;
    }
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      line = char;
      cursorY += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, cursorY);
}

export function CanvasPage({
  apiConfig,
  selectedModel: globalSelectedModel,
  selectableModels,
  modelState,
  onBackHome,
  onEnterStudio,
  onEnterSquare,
  runningCount,
  pendingImport,
  onImportConsumed,
  onSendToStudio,
  hidePromptOnShare,
}: {
  apiConfig: ApiConfig;
  selectedModel: string;
  selectableModels: string[];
  modelState: ModelLoadState;
  onBackHome: () => void;
  onEnterStudio: () => void;
  onEnterSquare: () => void;
  runningCount: number;
  pendingImport: CanvasImportPayload | null;
  onImportConsumed: () => void;
  onSendToStudio: (payload: { prompt: string; model: string; params: ImageParams }) => void;
  hidePromptOnShare: boolean;
}) {
  // ── State ──
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([]);
  const [canvasGroups, setCanvasGroups] = useState<CanvasGroup[]>([]);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<CanvasPanelMode>("generate");
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [canvasPrompt, setCanvasPrompt] = useState("");
  const [canvasModel, setCanvasModel] = useState(() => globalSelectedModel || selectableModels[0] || "");
  const [canvasAspectRatio, setCanvasAspectRatio] = useState("1:1");
  const [canvasResolution, setCanvasResolution] = useState<ImageResolution>("1K");
  const [canvasSize, setCanvasSize] = useState("");
  const [canvasQuality, setCanvasQuality] = useState("auto");
  const [isGenerating, setIsGenerating] = useState(false);
  // 画布并发上限 6。异步化后 fetch 是毫秒级返回的，用「在途请求数」计数已无意义——
  // 改为统计**未完成节点数**（generating），这才是用户理解的「同时在生成几张」。
  const CANVAS_MAX_CONCURRENCY = 6;
  const canvasRunning = canvasNodes.filter((n) => n.status === "generating").length;
  const canvasRunningRef = useRef(0);
  canvasRunningRef.current = canvasRunning;
  const canvasAtCapacity = canvasRunning >= CANVAS_MAX_CONCURRENCY;
  const bumpRunning = (_delta: number) => { /* 保留调用点，计数已改为派生自节点状态 */ };
  const [optimizeSourceNode, setOptimizeSourceNode] = useState<CanvasNode | null>(null);
  const [optimizePrompt, setOptimizePrompt] = useState("");
  // 扇形变体数量（roadmap PRD D2）：一次优化派生 1–4 个分支，会话内记住上次选择
  const [optimizeCount, setOptimizeCount] = useState(1);
  // 追加参考图（roadmap PRD D6）：源图之外最多再选 2 张画布节点做风格融合
  const [extraRefs, setExtraRefs] = useState<Array<{ nodeId: string; prompt: string; dataUrl: string; size: number }>>([]);
  // 配方快照（roadmap PRD B2）：与 Studio 共用同一 IndexedDB store
  const [canvasRecipes, setCanvasRecipes] = useState<Recipe[]>([]);
  useEffect(() => {
    void listRecipes().then(setCanvasRecipes).catch(() => undefined);
  }, []);
  // 内联生成模块：右键「在此生成」的原地输入窗口，坐标为画布世界坐标。
  // 可拖动（头部）、可右键删除、可引用画布上的图片节点作为参考图（有序）。
  const [inlineComposer, setInlineComposer] = useState<{ x: number; y: number } | null>(null);
  const [inlinePrompt, setInlinePrompt] = useState("");
  // 引用的参考图节点 id，数组顺序 = 提交时 referenceImages 的顺序
  const [inlineRefs, setInlineRefs] = useState<string[]>([]);
  // 模块自身的右键菜单（固定屏幕坐标）
  const [composerMenu, setComposerMenu] = useState<{ x: number; y: number } | null>(null);
  const inlinePromptRef = useRef<HTMLTextAreaElement | null>(null);
  const inlineComposerRef = useRef(inlineComposer);
  inlineComposerRef.current = inlineComposer;
  useEffect(() => {
    if (inlineComposer) inlinePromptRef.current?.focus();
  }, [inlineComposer]);

  function closeInlineComposer() {
    setInlineComposer(null);
    setInlinePrompt("");
    setInlineRefs([]);
    setComposerMenu(null);
  }

  // 拖动模块：头部按下后跟随指针（屏幕位移 ÷ zoom = 世界位移）
  function startComposerDrag(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const origin = inlineComposerRef.current;
    if (!origin) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const zoom = viewportRef.current.zoom;
      setInlineComposer({
        x: origin.x + (ev.clientX - startX) / zoom,
        y: origin.y + (ev.clientY - startY) / zoom,
      });
    };
    const onUp = () => window.removeEventListener("pointermove", onMove);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  // 把画布上的成功图片节点（含粘贴进来的外部图）加入模块参考列表
  function addNodeToInlineRefs(node: CanvasNode) {
    if (node.type !== "image" || node.status !== "success") return;
    if (inlineRefs.includes(node.id)) { showToast("这张图已在参考列表里"); return; }
    if (inlineRefs.length >= 4) { showToast("最多引用 4 张参考图"); return; }
    setInlineRefs((prev) => [...prev, node.id]);
    showToast(`已引用为第 ${inlineRefs.length + 1} 张参考图`);
  }

  function moveInlineRef(nodeId: string, dir: -1 | 1) {
    setInlineRefs((prev) => {
      const i = prev.indexOf(nodeId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function submitInlineComposer() {
    if (!inlineComposer) return;
    const value = inlinePrompt.trim();
    if (!value) return;
    const at = inlineComposer;
    // 只保留仍然存在的节点，顺序保持用户排定的顺序
    const refNodeIds = inlineRefs.filter((id) =>
      nodesRef.current.some((n) => n.id === id && n.type === "image" && n.status === "success"));
    closeInlineComposer();
    void handleCanvasGenerate({ at, promptOverride: value, refNodeIds });
  }

  // ── 派生把手（roadmap PRD D1）：从节点右缘拖出，松手在落点建优化子节点 ──
  const [deriveDrag, setDeriveDrag] = useState<{ fromId: string; x0: number; y0: number; x1: number; y1: number } | null>(null);
  // 双图对比（roadmap PRD D4）：恰好双选成功图片时可打开 A/B 滑块对比
  const [comparePair, setComparePair] = useState<[string, string] | null>(null);
  // 松手落点：下一次 handleCanvasOptimize 用它作为子节点位置（用完即清）
  const optimizeAtRef = useRef<{ x: number; y: number } | null>(null);

  function startDeriveDrag(e: React.PointerEvent, node: CanvasNode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const toWorld = (clientX: number, clientY: number) => {
      const vp = viewportRef.current;
      return { x: (clientX - rect.left) / vp.zoom + vp.x, y: (clientY - rect.top) / vp.zoom + vp.y };
    };
    const start = { x: node.x + node.width, y: node.y + node.height / 2 };
    const initial = toWorld(e.clientX, e.clientY);
    setDeriveDrag({ fromId: node.id, x0: start.x, y0: start.y, x1: initial.x, y1: initial.y });
    const onMove = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      setDeriveDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      setDeriveDrag(null);
      const end = toWorld(ev.clientX, ev.clientY);
      // 位移太小视为误触；阈值取世界坐标 40（约小半个节点）
      if (Math.hypot(end.x - start.x, end.y - start.y) < 40) return;
      optimizeAtRef.current = end;
      void enterOptimizeMode(node);
      // 面板打开后聚焦补充词输入，一个手势直达「写补充词」
      window.setTimeout(() => optimizePromptRef.current?.focus(), 80);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }
  const [compressedRef, setCompressedRef] = useState<{ dataUrl: string; size: number } | null>(null);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [canvasLoaded, setCanvasLoaded] = useState(false);
  const [isMinimapVisible, setIsMinimapVisible] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number; canvasX?: number; canvasY?: number } | null>(null);
  const [originalPreview, setOriginalPreview] = useState<CanvasNode | null>(null);

  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const optimizePromptRef = useRef<HTMLTextAreaElement>(null);
  // ── 多选 ────────────────────────────────────────────────────
  // selectedNodeId 保留为「主选中」（右侧面板、优化模式都基于它），
  // selectedIds 是多选集合。单选时两者一致，避免把既有逻辑全改一遍。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const marqueeAdditiveRef = useRef(false);
  selectedIdsRef.current = selectedIds;

  const selectOnly = (id: string | null) => {
    setSelectedNodeId(id);
    setSelectedIds(id ? new Set([id]) : new Set());
  };
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelectedNodeId(next.size > 0 ? [...next][next.size - 1] : null);
      return next;
    });
  };

  // ── 撤销 / 重做 ──────────────────────────────────────────────
  // 采用 mark-based 批处理：在「一次用户交互开始之前」打点，
  // 交互过程中的所有中间状态（如拖拽的每一帧）合并成一条记录。
  // 注意：被撤销掉的节点其 objectUrl 不能立即 revoke、IndexedDB 里的图也不能立即删，
  // 否则 undo 回来就是一张空图。孤儿图片在画布卸载时统一清理。
  const CANVAS_HISTORY_LIMIT = 50;
  type CanvasSnapshot = { nodes: CanvasNode[]; edges: CanvasEdge[]; groups: CanvasGroup[] };
  const historyRef = useRef<{ past: CanvasSnapshot[]; future: CanvasSnapshot[] }>({ past: [], future: [] });
  const [historyVersion, setHistoryVersion] = useState(0);

  const markHistory = () => {
    const h = historyRef.current;
    h.past.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    if (h.past.length > CANVAS_HISTORY_LIMIT) h.past.shift();
    h.future = [];
    setHistoryVersion((v) => v + 1);
  };

  const applySnapshot = (snap: CanvasSnapshot) => {
    setCanvasNodes(snap.nodes);
    setCanvasEdges(snap.edges);
    setCanvasGroups(snap.groups);
    setSelectedNodeId((current) => (snap.nodes.some((n) => n.id === current) ? current : null));
  };

  const undo = () => {
    const h = historyRef.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    applySnapshot(prev);
    setHistoryVersion((v) => v + 1);
    showToast("已撤销");
  };

  const redo = () => {
    const h = historyRef.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    applySnapshot(next);
    setHistoryVersion((v) => v + 1);
    showToast("已重做");
  };

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  void historyVersion; // 仅用于在栈变化时触发重渲染，让按钮的可用态跟上

  const nodesRef = useRef(canvasNodes);
  nodesRef.current = canvasNodes;
  const selectedNodeIdRef = useRef<string | null>(null);
  selectedNodeIdRef.current = selectedNodeId;
  const edgesRef = useRef(canvasEdges);
  edgesRef.current = canvasEdges;
  const groupsRef = useRef(canvasGroups);
  groupsRef.current = canvasGroups;
  // 折叠隐藏的节点 id：事件回调（框选提交）里读不到 memo 的最新值，用 ref 兜住
  const collapsedNodeIdsRef = useRef<Set<string>>(new Set());
  const canvasLoadedRef = useRef(false);
  canvasLoadedRef.current = canvasLoaded;
  const panelModeRef = useRef<CanvasPanelMode>("generate");
  panelModeRef.current = panelMode;
  // 对账连续查无此任务的计数（键 = 节点 id）：达到阈值判死，防止节点永远转圈
  const taskMissCountsRef = useRef<Map<string, number>>(new Map());
  const viewportRef = useRef(viewport);
  const transformLayerRef = useRef<HTMLDivElement | null>(null);
  const viewportRafRef = useRef(0);
  const wheelCommitTimerRef = useRef(0);

  // 性能：平移/缩放手势期间直接写 DOM transform（零 React 重渲染），手势结束才提交 state
  const applyViewportToDom = () => {
    const vp = viewportRef.current;
    const layer = transformLayerRef.current;
    if (layer) {
      layer.style.transform = `translate(${-vp.x * vp.zoom}px, ${-vp.y * vp.zoom}px) scale(${vp.zoom})`;
    }
    const el = containerRef.current;
    if (el) {
      if (vp.zoom < 0.25) {
        el.style.backgroundImage = "none";
      } else {
        const spacing = vp.zoom < 0.5 ? 40 : 20;
        const rendered = spacing * vp.zoom;
        el.style.backgroundImage = `radial-gradient(circle, rgba(245, 244, 239, 0.2) ${Math.max(1, vp.zoom)}px, transparent ${Math.max(1, vp.zoom)}px)`;
        el.style.backgroundSize = `${rendered}px ${rendered}px`;
        el.style.backgroundPosition = `${(-vp.x * vp.zoom) % rendered}px ${(-vp.y * vp.zoom) % rendered}px`;
      }
    }
    applyCulling();
  };

  // 视口裁剪：视口外的节点只 display:none，**保留在 DOM 中**。
  // 卸载会让图片重新解码、objectUrl 重绑，滚回来会闪白；置 display 则是纯样式操作。
  // 直接改 DOM style 而不走 setState —— 平移每帧都会调用，走 React 会全量重渲染。
  const applyCulling = () => {
    const layer = transformLayerRef.current;
    const el = containerRef.current;
    if (!layer || !el) return;
    const vp = viewportRef.current;
    const rect = el.getBoundingClientRect();
    // 容器还没量出尺寸（首帧布局前、或页面处于隐藏标签页）时可视矩形会退化成一个点，
    // 照它裁会把整块画布判成不可见——而裁剪只在平移/缩放/节点变化时重算，
    // 于是节点会一直隐身到用户手动拖一下画布为止。尺寸为 0 直接跳过，交给 ResizeObserver 补算。
    if (rect.width === 0 || rect.height === 0) return;
    // 画布坐标系下的可视矩形，外扩一屏做缓冲，避免边缘频繁进出
    const padX = rect.width / vp.zoom;
    const padY = rect.height / vp.zoom;
    const minX = vp.x - padX * 0.5;
    const minY = vp.y - padY * 0.5;
    const maxX = vp.x + padX * 1.5;
    const maxY = vp.y + padY * 1.5;
    for (const node of nodesRef.current) {
      const dom = layer.querySelector<HTMLElement>(`.canvas-node[data-node-id="${node.id}"]`);
      if (!dom) continue;
      // 选中节点与生成中节点永不裁剪：否则拖出视口时选中框消失、看不到 loading
      const exempt = node.id === selectedNodeIdRef.current || node.status === "generating";
      const visible =
        exempt ||
        (node.x + node.width >= minX && node.x <= maxX && node.y + node.height >= minY && node.y <= maxY);
      const next = visible ? "" : "none";
      if (dom.style.display !== next) dom.style.display = next;
    }
  };
  // 任务对账：页面关闭时仍在 generating 的节点，用 requestId 去服务端查真实结果。
  // 服务端不会因为客户端断开而中止，图往往已经生成好并落盘了——这里把它找回来。
  useEffect(() => {
    if (!canvasLoaded) return;
    let cancelled = false;
    let timer = 0;

    const reconcile = async () => {
      const pending = nodesRef.current.filter((n) => n.status === "generating" && n.requestId);
      if (pending.length === 0) return;
      try {
        const ids = pending.flatMap((node) => node.requestId ? [node.requestId] : []);
        const tasks = await fetchGenerationTasks({ clientId: getClientId(), ids });
        if (cancelled) return;
        const byId = new Map(tasks.map((task) => [task.requestId, task]));

        for (const node of pending) {
          const task = byId.get(node.requestId as string);
          if (!task) {
            // 服务端查无此任务：给 2 分钟宽限（POST 可能尚未落库、网络抖动），
            // 之后判死——否则这个节点会永远转圈（PRD A6 兜底）。
            const misses = (taskMissCountsRef.current.get(node.id) || 0) + 1;
            taskMissCountsRef.current.set(node.id, misses);
            if (misses >= 24) {
              taskMissCountsRef.current.delete(node.id);
              const missingAt = Date.now();
              setCanvasNodes((prev) => prev.map((n) => n.id === node.id
                ? { ...n, status: "error" as const, error: "任务已丢失（服务端无此记录），可重试" } : n));
              void reportGenerationClientEvent({
                requestId: node.requestId as string,
                clientId: getClientId(),
                phase: "client_error_received",
                occurredAt: missingAt,
                surface: "canvas",
                localRecordId: node.id,
                detail: "连续对账未找到服务端任务，画布已显示可重试",
              });
            }
            continue;
          }
          taskMissCountsRef.current.delete(node.id);
          // 同步 stages，让节点上的文案能区分「排队中 / 生成中」
          if (task.status === "queued" || task.status === "running") {
            setCanvasNodes((prev) => prev.map((n) =>
              n.id === node.id ? { ...n, stages: task.stages, submissionState: undefined } : n));
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
              await saveCanvasImageToDB(node.id, blob);
              if (thumb) await saveCanvasImageToDB(canvasThumbKey(node.id), thumb.blob);
              if (thumb && node.requestId) {
                void blobToDataUrl(thumb.blob)
                  .then((thumbnailDataUrl) => fetch("/api/images/thumb", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ requestId: node.requestId, index: 0, thumbnailDataUrl, clientId: getClientId() }),
                  }))
                  .catch(() => undefined);
              }
              if (cancelled) return;
              const adjustedH = Math.round(node.width * (height / width));
              // 耗时来自服务端 stages（receivedAt→imageSavedAt），异步化后客户端计时没有意义
              const doneAt = task.stages?.imageSavedAt || task.stages?.upstreamRespondedAt;
              const durationMs = task.stages?.receivedAt && doneAt
                ? Math.max(0, doneAt - task.stages.receivedAt)
                : Date.now() - node.createdAt;
              const finishedNode: CanvasNode = {
                ...node, status: "success" as const, objectUrl, thumbUrl,
                height: adjustedH, imageWidth: width, imageHeight: height,
                duration: durationMs, stages: task.stages, submissionState: undefined,
              };
              setCanvasNodes((prev) => prev.map((n) => (n.id === node.id ? finishedNode : n)));
              void reportGenerationClientEvent({
                requestId: node.requestId as string,
                clientId: getClientId(),
                phase: "client_result_received",
                occurredAt: Date.now(),
                surface: "canvas",
                localRecordId: node.id,
                detail: "画布已取回图片、完成解码并写入 IndexedDB",
              });
              // 链式迭代（PRD §4.2.8）：优化面板开着且这就是当前选中的节点
              // → 源图自动切到刚生成的新图，用户填下一句补充词即可继续
              if (panelModeRef.current === "optimize" && selectedNodeIdRef.current === node.id) {
                void enterOptimizeMode(finishedNode);
              }
            } catch {
              // 图取不回来（比如已被日志裁剪清理）才判失败
              const imageMissingAt = Date.now();
              setCanvasNodes((prev) => prev.map((n) => n.id === node.id
                ? { ...n, status: "error" as const, error: "图片已被服务器清理" } : n));
              void reportGenerationClientEvent({
                requestId: node.requestId as string,
                clientId: getClientId(),
                phase: "client_error_received",
                occurredAt: imageMissingAt,
                surface: "canvas",
                localRecordId: node.id,
                detail: "服务端任务成功，但画布无法取回图片文件",
              });
            }
          } else if (task.status === "error") {
            const errorReceivedAt = Date.now();
            setCanvasNodes((prev) => prev.map((n) => n.id === node.id
              ? {
                  ...n,
                  status: "error" as const,
                  error: task.errorMessage || "生成失败",
                  submissionState: undefined,
                }
              : n));
            void reportGenerationClientEvent({
              requestId: node.requestId as string,
              clientId: getClientId(),
              phase: "client_error_received",
              occurredAt: errorReceivedAt,
              surface: "canvas",
              localRecordId: node.id,
              detail: task.errorMessage || "画布已收到服务端失败结果",
            });
          }
          // status 仍是 running：什么都不做，下一轮继续查
        }
      } catch {
        // 对账失败不影响画布使用，下一轮重试
      }
    };

    void reconcile();
    timer = window.setInterval(() => { void reconcile(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasLoaded]);

  // 节点增删或选中变化后重算一次裁剪：新节点的 DOM 刚挂上，需要初始判定
  useEffect(() => {
    applyCulling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasNodes, selectedNodeId]);

  // 容器尺寸变化后重算裁剪：首帧量到 0、窗口缩放、右侧面板折叠都会改变可视矩形，
  // 而这些都不经过 viewport / nodes 的 setState，没有这个观察者就只能等用户拖一下画布。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { applyCulling(); });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleViewportPaint = () => {
    if (viewportRafRef.current) return;
    viewportRafRef.current = requestAnimationFrame(() => {
      viewportRafRef.current = 0;
      applyViewportToDom();
    });
  };

  // 新节点若落在视口外，把视口平移过去（PRD §4.1.5/§4.2.7）。
  // 复用手势的「ref + applyViewportToDom 直写、结束才 setState」模式，动画期间零重渲染。
  const ensureRectVisible = (x: number, y: number, w: number, h: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const vp = viewportRef.current;
    const viewW = rect.width / vp.zoom;
    const viewH = rect.height / vp.zoom;
    const margin = 24 / vp.zoom;
    if (
      x - margin >= vp.x && y - margin >= vp.y &&
      x + w + margin <= vp.x + viewW && y + h + margin <= vp.y + viewH
    ) {
      return; // 已完整可见
    }
    const targetX = x + w / 2 - viewW / 2;
    const targetY = y + h / 2 - viewH / 2;
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      viewportRef.current = { x: targetX, y: targetY, zoom: vp.zoom };
      applyViewportToDom();
      setViewport(viewportRef.current);
      return;
    }
    const startX = vp.x;
    const startY = vp.y;
    const startAt = performance.now();
    const durMs = 300;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - startAt) / durMs);
      const k = ease(t);
      viewportRef.current = {
        x: startX + (targetX - startX) * k,
        y: startY + (targetY - startY) * k,
        zoom: vp.zoom,
      };
      applyViewportToDom();
      if (t < 1) requestAnimationFrame(step);
      else setViewport(viewportRef.current); // 结束才提交 state，触发裁剪重算与持久化
    };
    requestAnimationFrame(step);
  };
  useEffect(() => {
    // 只有 state 提交时才同步 ref（避免手势中的后台重渲染把 ref 打回旧值）
    viewportRef.current = viewport;
    applyViewportToDom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  const isPanningRef = useRef(false);
  const isDraggingNodeRef = useRef(false);
  const panStartRef = useRef({ screenX: 0, screenY: 0, vpX: 0, vpY: 0 });
  // origins 记录按下瞬间「所有要移动的节点」的原坐标：多选时整个选区一起走。
  // 用「原点 + 总位移」而不是逐帧累加，避免缩放下的浮点漂移。
  const dragStartRef = useRef<{
    nodeId: string;
    screenX: number;
    screenY: number;
    origins: Map<string, { x: number; y: number }>;
  }>({ nodeId: "", screenX: 0, screenY: 0, origins: new Map() });
  // 节点事件经 ref 转发：memo 组件不因 handler 身份变化而重渲染，也不会捕获过期闭包
  const canvasNodeHandlersRef = useRef<CanvasNodeHandlers>({
    onNodePointerDown: () => {}, onNodeOptimize: () => {}, onNoteEdit: () => {}, onNoteChange: () => {},
    onDeriveStart: () => {},
  });
  canvasNodeHandlersRef.current = {
    onNodePointerDown: (e, node) => handleNodePointerDown(e, node),
    onNodeOptimize: (node) => void enterOptimizeMode(node),
    onNoteEdit: (nodeId) => {
      // 进入编辑前打点，这样一次编辑（含失焦）可以整体撤销
      if (nodeId) markHistory();
      setEditingNoteId(nodeId);
    },
    onNoteChange: (nodeId, text) => updateNoteText(nodeId, text),
    onDeriveStart: (e, node) => startDeriveDrag(e, node),
  };
  const saveTimerRef = useRef<number>(0);
  const toastTimerRef = useRef<number>(0);

  // ── Helper: aspect ratio to number ──
  function aspectRatioToNumber(ratio: string): number {
    const parts = ratio.split(":").map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
    return 1;
  }

  // ── Helper: show toast ──
  function showToast(message: string) {
    setToastMessage(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(""), 2000);
  }

  function canvasPersistedSnapshot(
    nodes = nodesRef.current,
    edges = edgesRef.current,
    groups = groupsRef.current,
  ): CanvasPersistedState {
    return {
      nodes: nodes.map(({ objectUrl: _objectUrl, thumbUrl: _thumbUrl, ...rest }) => rest),
      edges,
      groups,
      viewport: viewportRef.current,
      lastSavedAt: Date.now(),
    };
  }

  function reportCanvasSubmissionIntent(node: CanvasNode, occurredAt = node.createdAt) {
    if (!node.requestId || node.type !== "image") return;
    void reportGenerationClientEvent({
      requestId: node.requestId,
      clientId: getClientId(),
      phase: "client_submitted",
      occurredAt,
      surface: "canvas",
      localRecordId: node.id,
      detail: "用户在画布点击生成",
      context: {
        protocol: node.protocol,
        model: node.model,
        prompt: node.prompt,
        baseUrl: normalizeApiBaseUrl(apiConfig.baseUrl),
        aspectRatio: node.params.aspectRatio,
        resolution: node.params.resolution,
        size: node.params.size,
        referenceCount: node.refNodeIds?.length || (node.referenceNodeId ? 1 : 0),
      },
    });
  }

  async function persistPendingGraph(
    nodeIds: string[],
    nodes: CanvasNode[],
    edges: CanvasEdge[],
  ): Promise<number | null> {
    try {
      // 生成任务的 requestId 不能等 500ms 防抖：此写入完成后才允许发送 POST。
      await saveCanvasStateToDB(canvasPersistedSnapshot(nodes, edges));
      const persistedAt = Date.now();
      const persistedIds = new Set(nodeIds);
      for (const node of nodes) {
        if (!persistedIds.has(node.id) || !node.requestId) continue;
        void reportGenerationClientEvent({
          requestId: node.requestId,
          clientId: getClientId(),
          phase: "client_persisted",
          occurredAt: persistedAt,
          surface: "canvas",
          localRecordId: node.id,
          detail: "画布节点与 requestId 已写入 IndexedDB，允许发送 POST",
        });
      }
      return persistedAt;
    } catch {
      const failedIds = new Set(nodeIds);
      setCanvasNodes((prev) => prev.map((node) => failedIds.has(node.id)
        ? { ...node, status: "error" as const, error: "本地任务快照保存失败，已取消提交以避免任务丢失" }
        : node));
      showToast("本地快照保存失败，任务未发送");
      return null;
    }
  }

  async function submitCanvasNode(nodeId: string, body: GenerationSubmissionBody) {
    try {
      const submission = await submitGenerationTask(body);
      setCanvasNodes((prev) => prev.map((node) => node.id === nodeId
        ? {
            ...node,
            requestId: submission.requestId || node.requestId,
            stages: submission.stages,
            submissionState: undefined,
          }
        : node));
    } catch (error) {
      if (error instanceof GenerationSubmissionError && error.ambiguous) {
        setCanvasNodes((prev) => prev.map((node) => node.id === nodeId
          ? { ...node, submissionState: "confirming" as const }
          : node));
        return;
      }
      const message = error instanceof GenerationSubmissionError
        ? error.message
        : canvasErrorText(error, "生成失败");
      setCanvasNodes((prev) => prev.map((node) => node.id === nodeId
        ? { ...node, status: "error" as const, error: message, submissionState: undefined }
        : node));
    }
  }

  // ── Helper: debounced save ──
  function scheduleSave() {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveCanvasStateToDB(canvasPersistedSnapshot());
    }, CANVAS_SAVE_DEBOUNCE_MS);
  }

  // ── Load canvas state from IndexedDB on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadCanvasStateFromDB();
        if (cancelled || !saved) { setCanvasLoaded(true); return; }
        const loadedNodes: CanvasNode[] = [];
        for (const node of saved.nodes) {
          if (cancelled) break;
          if (node.type === "note") {
            // 便签没有图片，直接放回
            loadedNodes.push(node);
          } else if (node.status === "success") {
            const blob = await loadCanvasImageFromDB(node.id);
            if (blob) {
              const thumbBlob = await loadCanvasImageFromDB(canvasThumbKey(node.id));
              loadedNodes.push({
                ...node,
                objectUrl: URL.createObjectURL(blob),
                thumbUrl: thumbBlob ? URL.createObjectURL(thumbBlob) : undefined,
              });
            } else {
              loadedNodes.push({ ...node, status: "error", error: "图片数据丢失" });
            }
          } else if (node.status === "generating") {
            // Was generating when page closed - mark as error
            // 不再直接判死：服务端不会因为页面关闭而中止，图很可能已经生成好了。
            // 保持 generating，由对账 effect 用 requestId 去 /api/tasks 查真实结果。
            loadedNodes.push(node.requestId
              ? { ...node, status: "generating" as const }
              : { ...node, status: "error" as const, error: "生成中断（页面关闭）" });
          } else {
            loadedNodes.push(node);
          }
        }
        if (cancelled) {
          // 中途离开画布：已建好的 objectUrl / thumbUrl 不会进入 state，必须就地回收
          loadedNodes.forEach((n) => {
            if (n.objectUrl) URL.revokeObjectURL(n.objectUrl);
            if (n.thumbUrl) URL.revokeObjectURL(n.thumbUrl);
          });
          return;
        }
        setCanvasNodes(loadedNodes);
        setCanvasEdges(saved.edges || []);
        // 分组里可能残留已被删除的节点 id（老数据 / 异常退出），读回来时清一遍，
        // 空分组直接丢掉，避免画布上出现一个框不住任何东西的空壳
        {
          const liveIds = new Set(loadedNodes.map((n) => n.id));
          const groups = (saved.groups || [])
            .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => liveIds.has(id)) }))
            .filter((g) => g.nodeIds.length > 0);
          setCanvasGroups(groups);
        }
        setViewport(saved.viewport || { x: 0, y: 0, zoom: 1 });
        setCanvasLoaded(true);
      } catch {
        if (!cancelled) setCanvasLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Cleanup objectUrls on unmount ──
  useEffect(() => {
    return () => {
      const live = new Set(nodesRef.current.map((n) => n.id));
      nodesRef.current.forEach((n) => {
        if (n.objectUrl) URL.revokeObjectURL(n.objectUrl);
        if (n.thumbUrl) URL.revokeObjectURL(n.thumbUrl);
      });
      // 被撤销/删除掉的节点，其图片留在 IndexedDB 里以支持 undo；
      // 离开画布时不再需要，统一回收。
      // 必须等首次加载完成才敢清：加载还没落地时 nodesRef 是空的，
      // 照它清会把整个画布的图删光（StrictMode 的即刻挂载-卸载就会踩到这条）。
      if (canvasLoadedRef.current) void cleanupOrphanImages(live);
    };
  }, []);

  // ── Save on beforeunload ──
  useEffect(() => {
    const handler = () => {
      void saveCanvasStateToDB(canvasPersistedSnapshot());
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── Auto-save when nodes/edges/groups change ──
  useEffect(() => {
    if (canvasLoaded) scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasNodes, canvasEdges, canvasGroups, canvasLoaded]);

  // 视口也要落盘（PRD §7.2，防抖 1s）：SPA 内切页不触发 beforeunload，
  // 不存的话平移/缩放位置会在切到工作台再回来时丢失。
  useEffect(() => {
    if (!canvasLoaded) return;
    const timer = window.setTimeout(() => scheduleSave(), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, canvasLoaded]);

  // ── Zoom helpers ──
  function clampZoomVal(z: number) { return clampNumber(z, 0.1, 3); }

  function zoomAtPoint(screenX: number, screenY: number, newZoom: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vp = viewportRef.current;
    const canvasX = (screenX - rect.left) / vp.zoom + vp.x;
    const canvasY = (screenY - rect.top) / vp.zoom + vp.y;
    setViewport({
      x: canvasX - (screenX - rect.left) / newZoom,
      y: canvasY - (screenY - rect.top) / newZoom,
      zoom: newZoom,
    });
  }

  function zoomAtCenter(newZoom: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, newZoom);
  }

  function fitAllNodes() {
    if (canvasNodes.length === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    // 容器还没量出尺寸时 rect.width/cw 会算出 0 缩放，钳位后画布直接跳到 10%
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const pad = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of canvasNodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    }
    const cw = maxX - minX + pad * 2;
    const ch = maxY - minY + pad * 2;
    const zoom = clampZoomVal(Math.min(rect.width / cw, rect.height / ch));
    setViewport({
      x: minX - pad + (cw - rect.width / zoom) / 2,
      y: minY - pad + (ch - rect.height / zoom) / 2,
      zoom,
    });
  }

  // ── Viewport center in canvas coords ──
  function viewportCenter() {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const vp = viewportRef.current;
    return {
      x: vp.x + rect.width / (2 * vp.zoom),
      y: vp.y + rect.height / (2 * vp.zoom),
    };
  }

  // ── Find non-overlapping position ──
  function findNonOverlappingPos(cx: number, cy: number, w: number, h: number) {
    let x = cx - w / 2;
    const y = cy - h / 2;
    const overlaps = (nx: number, ny: number) =>
      nodesRef.current.some((n) =>
        nx < n.x + n.width + 20 && nx + w + 20 > n.x && ny < n.y + n.height + 20 && ny + h + 20 > n.y
      );
    let attempts = 0;
    while (overlaps(x, y) && attempts < 20) {
      x += w + 40;
      attempts++;
    }
    return { x, y };
  }

  // ── Pan & Zoom event handlers ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const vp = viewportRef.current;
      if (e.ctrlKey || e.metaKey) {
        // Zoom —— 手势期间只写 ref + rAF 直绘，停止 140ms 后提交 state
        const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
        const nz = clampZoomVal(vp.zoom * factor);
        const rect = el!.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / vp.zoom + vp.x;
        const cy = (e.clientY - rect.top) / vp.zoom + vp.y;
        viewportRef.current = {
          x: cx - (e.clientX - rect.left) / nz,
          y: cy - (e.clientY - rect.top) / nz,
          zoom: nz,
        };
      } else {
        // Pan
        viewportRef.current = {
          x: vp.x + e.deltaX / vp.zoom,
          y: vp.y + e.deltaY / vp.zoom,
          zoom: vp.zoom,
        };
      }
      scheduleViewportPaint();
      window.clearTimeout(wheelCommitTimerRef.current);
      wheelCommitTimerRef.current = window.setTimeout(() => {
        setViewport({ ...viewportRef.current });
      }, 140);
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Pointer events for panning and node dragging ──
  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget && !isSpaceHeld) return; // clicked on a child, not canvas background
    // 左键在空白处按下：开始框选（Shift 为加选，不清空原有选中）
    if (e.button === 0 && !isSpaceHeld) {
      if (!e.shiftKey) {
        selectOnly(null);
        if (panelMode === "optimize") {
          setPanelMode("generate");
          setOptimizeSourceNode(null);
          setCompressedRef(null);
        }
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const vp = viewportRef.current;
        const cx = (e.clientX - rect.left) / vp.zoom + vp.x;
        const cy = (e.clientY - rect.top) / vp.zoom + vp.y;
        marqueeAdditiveRef.current = e.shiftKey;
        setMarquee({ x0: cx, y0: cy, x1: cx, y1: cy });
      }
    }
    // Start pan
    if (e.button === 1 || e.button === 2 || (e.button === 0 && isSpaceHeld)) {
      e.preventDefault();
      isPanningRef.current = true;
      containerRef.current?.classList.add("is-panning");
      panStartRef.current = {
        screenX: e.clientX,
        screenY: e.clientY,
        vpX: viewportRef.current.x,
        vpY: viewportRef.current.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }

  function handleCanvasPointerMove(e: React.PointerEvent) {
    if (marquee) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const vp = viewportRef.current;
        setMarquee((m) => m ? {
          ...m,
          x1: (e.clientX - rect.left) / vp.zoom + vp.x,
          y1: (e.clientY - rect.top) / vp.zoom + vp.y,
        } : m);
      }
      return;
    }
    if (isDraggingNodeRef.current) {
      const ds = dragStartRef.current;
      const vp = viewportRef.current;
      const dx = (e.clientX - ds.screenX) / vp.zoom;
      const dy = (e.clientY - ds.screenY) / vp.zoom;
      setCanvasNodes((prev) => prev.map((n) => {
        const origin = ds.origins.get(n.id);
        return origin ? { ...n, x: origin.x + dx, y: origin.y + dy } : n;
      }));
      return;
    }
    if (isPanningRef.current) {
      const ps = panStartRef.current;
      const vp = viewportRef.current;
      viewportRef.current = {
        x: ps.vpX - (e.clientX - ps.screenX) / vp.zoom,
        y: ps.vpY - (e.clientY - ps.screenY) / vp.zoom,
        zoom: vp.zoom,
      };
      scheduleViewportPaint();
    }
  }

  function handleCanvasPointerUp() {
    if (marquee) {
      // 结算框选：与矩形相交的节点全部选中（相交而非包含，散落布局更好选）
      const minX = Math.min(marquee.x0, marquee.x1);
      const maxX = Math.max(marquee.x0, marquee.x1);
      const minY = Math.min(marquee.y0, marquee.y1);
      const maxY = Math.max(marquee.y0, marquee.y1);
      const dragged = Math.abs(maxX - minX) > 4 || Math.abs(maxY - minY) > 4;
      if (dragged) {
        // 折叠分组里的节点在画布上看不见，框选自然也不该选中它们
        const hidden = collapsedNodeIdsRef.current;
        const hit = nodesRef.current
          .filter((n) => !hidden.has(n.id)
            && n.x + n.width >= minX && n.x <= maxX && n.y + n.height >= minY && n.y <= maxY)
          .map((n) => n.id);
        setSelectedIds((prev) => {
          const next = marqueeAdditiveRef.current ? new Set(prev) : new Set<string>();
          hit.forEach((id) => next.add(id));
          setSelectedNodeId(next.size > 0 ? [...next][next.size - 1] : null);
          return next;
        });
      }
      setMarquee(null);
    }
    if (isDraggingNodeRef.current) {
      isDraggingNodeRef.current = false;
      scheduleSave();
    }
    if (isPanningRef.current) {
      isPanningRef.current = false;
      containerRef.current?.classList.remove("is-panning");
      // 手势结束提交 state，让 minimap/网格与 React 树同步
      setViewport({ ...viewportRef.current });
    }
  }

  function handleNodePointerDown(e: React.PointerEvent, node: CanvasNode) {
    if (isSpaceHeld || e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey) {
      toggleSelected(node.id);
      return; // Shift 点击只改选中，不进入拖拽
    }
    if (!selectedIdsRef.current.has(node.id)) selectOnly(node.id);
    else setSelectedNodeId(node.id);
    // Pin（roadmap PRD D5）：锁定的节点可选中但不可拖动
    if (node.pinned) return;
    // 拖拽前打点：整段拖拽合并成一条 undo 记录，而不是每帧一条
    markHistory();
    isDraggingNodeRef.current = true;
    // 命中已有多选时整块拖动，否则只拖这一个（与批量删除同口径）。
    // 这里必须读「上一帧」的 selectedIdsRef：上面的 selectOnly 要下一帧才生效，
    // 恰好等价于「按下前是否已在选区里」，正是想要的判断。
    const moving = selectedIdsRef.current.has(node.id) && selectedIdsRef.current.size > 1
      ? selectedIdsRef.current
      : new Set([node.id]);
    dragStartRef.current = {
      nodeId: node.id,
      screenX: e.clientX,
      screenY: e.clientY,
      origins: new Map(
        nodesRef.current
          // 多选整体拖动时锁定的成员留在原地
          .filter((n) => moving.has(n.id) && !n.pinned)
          .map((n) => [n.id, { x: n.x, y: n.y }]),
      ),
    };
  }

  // 拖分组标题栏 = 整组一起走，直接复用节点拖拽那套「原点 + 总位移」
  function handleGroupPointerDown(e: React.PointerEvent, group: CanvasGroup) {
    if (isSpaceHeld || e.button !== 0) return;
    e.stopPropagation();
    const members = nodesRef.current.filter((n) => group.nodeIds.includes(n.id));
    if (members.length === 0) return;
    setSelectedIds(new Set(group.nodeIds));
    setSelectedNodeId(group.nodeIds[group.nodeIds.length - 1]);
    markHistory();
    isDraggingNodeRef.current = true;
    dragStartRef.current = {
      nodeId: group.nodeIds[0],
      screenX: e.clientX,
      screenY: e.clientY,
      // 锁定的成员不随组移动（roadmap PRD D5）
      origins: new Map(members.filter((n) => !n.pinned).map((n) => [n.id, { x: n.x, y: n.y }])),
    };
  }

  // 追加参考图（roadmap PRD D6）：把另一个成功节点压缩后加入本轮优化的参考列表
  async function addNodeAsExtraRef(node: CanvasNode) {
    if (node.type !== "image" || node.status !== "success") return;
    if (extraRefs.length >= 2) { showToast("最多追加 2 张参考图"); return; }
    if (extraRefs.some((r) => r.nodeId === node.id) || optimizeSourceNode?.id === node.id) {
      showToast("这张图已在参考列表里");
      return;
    }
    try {
      const blob = await loadCanvasImageFromDB(node.id);
      if (!blob) { showToast("读不到该图，无法加为参考"); return; }
      const dataUrl = await blobToDataUrl(blob);
      const result = await createSquareThumbnail(dataUrl, 1024);
      const bytes = Math.round(result.dataUrl.length * 3 / 4);
      setExtraRefs((prev) => [...prev, { nodeId: node.id, prompt: node.prompt, dataUrl: result.dataUrl, size: bytes }]);
      showToast("已加入参考，本轮优化将融合这张图");
    } catch {
      showToast("参考图压缩失败");
    }
  }

  // Pin（roadmap PRD D5）：锁定/解锁节点位置
  function togglePinNode(node: CanvasNode) {
    markHistory();
    setCanvasNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, pinned: !n.pinned } : n)));
    showToast(node.pinned ? "已解除锁定" : "已锁定位置，拖拽将跳过该节点");
  }

  // 换种子（roadmap PRD D3）：同 prompt + 同参数重掷一次，产出该节点的同参变体子节点。
  // 不带参考图——变体来自同一配方而不是基于图片改图。
  async function rerollSeedFromNode(node: CanvasNode) {
    if (node.type !== "image" || node.status !== "success") return;
    if (canvasRunningRef.current >= CANVAS_MAX_CONCURRENCY) {
      showToast(`最多同时生成 ${CANVAS_MAX_CONCURRENCY} 张，请等待当前任务完成`);
      return;
    }
    const nodeW = node.width;
    const nodeH = node.height;
    // 变体放在源节点正下方，重叠时继续下移
    let newX = node.x;
    let newY = node.y + node.height + 40;
    let attempts = 0;
    while (
      nodesRef.current.some((n) =>
        newX < n.x + n.width + 20 && newX + nodeW + 20 > n.x &&
        newY < n.y + n.height + 20 && newY + nodeH + 20 > n.y
      ) && attempts < 20
    ) {
      newY += nodeH + 40;
      attempts++;
    }
    const nodeId = uid();
    const edgeId = uid();
    const plannedRequestId = uid();
    const newNode: CanvasNode = {
      ...node,
      id: nodeId,
      requestId: plannedRequestId,
      x: newX,
      y: newY,
      status: "generating",
      error: undefined,
      parentId: node.id,
      referenceNodeId: undefined,
      createdAt: Date.now(),
      duration: undefined,
      stages: undefined,
      objectUrl: undefined,
      thumbUrl: undefined,
      imageWidth: undefined,
      imageHeight: undefined,
      pinned: false,
    };
    const newEdge: CanvasEdge = { id: edgeId, fromNodeId: node.id, toNodeId: nodeId };
    const nextNodes = [...nodesRef.current, newNode];
    const nextEdges = [...edgesRef.current, newEdge];
    setCanvasNodes(nextNodes);
    setCanvasEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    selectOnly(nodeId);
    ensureRectVisible(newX, newY, nodeW, nodeH);
    reportCanvasSubmissionIntent(newNode);
    const persistedAt = await persistPendingGraph([nodeId], nextNodes, nextEdges);
    if (!persistedAt) return;
    await submitCanvasNode(nodeId, {
      baseUrl: normalizeApiBaseUrl(apiConfig.baseUrl),
      apiKey: apiConfig.apiKey,
      clientId: getClientId(),
      requestId: plannedRequestId,
      trace: {
        surface: "canvas",
        localRecordId: nodeId,
        submittedAt: newNode.createdAt,
        persistedAt,
      },
      request: {
        protocol: node.protocol,
        model: node.model,
        prompt: node.prompt,
        referenceImages: [],
        aspectRatio: node.params.aspectRatio,
        size: node.params.size,
        resolution: node.params.resolution,
        quality: node.params.quality,
        outputFormat: node.params.outputFormat,
        seed: "",
      },
    });
  }

  // ── 落图：拖拽文件 / 粘贴剪贴板 ──────────────────────────────
  // 落进来的图直接成为一个已完成节点，可作为后续优化的参考图起点。
  async function dropImageAsNode(file: File, at?: { x: number; y: number }) {
    if (!file.type.startsWith("image/")) return;
    const blob = file;
    const objectUrl = URL.createObjectURL(blob);
    const { width, height } = await getImageSize(objectUrl);
    const thumb = await createListThumbnail(blob);
    const thumbUrl = thumb ? URL.createObjectURL(thumb.blob) : undefined;
    const nodeW = CANVAS_DEFAULT_NODE_WIDTH;
    const nodeH = Math.round(nodeW * (height / width));
    const anchorPos = at ?? viewportCenter();
    const pos = findNonOverlappingPos(anchorPos.x, anchorPos.y, nodeW, nodeH);
    const nodeId = uid();
    markHistory();
    const node: CanvasNode = {
      id: nodeId,
      type: "image",
      x: pos.x,
      y: pos.y,
      width: nodeW,
      height: nodeH,
      prompt: file.name || "导入的图片",
      model: "imported",
      protocol: apiConfig.protocol,
      params: {
        aspectRatio: canvasAspectRatio, size: `${width}x${height}`, resolution: canvasResolution,
        quality: canvasQuality, outputFormat: "png", batchCount: 1, concurrency: 1,
        retryLimit: 0, seed: "", negativePrompt: "",
      },
      status: "success",
      createdAt: Date.now(),
      imageWidth: width,
      imageHeight: height,
      objectUrl,
      thumbUrl,
    };
    setCanvasNodes((prev) => [...prev, node]);
    await saveCanvasImageToDB(nodeId, blob);
    if (thumb) await saveCanvasImageToDB(canvasThumbKey(nodeId), thumb.blob);
    scheduleSave();
    showToast("已导入图片");
  }

  function handleCanvasDrop(e: React.DragEvent) {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const vp = viewportRef.current;
    const at = rect
      ? { x: (e.clientX - rect.left) / vp.zoom + vp.x, y: (e.clientY - rect.top) / vp.zoom + vp.y }
      : undefined;
    void (async () => { for (const f of files) await dropImageAsNode(f, at); })();
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return; // 输入框里的粘贴归输入框
      const items = [...(e.clipboardData?.items || [])];
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      void dropImageAsNode(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 工作台记录 → 画布节点（roadmap PRD N2）。加载完成后消费一次载荷：
  // 带完整 prompt/params/requestId 落成 success 节点，可直接作为优化链的根。
  useEffect(() => {
    if (!canvasLoaded || !pendingImport) return;
    const payload = pendingImport;
    onImportConsumed();
    void (async () => {
      try {
        const blob = await (await fetch(payload.imageUrl)).blob();
        const objectUrl = URL.createObjectURL(blob);
        const { width, height } = await getImageSize(objectUrl);
        const thumb = await createListThumbnail(blob);
        const thumbUrl = thumb ? URL.createObjectURL(thumb.blob) : undefined;
        const nodeW = CANVAS_DEFAULT_NODE_WIDTH;
        const nodeH = Math.round(nodeW * (height / width));
        const center = viewportCenter();
        const pos = findNonOverlappingPos(center.x, center.y, nodeW, nodeH);
        const nodeId = uid();
        markHistory();
        const node: CanvasNode = {
          id: nodeId,
          requestId: payload.requestId,
          type: "image",
          x: pos.x,
          y: pos.y,
          width: nodeW,
          height: nodeH,
          prompt: payload.prompt,
          model: payload.model,
          protocol: payload.protocol,
          params: payload.params,
          status: "success",
          createdAt: Date.now(),
          imageWidth: width,
          imageHeight: height,
          objectUrl,
          thumbUrl,
        };
        setCanvasNodes((prev) => [...prev, node]);
        await saveCanvasImageToDB(nodeId, blob);
        if (thumb) await saveCanvasImageToDB(canvasThumbKey(nodeId), thumb.blob);
        scheduleSave();
        selectOnly(nodeId);
        ensureRectVisible(pos.x, pos.y, nodeW, nodeH);
        showToast("已导入到画布，可基于它继续优化");
      } catch {
        showToast("导入失败：原图已不可用");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasLoaded, pendingImport]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function isInputFocused() {
      const tag = document.activeElement?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === " " && !isInputFocused()) {
        e.preventDefault();
        setIsSpaceHeld(true);
      }
      // 撤销 / 重做
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !isInputFocused()) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      // 全选
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !isInputFocused()) {
        e.preventDefault();
        const all = new Set(nodesRef.current.map((n) => n.id));
        setSelectedIds(all);
        setSelectedNodeId(all.size ? [...all][all.size - 1] : null);
        return;
      }
      if (e.key === "Escape") {
        if (editingNoteId) { setEditingNoteId(null); return; }
        selectOnly(null);
        setMarquee(null);
        if (panelMode === "optimize") {
          setPanelMode("generate");
          setOptimizeSourceNode(null);
          setCompressedRef(null);
        }
        setShowDeleteConfirm(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !isInputFocused() && selectedNodeId) {
        e.preventDefault();
        setShowDeleteConfirm(selectedNodeId);
      }
      if (e.key === "e" && !isInputFocused() && selectedNodeId) {
        const node = nodesRef.current.find((n) => n.id === selectedNodeId);
        if (node?.status === "success") void enterOptimizeMode(node);
      }
      if (e.key === "m" && !isInputFocused()) {
        setIsMinimapVisible((v) => !v);
      }
      // 下载选中节点（多选时批量）
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && !isInputFocused()) {
        e.preventDefault();
        void downloadNodes(selectedImageNodes(selectedNodeIdRef.current ?? undefined));
        return;
      }
      // 复制提示词。用户正在选文字时不抢 ⌘C，否则复制文本这个基本操作会失灵
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && !isInputFocused()
        && !window.getSelection()?.toString()) {
        const targets = selectedImageNodes(selectedNodeIdRef.current ?? undefined);
        if (targets.length > 0) {
          e.preventDefault();
          copyPrompts(targets);
        }
        return;
      }
      // 编组 / 解组
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g" && !isInputFocused()) {
        e.preventDefault();
        if (e.shiftKey) {
          const group = selectedNodeIdRef.current ? groupOfNode(selectedNodeIdRef.current) : null;
          if (group) ungroup(group.id); else showToast("选中的节点不在任何分组里");
        } else {
          createGroup();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const nz = clampZoomVal(viewportRef.current.zoom * 1.2);
        zoomAtCenter(nz);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "-") {
        e.preventDefault();
        const nz = clampZoomVal(viewportRef.current.zoom / 1.2);
        zoomAtCenter(nz);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        zoomAtCenter(1);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        fitAllNodes();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === " ") setIsSpaceHeld(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, panelMode]);

  // ── Context menu prevention ──
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    // 右键落在节点上就开菜单；落在空白处保持原有的平移语义
    const nodeEl = (e.target as HTMLElement).closest?.(".canvas-node");
    if (!nodeEl) {
      // 空白处右键：记下画布坐标，菜单里提供「在此生成」
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) { setContextMenu(null); return; }
      const vp = viewportRef.current;
      setContextMenu({
        nodeId: "",
        x: e.clientX,
        y: e.clientY,
        canvasX: (e.clientX - rect.left) / vp.zoom + vp.x,
        canvasY: (e.clientY - rect.top) / vp.zoom + vp.y,
      });
      return;
    }
    const id = canvasNodes.find((n) => {
      const el = document.querySelector(`.canvas-node[data-node-id="${n.id}"]`);
      return el === nodeEl;
    })?.id;
    if (!id) return;
    setSelectedNodeId(id);
    setContextMenu({ nodeId: id, x: e.clientX, y: e.clientY });
  }

  function viewOriginal(node: CanvasNode) {
    if (!node.objectUrl) return;
    setContextMenu(null);
    setOriginalPreview(node);
  }

  // ── Delete node ──
  // 删除支持多选批量。关键：**不** revoke objectUrl、**不** 删 IndexedDB 里的图，
  // 否则撤销回来就是一张空图。孤儿图片在画布卸载时由 cleanupOrphanImages 统一回收。
  function confirmDeleteNode(id: string) {
    const ids = selectedIdsRef.current.has(id) && selectedIdsRef.current.size > 1
      ? new Set(selectedIdsRef.current)
      : new Set([id]);
    markHistory();
    setCanvasNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    setCanvasEdges((prev) => prev.filter((edge) => !ids.has(edge.fromNodeId) && !ids.has(edge.toNodeId)));
    // 删掉的节点要从分组里摘出去，空掉的分组一并移除
    setCanvasGroups((prev) => prev
      .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((nodeId) => !ids.has(nodeId)) }))
      .filter((g) => g.nodeIds.length > 0));
    if (editingNoteId && ids.has(editingNoteId)) setEditingNoteId(null);
    if (selectedNodeId && ids.has(selectedNodeId)) {
      selectOnly(null);
      if (panelMode === "optimize") {
        setPanelMode("generate");
        setOptimizeSourceNode(null);
        setCompressedRef(null);
      }
    } else {
      setSelectedIds((prev) => new Set([...prev].filter((v) => !ids.has(v))));
    }
    setShowDeleteConfirm(null);
    if (ids.size > 1) showToast(`已删除 ${ids.size} 个节点`);
  }

  // 画布卸载时回收：IndexedDB 里存在、但当前画布已无对应节点的图片
  async function cleanupOrphanImages(liveNodeIds: Set<string>) {
    try {
      const db = await openDb();
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const req = db.transaction(CANVAS_IMAGES_STORE, "readonly").objectStore(CANVAS_IMAGES_STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const key of keys) {
        const raw = String(key);
        const nodeId = raw.endsWith(":thumb") ? raw.slice(0, -":thumb".length) : raw;
        if (!liveNodeIds.has(nodeId)) await deleteCanvasImageFromDB(raw);
      }
    } catch { /* 清理失败不影响使用，下次卸载再试 */ }
  }

  // ── Download node ──
  function downloadNode(node: CanvasNode) {
    if (!node.objectUrl) return;
    const a = document.createElement("a");
    a.href = node.objectUrl;
    // 扩展名跟着实际输出格式走，写死 .png 会让 webp/jpeg 存下来打不开
    const ext = node.params.outputFormat === "jpeg" ? "jpg" : node.params.outputFormat || "png";
    a.download = `${node.model}-${node.params.aspectRatio.replace(":", "x")}-${Date.now()}.${ext}`;
    a.click();
  }

  // 选中集合里能参与「图片操作」的节点：便签和未成功的节点都排除掉
  function selectedImageNodes(fallbackId?: string) {
    const ids = selectedIdsRef.current.size > 0
      ? selectedIdsRef.current
      : new Set(fallbackId ? [fallbackId] : []);
    return nodesRef.current.filter((n) => ids.has(n.id) && n.type === "image" && n.status === "success");
  }

  // ── 批量下载 ──
  // 浏览器会拦截「连发」的下载，所以逐张触发并隔一拍
  async function downloadNodes(nodes: CanvasNode[]) {
    if (nodes.length === 0) { showToast("没有可下载的图片"); return; }
    for (let i = 0; i < nodes.length; i += 1) {
      downloadNode(nodes[i]);
      if (i < nodes.length - 1) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (nodes.length > 1) showToast(`已开始下载 ${nodes.length} 张`);
  }

  // ── Copy prompt ──
  function copyPrompt(node: CanvasNode) {
    void navigator.clipboard.writeText(node.prompt);
    showToast("提示词已复制");
  }

  function copyPrompts(nodes: CanvasNode[]) {
    if (nodes.length === 0) return;
    if (nodes.length === 1) { copyPrompt(nodes[0]); return; }
    void navigator.clipboard.writeText(nodes.map((n) => n.prompt).join("\n\n"));
    showToast(`已复制 ${nodes.length} 条提示词`);
  }

  // ── 便签节点 ────────────────────────────────────────────────
  // 便签复用 CanvasNode，只是 type="note"：这样拖拽、多选、框选、删除、撤销、
  // 持久化全都免费复用，不用为它再走一套平行的数据流。
  const NOTE_DEFAULT_WIDTH = 220;
  const NOTE_DEFAULT_HEIGHT = 140;
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  function addNote(at?: { x: number; y: number }) {
    const anchor = at ?? viewportCenter();
    const pos = findNonOverlappingPos(anchor.x, anchor.y, NOTE_DEFAULT_WIDTH, NOTE_DEFAULT_HEIGHT);
    const note: CanvasNode = {
      id: uid(),
      type: "note",
      x: pos.x,
      y: pos.y,
      width: NOTE_DEFAULT_WIDTH,
      height: NOTE_DEFAULT_HEIGHT,
      prompt: "",
      noteText: "",
      model: "",
      protocol: apiConfig.protocol,
      params: {
        aspectRatio: "1:1", size: "", resolution: "1K", quality: "auto",
        outputFormat: "png", batchCount: 1, concurrency: 1, retryLimit: 0,
        seed: "", negativePrompt: "",
      },
      status: "success",
      createdAt: Date.now(),
    };
    markHistory();
    setCanvasNodes((prev) => [...prev, note]);
    selectOnly(note.id);
    setEditingNoteId(note.id);
  }

  function updateNoteText(id: string, text: string) {
    setCanvasNodes((prev) => prev.map((n) => (n.id === id ? { ...n, noteText: text } : n)));
  }

  // ── 分组 ────────────────────────────────────────────────────
  // 分组不改成员坐标，只是「一层带标题的框」。折叠时成员从画布上隐藏，
  // 折叠壳自身可拖动，拖动时把位移分摊给所有成员（沿用 dragStartRef 那套原点+总位移）。
  const GROUP_PADDING = 36;
  const GROUP_HEADER_HEIGHT = 30;

  function groupBounds(group: CanvasGroup, nodes: CanvasNode[]) {
    const members = nodes.filter((n) => group.nodeIds.includes(n.id));
    if (members.length === 0) return null;
    const minX = Math.min(...members.map((n) => n.x)) - GROUP_PADDING;
    const minY = Math.min(...members.map((n) => n.y)) - GROUP_PADDING;
    const maxX = Math.max(...members.map((n) => n.x + n.width)) + GROUP_PADDING;
    const maxY = Math.max(...members.map((n) => n.y + n.height)) + GROUP_PADDING;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, members };
  }

  function groupOfNode(nodeId: string) {
    return groupsRef.current.find((g) => g.nodeIds.includes(nodeId)) || null;
  }

  function createGroup() {
    const ids = [...selectedIdsRef.current];
    if (ids.length < 2) { showToast("先框选至少 2 个节点再分组"); return; }
    markHistory();
    // 一个节点只属于一个分组：先把它从旧分组里摘掉，空掉的旧分组顺手删除
    setCanvasGroups((prev) => {
      const cleaned = prev
        .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => !ids.includes(id)) }))
        .filter((g) => g.nodeIds.length > 0);
      return [...cleaned, { id: uid(), name: `分组 ${cleaned.length + 1}`, nodeIds: ids, collapsed: false }];
    });
    showToast(`已把 ${ids.length} 个节点编为一组`);
  }

  function ungroup(groupId: string) {
    markHistory();
    setCanvasGroups((prev) => prev.filter((g) => g.id !== groupId));
    showToast("已解散分组");
  }

  function renameGroup(groupId: string, name: string) {
    setCanvasGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));
  }

  function toggleGroupCollapsed(groupId: string) {
    setCanvasGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)));
    // 折叠后成员从 DOM 里消失，但选中态还在：浮动工具栏会悬在一个看不见的选区上，
    // 点「下载 / 删除」作用于不可见的节点。折叠时顺手把成员移出选区。
    const group = groupsRef.current.find((g) => g.id === groupId);
    if (group && !group.collapsed) {
      setSelectedIds((prev) => new Set([...prev].filter((id) => !group.nodeIds.includes(id))));
      if (selectedNodeIdRef.current && group.nodeIds.includes(selectedNodeIdRef.current)) setSelectedNodeId(null);
    }
  }

  // ── 推荐到广场 ──────────────────────────────────────────────
  const [canvasRecommending, setCanvasRecommending] = useState<string | null>(null);

  async function recommendCanvasNode(node: CanvasNode) {
    if (node.type !== "image" || node.status !== "success") return;
    if (!apiConfig.apiKey || apiConfig.apiKey.length < API_KEY_MIN_LENGTH) {
      showToast("配置 API Key 后可推荐到广场");
      return;
    }
    setCanvasRecommending(node.id);
    try {
      const blob = await loadCanvasImageFromDB(node.id);
      if (!blob) throw new Error("本地图片已丢失，无法推荐");
      const thumbnail = await createSquareThumbnail(await blobToDataUrl(blob), 1024);
      const response = await fetch("/api/square/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiConfig.apiKey,
          imageId: node.id,
          thumbnailDataUrl: thumbnail.dataUrl,
          sourceImageMeta: {
            imageId: node.id,
            requestId: node.requestId,
            model: node.model,
            width: node.imageWidth || thumbnail.width,
            height: node.imageHeight || thumbnail.height,
            aspectRatio: node.params.aspectRatio,
          },
          prompt: node.prompt,
          params: node.params,
          caption: node.prompt.replace(/\s+/g, " ").slice(0, 120),
          hidePrompt: hidePromptOnShare,
          sourceType: "canvas",
          reasonPlan: { compressedTo: "1K" },
        }),
      });
      const payload = await readApiJson<SquareRecommendResponse>(response, "/api/square/recommend");
      if (!response.ok || !payload.ok) throw payload;
      showToast(payload.action === "replaced"
        ? `已推荐，替换最早展示位 · 今日剩余 ${payload.remainingDailyQuota ?? 0}`
        : `已推荐到广场 · 今日剩余 ${payload.remainingDailyQuota ?? 0}`);
    } catch (error) {
      showToast(canvasErrorText(error, "推荐失败"));
    } finally {
      setCanvasRecommending(null);
    }
  }

  // ── 画布快照导出 ────────────────────────────────────────────
  // 把当前画布（图片 + 便签 + 连线 + 分组框）画进一张离屏 canvas 再导出 PNG。
  // 纯 Canvas2D，不引第三方依赖；长边上限 6000px，避免超出浏览器 canvas 面积限制。
  const SNAPSHOT_MAX_EDGE = 6000;
  const SNAPSHOT_MARGIN = 60;
  const [isExportingSnapshot, setIsExportingSnapshot] = useState(false);

  async function exportCanvasSnapshot() {
    const nodes = nodesRef.current;
    if (nodes.length === 0) { showToast("画布是空的，没有可导出的内容"); return; }
    setIsExportingSnapshot(true);
    try {
      const minX = Math.min(...nodes.map((n) => n.x)) - SNAPSHOT_MARGIN;
      const minY = Math.min(...nodes.map((n) => n.y)) - SNAPSHOT_MARGIN;
      const maxX = Math.max(...nodes.map((n) => n.x + n.width)) + SNAPSHOT_MARGIN;
      const maxY = Math.max(...nodes.map((n) => n.y + n.height)) + SNAPSHOT_MARGIN;
      const contentW = maxX - minX;
      const contentH = maxY - minY;
      // 节点在画布上的宽度只有 280px，直接 1:1 导出会很糊；放大到 2 倍，再受长边上限约束
      const scale = Math.min(2, SNAPSHOT_MAX_EDGE / Math.max(contentW, contentH));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(contentW * scale));
      canvas.height = Math.max(1, Math.round(contentH * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("当前浏览器不支持画布导出");
      ctx.scale(scale, scale);
      ctx.translate(-minX, -minY);

      // 背景（与画布视口同色）
      ctx.fillStyle = "#141312";
      ctx.fillRect(minX, minY, contentW, contentH);

      // 分组框（画在最底层）
      for (const group of groupsRef.current) {
        const b = groupBounds(group, nodes);
        if (!b) continue;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(b.x, b.y, b.width, b.height);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "16px system-ui, sans-serif";
        ctx.fillText(group.name, b.x + 8, b.y - 8);
      }

      // 连线
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 2;
      for (const edge of edgesRef.current) {
        const from = nodes.find((n) => n.id === edge.fromNodeId);
        const to = nodes.find((n) => n.id === edge.toNodeId);
        if (!from || !to) continue;
        const x1 = from.x + from.width;
        const y1 = from.y + from.height / 2;
        const x2 = to.x;
        const y2 = to.y + to.height / 2;
        const dx = Math.abs(x2 - x1) * 0.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
        ctx.stroke();
      }

      // 节点
      for (const node of nodes) {
        if (node.type === "note") {
          ctx.fillStyle = "#f3e2a9";
          ctx.fillRect(node.x, node.y, node.width, node.height);
          ctx.fillStyle = "#3a3325";
          ctx.font = "14px system-ui, sans-serif";
          wrapCanvasText(ctx, node.noteText || "", node.x + 12, node.y + 26, node.width - 24, 20);
          continue;
        }
        // 导出用原图而不是缩略图，缩略图放大到 2 倍会糊
        const blob = node.status === "success" ? await loadCanvasImageFromDB(node.id) : null;
        if (!blob) {
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(node.x, node.y, node.width, node.height);
          continue;
        }
        const bitmap = await createImageBitmap(blob);
        ctx.drawImage(bitmap, node.x, node.y, node.width, node.height);
        bitmap.close();
      }

      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `canvas-snapshot-${Date.now()}.png`;
      a.click();
      showToast(`已导出 ${canvas.width}×${canvas.height} 快照`);
    } catch (error) {
      showToast(canvasErrorText(error, "导出失败"));
    } finally {
      setIsExportingSnapshot(false);
    }
  }

  // ── Enter optimize mode ──
  async function enterOptimizeMode(node: CanvasNode) {
    // 便签也是 status: "success"（它没有失败态），所以凡是靠 status 判断「能不能优化」
    // 的入口都会把便签放进来。统一在这里挡一道，省得每个调用点各写一遍。
    if (node.type !== "image") return;
    setPanelMode("optimize");
    setOptimizeSourceNode(node);
    setOptimizePrompt("");
    setIsPanelOpen(true);
    setCompressedRef(null);
    // 换了源图，上一轮追加的参考不再适用
    setExtraRefs([]);
    // 参数继承原图（PRD §4.2.5）：优化默认沿用源图的模型与参数，避免面板里
    // 残留的上一次设置被静默用在这张图上；用户之后改动面板即自然脱离继承。
    // "imported" 等不在可选列表的模型不回填，保持当前选择。
    if (node.model && selectableModels.includes(node.model)) setCanvasModel(node.model);
    if (node.params.aspectRatio) setCanvasAspectRatio(node.params.aspectRatio);
    if (node.params.resolution) setCanvasResolution(node.params.resolution);
    if (node.params.quality) setCanvasQuality(node.params.quality);
    // Compress the image
    try {
      const blob = await loadCanvasImageFromDB(node.id);
      if (!blob) return;
      const dataUrl = await blobToDataUrl(blob);
      // Use createSquareThumbnail with maxEdge 1024
      const result = await createSquareThumbnail(dataUrl, 1024);
      const size = Math.round(result.dataUrl.length * 3 / 4); // approximate byte size
      setCompressedRef({ dataUrl: result.dataUrl, size });
    } catch {
      // Failed to compress, use original objectUrl
    }
  }

  // ── Generation flow ──
  async function handleCanvasGenerate(options?: { at?: { x: number; y: number }; refNodeIds?: string[]; promptOverride?: string }) {
    // promptOverride：内联生成卡片走自己的输入，不依赖右侧面板的提示词
    const trimmedPrompt = (options?.promptOverride ?? canvasPrompt).trim();
    if (!trimmedPrompt || !canvasModel || modelState.status !== "ready") return;
    if (canvasRunningRef.current >= CANVAS_MAX_CONCURRENCY) {
      showToast(`最多同时生成 ${CANVAS_MAX_CONCURRENCY} 张，请等待当前任务完成`);
      return;
    }

    const aspectNum = aspectRatioToNumber(canvasAspectRatio);
    const nodeW = CANVAS_DEFAULT_NODE_WIDTH;
    const nodeH = Math.round(nodeW / aspectNum);
    const anchor = options?.at ?? viewportCenter();
    const pos = findNonOverlappingPos(anchor.x, anchor.y, nodeW, nodeH);

    const nodeId = uid();
    // 预分配任务 ID 并随节点落库：页面关闭后靠它去 /api/tasks 找回结果
    const plannedRequestId = uid();
    const size = resolveRequestSize(canvasAspectRatio, canvasResolution, apiConfig.protocol, canvasModel, canvasSize);
    const newNode: CanvasNode = {
      id: nodeId,
      requestId: plannedRequestId,
      type: "image",
      x: pos.x,
      y: pos.y,
      width: nodeW,
      height: nodeH,
      prompt: trimmedPrompt,
      model: canvasModel,
      protocol: apiConfig.protocol,
      params: {
        aspectRatio: canvasAspectRatio,
        size,
        resolution: canvasResolution,
        quality: canvasQuality,
        outputFormat: "png",
        batchCount: 1,
        concurrency: 1,
        retryLimit: 0,
        seed: "",
        negativePrompt: "",
      },
      status: "generating",
      createdAt: Date.now(),
      refNodeIds: options?.refNodeIds?.length ? [...options.refNodeIds] : undefined,
    };

    // 引用了参考图：给每张参考画一条血缘边（这张图从那些图来）
    const refIds = options?.refNodeIds || [];
    const referenceEdges = refIds.map((rid) => ({ id: uid(), fromNodeId: rid, toNodeId: nodeId }));
    const nextNodes = [...nodesRef.current, newNode];
    const nextEdges = [...edgesRef.current, ...referenceEdges];
    setCanvasNodes(nextNodes);
    setCanvasEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    // 内联卡片有自己的输入框，不动面板里的提示词
    if (!options?.promptOverride) setCanvasPrompt("");
    // 新节点立即选中并确保可见：生成完按 E 即可直接进入优化，不用回头找图
    selectOnly(nodeId);
    ensureRectVisible(pos.x, pos.y, nodeW, nodeH);
    reportCanvasSubmissionIntent(newNode);
    const persistedAt = await persistPendingGraph([nodeId], nextNodes, nextEdges);
    if (!persistedAt) return;
    bumpRunning(1);

    try {
      // 参考图按用户排定的顺序压缩、发送——顺序就是 referenceImages 的数组顺序
      const referenceImages: SubmittedReference[] = [];
      for (const refId of refIds) {
        const blob = await loadCanvasImageFromDB(refId);
        if (!blob) { showToast("有一张参考图读取失败，已跳过"); continue; }
        const dataUrl = await blobToDataUrl(blob);
        const compressed = await createSquareThumbnail(dataUrl, 1024);
        const bytes = Math.round(compressed.dataUrl.length * 3 / 4);
        referenceImages.push({
          name: `reference-${referenceImages.length + 1}.webp`,
          type: "image/webp",
          dataUrl: compressed.dataUrl,
          originalBytes: bytes,
          requestBytes: bytes,
          compressed: true,
        });
      }
      await submitCanvasNode(nodeId, {
        baseUrl: normalizeApiBaseUrl(apiConfig.baseUrl),
        apiKey: apiConfig.apiKey,
        clientId: getClientId(),
        requestId: plannedRequestId,
        trace: {
          surface: "canvas",
          localRecordId: nodeId,
          submittedAt: newNode.createdAt,
          persistedAt,
        },
        request: {
          protocol: apiConfig.protocol,
          model: canvasModel,
          prompt: trimmedPrompt,
          referenceImages,
          aspectRatio: canvasAspectRatio,
          size,
          resolution: canvasResolution,
          quality: canvasQuality,
          outputFormat: "png",
          seed: "",
        },
      });
    } catch (err) {
      const message = canvasErrorText(err, "生成失败");
      setCanvasNodes((prev) => prev.map((n) =>
        n.id === nodeId ? { ...n, status: "error" as const, error: message } : n
      ));
    } finally {
      bumpRunning(-1);
    }
  }

  // ── Optimize generation flow ──
  async function handleCanvasOptimize() {
    if (!optimizeSourceNode || !compressedRef) return;
    const sourceNode = optimizeSourceNode;
    const supplement = optimizePrompt.trim();
    const finalPrompt = supplement
      ? `基于参考图进行优化。原始描述：${sourceNode.prompt}。优化方向：${supplement}`
      : sourceNode.prompt;

    // 扇形变体（roadmap PRD D2）：一次派生 1–4 个分支，各自独立任务
    const count = Math.max(1, Math.min(4, optimizeCount));
    if (canvasRunningRef.current + count > CANVAS_MAX_CONCURRENCY) {
      const room = Math.max(0, CANVAS_MAX_CONCURRENCY - canvasRunningRef.current);
      showToast(`并发上限 ${CANVAS_MAX_CONCURRENCY}，当前最多还能同时生成 ${room} 张`);
      return;
    }

    const aspectNum = aspectRatioToNumber(canvasAspectRatio);
    const nodeW = CANVAS_DEFAULT_NODE_WIDTH;
    const nodeH = Math.round(nodeW / aspectNum);
    const size = resolveRequestSize(canvasAspectRatio, canvasResolution, apiConfig.protocol, canvasModel, canvasSize);

    // 位置：派生把手拖拽给了落点就用落点，否则默认放父节点右侧
    const dropAt = optimizeAtRef.current;
    optimizeAtRef.current = null;
    const baseX = dropAt ? dropAt.x : sourceNode.x + sourceNode.width + 60;
    const baseY = dropAt ? dropAt.y : sourceNode.y;

    // 参考图：源图 + 追加参考（roadmap PRD D6 多图参考，全部走同一压缩管线）
    const referenceImages: SubmittedReference[] = [
      {
        name: "reference.webp",
        type: "image/webp",
        dataUrl: compressedRef.dataUrl,
        originalBytes: compressedRef.size,
        requestBytes: compressedRef.size,
        compressed: true,
      },
      ...extraRefs.map((r, i) => ({
        name: `reference-${i + 2}.webp`,
        type: "image/webp",
        dataUrl: r.dataUrl,
        originalBytes: r.size,
        requestBytes: r.size,
        compressed: true,
      })),
    ];

    // 先把 N 个节点与血缘边一次性落到画布（扇形纵向展开、避让已有节点与彼此）
    const newNodes: CanvasNode[] = [];
    const newEdges: CanvasEdge[] = [];
    for (let i = 0; i < count; i++) {
      let newX = baseX;
      let newY = baseY + (i - (count - 1) / 2) * (nodeH + 40);
      let attempts = 0;
      const occupied = [...nodesRef.current, ...newNodes];
      while (
        occupied.some((n) =>
          newX < n.x + n.width + 20 && newX + nodeW + 20 > n.x &&
          newY < n.y + n.height + 20 && newY + nodeH + 20 > n.y
        ) && attempts < 20
      ) {
        newY += nodeH + 40;
        attempts++;
      }
      const plannedRequestId = uid();
      newNodes.push({
        id: uid(),
        requestId: plannedRequestId,
        type: "image",
        x: newX,
        y: newY,
        width: nodeW,
        height: nodeH,
        prompt: finalPrompt,
        model: canvasModel,
        protocol: apiConfig.protocol,
        params: {
          aspectRatio: canvasAspectRatio,
          size,
          resolution: canvasResolution,
          quality: canvasQuality,
          outputFormat: "png",
          batchCount: 1,
          concurrency: 1,
          retryLimit: 0,
          seed: "",
          negativePrompt: "",
        },
        status: "generating",
        parentId: sourceNode.id,
        referenceNodeId: sourceNode.id,
        createdAt: Date.now(),
      });
      newEdges.push({ id: uid(), fromNodeId: sourceNode.id, toNodeId: newNodes[i].id });
    }

    const nextNodes = [...nodesRef.current, ...newNodes];
    const nextEdges = [...edgesRef.current, ...newEdges];
    setCanvasNodes(nextNodes);
    setCanvasEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    // 链式迭代（PRD §4.2.8）：首个新节点自动选中、补充词清空、视口覆盖整个扇形
    selectOnly(newNodes[0].id);
    setOptimizePrompt("");
    const fanMinY = Math.min(...newNodes.map((n) => n.y));
    const fanMaxY = Math.max(...newNodes.map((n) => n.y + n.height));
    ensureRectVisible(baseX, fanMinY, nodeW, fanMaxY - fanMinY);
    newNodes.forEach((node) => reportCanvasSubmissionIntent(node));
    const persistedAt = await persistPendingGraph(newNodes.map((node) => node.id), nextNodes, nextEdges);
    if (!persistedAt) return;

    // N 个任务并行入队；单个失败只标记对应节点
    await Promise.all(newNodes.map(async (node) => {
      try {
        await submitCanvasNode(node.id, {
          baseUrl: normalizeApiBaseUrl(apiConfig.baseUrl),
          apiKey: apiConfig.apiKey,
          clientId: getClientId(),
          requestId: node.requestId as string,
          trace: {
            surface: "canvas",
            localRecordId: node.id,
            submittedAt: node.createdAt,
            persistedAt,
          },
          request: {
            protocol: apiConfig.protocol,
            model: canvasModel,
            prompt: finalPrompt,
            referenceImages,
            aspectRatio: canvasAspectRatio,
            size,
            resolution: canvasResolution,
            quality: canvasQuality,
            outputFormat: "png",
            seed: "",
          },
        });
      } catch (err) {
        const message = canvasErrorText(err, "生成失败");
        setCanvasNodes((prev) => prev.map((n) =>
          n.id === node.id ? { ...n, status: "error" as const, error: message } : n
        ));
      }
    }));
  }

  // ── Retry failed node ──
  async function retryNode(node: CanvasNode) {
    // 用户主动重试一个已终态失败的节点，是一项新的逻辑任务，因此分配新 ID；
    // 网络模糊状态的自动恢复则由 submitGenerationTask 使用原 ID 完成。
    const plannedRequestId = uid();
    const retrySubmittedAt = Date.now();
    const nextNodes = nodesRef.current.map((n) =>
      n.id === node.id
        ? {
            ...n,
            status: "generating" as const,
            error: undefined,
            requestId: plannedRequestId,
            createdAt: retrySubmittedAt,
            stages: undefined,
            submissionState: undefined,
          }
        : n
    );
    setCanvasNodes(nextNodes);
    nodesRef.current = nextNodes;
    const retrySnapshot = nextNodes.find((item) => item.id === node.id);
    if (retrySnapshot) reportCanvasSubmissionIntent(retrySnapshot, retrySubmittedAt);
    const persistedAt = await persistPendingGraph([node.id], nextNodes, edgesRef.current);
    if (!persistedAt) return;
    bumpRunning(1);
    try {
      const referenceImages: SubmittedReference[] = [];
      // 重试重建参考图：生成模块的多参考（refNodeIds，保序）优先，其次是优化链的单一父图
      const retryRefIds = node.refNodeIds?.length
        ? node.refNodeIds
        : node.referenceNodeId && node.parentId ? [node.parentId] : [];
      for (const refId of retryRefIds) {
        const refBlob = await loadCanvasImageFromDB(refId);
        if (!refBlob) continue;
        const refDataUrl = await blobToDataUrl(refBlob);
        const compressed = await createSquareThumbnail(refDataUrl, 1024);
        referenceImages.push({
          name: `reference-${referenceImages.length + 1}.webp`,
          type: "image/webp",
          dataUrl: compressed.dataUrl,
          originalBytes: compressed.dataUrl.length,
          requestBytes: compressed.dataUrl.length,
          compressed: true,
        });
      }
      await submitCanvasNode(node.id, {
        baseUrl: normalizeApiBaseUrl(apiConfig.baseUrl),
        apiKey: apiConfig.apiKey,
        clientId: getClientId(),
        requestId: plannedRequestId,
        trace: {
          surface: "canvas",
          localRecordId: node.id,
          submittedAt: retrySubmittedAt,
          persistedAt,
        },
        request: {
          protocol: node.protocol,
          model: node.model,
          prompt: node.prompt,
          referenceImages,
          aspectRatio: node.params.aspectRatio,
          size: node.params.size,
          resolution: node.params.resolution,
          quality: node.params.quality,
          outputFormat: node.params.outputFormat,
          seed: "",
        },
      });
    } catch (err) {
      const message = canvasErrorText(err, "生成失败");
      setCanvasNodes((prev) => prev.map((n) =>
        n.id === node.id ? { ...n, status: "error" as const, error: message } : n
      ));
    } finally {
      bumpRunning(-1);
    }
  }

  // ── 取消生成（PRD §5.4）──
  // 后端没有取消 API（服务端任务会照常跑完、结果留在日志里），这里是轻量取消：
  // 删掉节点即停止对账，本次结果不再进画布。markHistory 让取消本身可撤销。
  function cancelNode(node: CanvasNode) {
    markHistory();
    taskMissCountsRef.current.delete(node.id);
    setCanvasNodes((prev) => prev.filter((n) => n.id !== node.id));
    setCanvasEdges((prev) => prev.filter((e) => e.fromNodeId !== node.id && e.toNodeId !== node.id));
    if (selectedNodeIdRef.current === node.id) selectOnly(null);
    showToast("已取消，本次结果不会进入画布");
  }

  function copyErrorText(node: CanvasNode) {
    const text = node.error || "";
    if (!text) return;
    void navigator.clipboard?.writeText(text)
      .then(() => showToast("已复制错误信息"))
      .catch(() => showToast("复制失败，请手动选择文本"));
  }

  // ── 配方（roadmap PRD B2）──
  function applyRecipeToCanvas(recipe: Recipe) {
    setCanvasPrompt(recipe.prompt);
    if (selectableModels.includes(recipe.model)) setCanvasModel(recipe.model);
    if (recipe.params.aspectRatio) setCanvasAspectRatio(recipe.params.aspectRatio);
    if (recipe.params.resolution) setCanvasResolution(recipe.params.resolution);
    if (recipe.params.quality) setCanvasQuality(recipe.params.quality);
    showToast(`已应用配方「${recipe.name}」`);
  }

  async function saveNodeAsRecipe(node: CanvasNode) {
    const name = window.prompt("配方名称", node.prompt.replace(/\s+/g, " ").slice(0, 20));
    if (!name || !name.trim()) return;
    try {
      await saveRecipe({
        id: uid(),
        name: name.trim().slice(0, 40),
        prompt: node.prompt,
        model: node.model,
        params: node.params,
        createdAt: Date.now(),
      });
      setCanvasRecipes(await listRecipes());
      showToast("配方已保存（仅存本机浏览器）");
    } catch {
      showToast("配方保存失败");
    }
  }

  // ── Computed values ──
  const selectedNode = canvasNodes.find((n) => n.id === selectedNodeId) || null;
  const canScale = isGptImage2ProModel(canvasModel) || !usesOfficialGptImageSizing(apiConfig.protocol, canvasModel);
  const canvasEffectiveResolution = canScale ? canvasResolution : DEFAULT_IMAGE_RESOLUTION;
  const supportedAspectRatios = getSupportedAspectRatios(apiConfig.protocol, canvasModel, canvasEffectiveResolution);
  const resolvedSize = resolveRequestSize(canvasAspectRatio, canvasResolution, apiConfig.protocol, canvasModel, canvasSize);
  const canvasExplicitSizeOptions = explicitSizeOptionsForModel(canvasModel, canvasEffectiveResolution);
  const selectedCanvasSizeOption = canvasExplicitSizeOptions.find((option) => option.size === resolvedSize);
  const isApiReady = modelState.status === "ready" && apiConfig.apiKey.trim().length >= 8;

  // ── Update model when global changes ──
  useEffect(() => {
    if (globalSelectedModel && selectableModels.includes(globalSelectedModel)) {
      setCanvasModel(globalSelectedModel);
    }
  }, [globalSelectedModel, selectableModels]);

  // ── Update aspect ratio when model changes ──
  useEffect(() => {
    const nextResolution = canScale ? canvasResolution : DEFAULT_IMAGE_RESOLUTION;
    const ratios = getSupportedAspectRatios(apiConfig.protocol, canvasModel, nextResolution);
    if (!ratios.includes(canvasAspectRatio)) {
      setCanvasAspectRatio(ratios[0] || "1:1");
    }
    if (!canScale && canvasResolution !== DEFAULT_IMAGE_RESOLUTION) {
      setCanvasResolution("1K");
    }
    const nextSize = resolveRequestSize(canvasAspectRatio, nextResolution, apiConfig.protocol, canvasModel, canvasSize);
    if (nextSize !== canvasSize) {
      setCanvasSize(nextSize);
    }
  }, [apiConfig.protocol, canScale, canvasAspectRatio, canvasModel, canvasResolution, canvasSize]);

  // ── Floating toolbar position ──
  // 只有缩到「512px 缩略图足够覆盖显示像素」时才降级，其余一律原图。
  // 用离散档位而非连续 zoom，避免每次缩放都让全部节点重渲染。
  const lodTier: "thumb" | "full" = useMemo(() => {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const neededPx = CANVAS_DEFAULT_NODE_WIDTH * viewport.zoom * dpr;
    return neededPx <= LIST_THUMB_MAX_EDGE * 0.9 ? "thumb" : "full";
  }, [viewport.zoom]);

  const toolbarPos = useMemo(() => {
    if (!containerRef.current) return null;
    // 多选时操作栏挂在整个选区的包围盒上方，单选时就是这一个节点
    const anchors = selectedIds.size > 1
      ? canvasNodes.filter((n) => selectedIds.has(n.id))
      : selectedNode ? [selectedNode] : [];
    if (anchors.length === 0) return null;
    const boxX = Math.min(...anchors.map((n) => n.x));
    const boxY = Math.min(...anchors.map((n) => n.y));
    const boxRight = Math.max(...anchors.map((n) => n.x + n.width));
    const boxBottom = Math.max(...anchors.map((n) => n.y + n.height));
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = (boxX - viewport.x) * viewport.zoom + rect.left + ((boxRight - boxX) * viewport.zoom) / 2;
    const screenY = (boxY - viewport.y) * viewport.zoom + rect.top;
    const aboveY = screenY - 12;
    const belowY = screenY + (boxBottom - boxY) * viewport.zoom + 12;
    const y = aboveY > rect.top + 56 ? aboveY : belowY;
    return {
      x: clampNumber(screenX, rect.left + 100, rect.right - 100),
      y: clampNumber(y, rect.top + 10, rect.bottom - 50),
    };
  }, [selectedNode, selectedIds, canvasNodes, viewport]);

  // ── Grid background style ──
  const gridStyle = useMemo((): CSSProperties => {
    if (viewport.zoom < 0.25) return {};
    const spacing = viewport.zoom < 0.5 ? 40 : 20;
    const rendered = spacing * viewport.zoom;
    const ox = (-viewport.x * viewport.zoom) % rendered;
    const oy = (-viewport.y * viewport.zoom) % rendered;
    return {
      backgroundImage: `radial-gradient(circle, rgba(245, 244, 239, 0.2) ${Math.max(1, viewport.zoom)}px, transparent ${Math.max(1, viewport.zoom)}px)`,
      backgroundSize: `${rendered}px ${rendered}px`,
      backgroundPosition: `${ox}px ${oy}px`,
    };
  }, [viewport]);

  // ── Minimap data ──
  // ── 分组派生数据 ──
  const groupFrames = useMemo(
    () => canvasGroups
      .map((group) => ({ group, box: groupBounds(group, canvasNodes) }))
      .filter((entry): entry is { group: CanvasGroup; box: NonNullable<ReturnType<typeof groupBounds>> } => entry.box !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasGroups, canvasNodes],
  );
  // 折叠分组的成员从画布上隐藏（连线也一并隐藏，否则会连到空气上）
  const collapsedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of canvasGroups) {
      if (group.collapsed) group.nodeIds.forEach((id) => ids.add(id));
    }
    return ids;
  }, [canvasGroups]);
  collapsedNodeIdsRef.current = collapsedNodeIds;

  const minimapData = useMemo(() => {
    if (!isMinimapVisible || canvasNodes.length === 0) return null;
    const pad = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of canvasNodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    }
    const cw = maxX - minX + pad * 2;
    const ch = maxY - minY + pad * 2;
    const scale = Math.min(170 / cw, 110 / ch);
    const rect = containerRef.current?.getBoundingClientRect();
    const vpW = rect ? rect.width / viewport.zoom : 0;
    const vpH = rect ? rect.height / viewport.zoom : 0;
    return { minX: minX - pad, minY: minY - pad, scale, cw, ch, vpW, vpH };
  }, [isMinimapVisible, canvasNodes, viewport]);

  // ── Render ──
  return (
    <main className={`canvas-page ${isPanelOpen ? "" : "panel-collapsed"}`}>
      {/* 一级导航由全局 AppHeader 承担（App 分支渲染），画布不再自带顶栏 */}

      {/* Canvas viewport */}
      <div
        className={`canvas-viewport ${isSpaceHeld ? "is-space-held" : ""}`}
        ref={containerRef}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
        onDrop={handleCanvasDrop}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onContextMenu={handleContextMenu}
        style={gridStyle}
      >
        {/* Transform layer —— 手势期间由 applyViewportToDom 直接驱动 */}
        <div
          className="canvas-transform-layer"
          ref={transformLayerRef}
          style={{
            transform: `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
          }}
        >
          {/* SVG Edges */}
          <svg className="canvas-edge-layer">
            <defs>
              <marker id="canvas-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="rgba(16,185,129,0.4)" />
              </marker>
            </defs>
            {canvasEdges.map((edge) => {
              const from = canvasNodes.find((n) => n.id === edge.fromNodeId);
              const to = canvasNodes.find((n) => n.id === edge.toNodeId);
              if (!from || !to) return null;
              // 端点被折叠隐藏时连线也隐藏，否则线会连到一片空气上
              if (collapsedNodeIds.has(from.id) || collapsedNodeIds.has(to.id)) return null;
              const x1 = from.x + from.width;
              const y1 = from.y + from.height / 2;
              const x2 = to.x;
              const y2 = to.y + to.height / 2;
              const dx = Math.abs(x2 - x1) * 0.5;
              return (
                <path
                  key={edge.id}
                  className="canvas-edge-path"
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  markerEnd="url(#canvas-arrow)"
                />
              );
            })}
            {/* 派生把手的幽灵线（roadmap PRD D1）：拖拽中实时跟随指针 */}
            {deriveDrag && (() => {
              const { x0, y0, x1, y1 } = deriveDrag;
              const dx = Math.abs(x1 - x0) * 0.5;
              return (
                <path
                  className="canvas-edge-path canvas-derive-ghost"
                  d={`M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}`}
                  markerEnd="url(#canvas-arrow)"
                />
              );
            })()}
          </svg>

          {marquee && (
            <div
              className="canvas-marquee"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}

          {/* 分组框：画在节点下面，只是一层带标题的框，不参与坐标系 */}
          {groupFrames.map(({ group, box }) => (
            <div
              key={group.id}
              className={`canvas-group ${group.collapsed ? "collapsed" : ""}`}
              style={{
                left: box.x,
                top: box.y,
                width: box.width,
                height: group.collapsed ? GROUP_HEADER_HEIGHT + 16 : box.height,
              }}
            >
              <div
                className="canvas-group-header"
                onPointerDown={(e) => handleGroupPointerDown(e, group)}
                onDoubleClick={() => toggleGroupCollapsed(group.id)}
              >
                <button
                  type="button"
                  className="canvas-group-toggle"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleGroupCollapsed(group.id)}
                  title={group.collapsed ? "展开分组" : "折叠分组"}
                >
                  {group.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <input
                  className="canvas-group-name"
                  value={group.name}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => renameGroup(group.id, e.target.value)}
                />
                <span className="canvas-group-count">{group.nodeIds.length}</span>
                <button
                  type="button"
                  className="canvas-group-ungroup"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => ungroup(group.id)}
                  title="解散分组 (⇧⌘G)"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}

          {/* Nodes —— memo 化，拖拽时只重渲染被拖节点 */}
          {canvasNodes.map((node) => (
            collapsedNodeIds.has(node.id) ? null : (
              <CanvasNodeView
                key={node.id}
                node={node}
                selected={selectedIds.has(node.id) || selectedNodeId === node.id}
                dragging={isDraggingNodeRef.current && dragStartRef.current.origins.has(node.id)}
                lodTier={lodTier}
                editingNote={editingNoteId === node.id}
                handlersRef={canvasNodeHandlersRef}
              />
            )
          ))}

          {/* 内联生成卡片：右键「在此生成」在画布原地输入提示词与参数，
              提交后卡片关闭、同一坐标落下生成中节点——视觉上就是卡片变成了节点。
              放在 transform 层内，随画布一起平移缩放。 */}
          {inlineComposer && (
            <div
              className="canvas-inline-composer"
              style={{ left: inlineComposer.x, top: inlineComposer.y, width: CANVAS_DEFAULT_NODE_WIDTH }}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                // 模块自己的右键菜单（删除等），不透传给画布
                e.preventDefault();
                e.stopPropagation();
                setComposerMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <div
                className="canvas-inline-composer-head"
                onPointerDown={startComposerDrag}
                title="按住拖动模块"
              >
                <strong>在此生成</strong>
                <button type="button" className="icon-button" title="删除模块 (Esc)" onClick={closeInlineComposer}>
                  <X size={14} />
                </button>
              </div>
              {inlineRefs.length > 0 && (
                <div className="canvas-inline-refs">
                  {inlineRefs.map((refId, index) => {
                    const refNode = canvasNodes.find((n) => n.id === refId);
                    if (!refNode) return null;
                    return (
                      <div key={refId} className="canvas-inline-ref-chip" title={refNode.prompt}>
                        <span className="canvas-inline-ref-order">{index + 1}</span>
                        {(refNode.thumbUrl || refNode.objectUrl) && (
                          <img src={refNode.thumbUrl || refNode.objectUrl} alt="" draggable={false} />
                        )}
                        <div className="canvas-inline-ref-actions">
                          <button type="button" title="前移（提交顺序提前）" disabled={index === 0} onClick={() => moveInlineRef(refId, -1)}>
                            ‹
                          </button>
                          <button type="button" title="后移" disabled={index === inlineRefs.length - 1} onClick={() => moveInlineRef(refId, 1)}>
                            ›
                          </button>
                          <button type="button" title="移除引用" onClick={() => setInlineRefs((prev) => prev.filter((id) => id !== refId))}>
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <span className="canvas-panel-hint">右键画布上的图片可「引用为参考图」，顺序即提交顺序</span>
              <textarea
                ref={inlinePromptRef}
                value={inlinePrompt}
                onChange={(e) => setInlinePrompt(e.target.value)}
                onKeyDown={(e) => {
                  // 输入法组合态的回车放行，避免半截拼音提前提交
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitInlineComposer();
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    closeInlineComposer();
                  }
                }}
                placeholder="描述要生成的图片…（Enter 生成，Shift+Enter 换行）"
                rows={3}
              />
              <div className="canvas-inline-composer-params">
                <select value={canvasModel} onChange={(e) => setCanvasModel(e.target.value)} title="模型" aria-label="模型">
                  {selectableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select value={canvasAspectRatio} onChange={(e) => setCanvasAspectRatio(e.target.value)} title="宽高比" aria-label="宽高比">
                  {supportedAspectRatios.map((ratio) => (
                    <option key={ratio} value={ratio}>{ratio}</option>
                  ))}
                </select>
                {canScale && (
                  <select
                    value={canvasResolution}
                    onChange={(e) => setCanvasResolution(e.target.value as ImageResolution)}
                    title="分辨率"
                    aria-label="分辨率"
                  >
                    {(["1K", "2K", "4K"] as const).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                )}
              </div>
              <button
                type="button"
                className="canvas-inline-composer-submit"
                disabled={!inlinePrompt.trim() || canvasAtCapacity || modelState.status !== "ready"}
                title={modelState.status !== "ready" ? "请先在工作台完成模型连接" : ""}
                onClick={submitInlineComposer}
              >
                <WandSparkles size={14} /> {canvasAtCapacity ? "并发已满" : "生成"}
              </button>
            </div>
          )}
        </div>

        {/* 右键菜单：第一项「查看原图」，解决画布上看不清细节的问题 */}
        {contextMenu && !contextMenu.nodeId && (
          <>
            <div className="canvas-context-backdrop" onPointerDown={() => setContextMenu(null)} />
            <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
              <button
                type="button"
                disabled={canvasAtCapacity}
                onClick={() => {
                  // 原地弹出内联输入卡片，不再依赖右侧面板里已有的提示词
                  const at = { x: contextMenu.canvasX ?? 0, y: contextMenu.canvasY ?? 0 };
                  setContextMenu(null);
                  setInlinePrompt("");
                  setInlineComposer(at);
                }}
              >
                <WandSparkles size={14} /> 在此生成
                <small>{canvasAtCapacity ? "并发已满" : ""}</small>
              </button>
              <button type="button" onClick={() => { setContextMenu(null); addNote({ x: contextMenu.canvasX ?? 0, y: contextMenu.canvasY ?? 0 }); }}>
                <StickyNote size={14} /> 添加便签
              </button>
              <button type="button" onClick={() => { setContextMenu(null); fitAllNodes(); }}>
                <Maximize2 size={14} /> 适应全部 <small>⇧⌘F</small>
              </button>
              <button
                type="button"
                disabled={isExportingSnapshot || canvasNodes.length === 0}
                onClick={() => { setContextMenu(null); void exportCanvasSnapshot(); }}
              >
                <DownloadCloud size={14} /> {isExportingSnapshot ? "导出中…" : "导出画布快照"}
              </button>
            </div>
          </>
        )}
        {contextMenu?.nodeId && (() => {
          const node = canvasNodes.find((n) => n.id === contextMenu.nodeId);
          if (!node) return null;
          const ok = node.type === "image" && node.status === "success";
          const group = groupOfNode(node.id);
          return (
            <>
              <div className="canvas-context-backdrop" onPointerDown={() => setContextMenu(null)} />
              <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
                {node.type === "note" && (
                  <button type="button" onClick={() => { setContextMenu(null); markHistory(); setEditingNoteId(node.id); }}>
                    <StickyNote size={14} /> 编辑便签
                  </button>
                )}
                {ok && (
                  <button type="button" onClick={() => viewOriginal(node)}>
                    <Maximize2 size={14} /> 查看原图
                    <small>{node.imageWidth}×{node.imageHeight}</small>
                  </button>
                )}
                {ok && (
                  <button type="button" onClick={() => { setContextMenu(null); enterOptimizeMode(node); }}>
                    <WandSparkles size={14} /> 基于此图优化 <small>E</small>
                  </button>
                )}
                {ok && (
                  <button type="button" onClick={() => { setContextMenu(null); downloadNode(node); }}>
                    <Download size={14} /> 下载原图
                  </button>
                )}
                {ok && (
                  <button type="button" onClick={() => { setContextMenu(null); copyPrompt(node); }}>
                    <Copy size={14} /> 复制提示词
                  </button>
                )}
                {ok && (
                  <button
                    type="button"
                    disabled={canvasRecommending === node.id}
                    onClick={() => { setContextMenu(null); void recommendCanvasNode(node); }}
                  >
                    <Send size={14} /> 推荐到广场
                  </button>
                )}
                {ok && (
                  <button
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      onSendToStudio({ prompt: node.prompt, model: node.model, params: node.params });
                    }}
                  >
                    <ExternalLink size={14} /> 发送到工作台
                  </button>
                )}
                {ok && (
                  <button type="button" onClick={() => { setContextMenu(null); void saveNodeAsRecipe(node); }}>
                    <Save size={14} /> 存为配方
                  </button>
                )}
                {ok && (
                  <button
                    type="button"
                    disabled={canvasAtCapacity}
                    onClick={() => { setContextMenu(null); void rerollSeedFromNode(node); }}
                    title="同提示词同参数重掷一次，得到这张图的同参变体"
                  >
                    <Dices size={14} /> 换种子再来一张
                  </button>
                )}
                {ok && panelMode === "optimize" && optimizeSourceNode && optimizeSourceNode.id !== node.id && (
                  <button type="button" onClick={() => { setContextMenu(null); void addNodeAsExtraRef(node); }}>
                    <ImagePlus size={14} /> 加为优化参考
                  </button>
                )}
                {ok && inlineComposer && (
                  <button type="button" onClick={() => { setContextMenu(null); addNodeToInlineRefs(node); }}>
                    <ImagePlus size={14} /> 引用为参考图（生成模块）
                  </button>
                )}
                <button type="button" onClick={() => { setContextMenu(null); togglePinNode(node); }}>
                  <Pin size={14} /> {node.pinned ? "解除位置锁定" : "锁定位置"}
                </button>
                {node.type === "image" && node.status === "generating" && (
                  <button type="button" onClick={() => { setContextMenu(null); cancelNode(node); }}>
                    <X size={14} /> 取消生成
                  </button>
                )}
                {selectedIds.size > 1 && (
                  <button type="button" onClick={() => { setContextMenu(null); createGroup(); }}>
                    <Group size={14} /> 编组所选 <small>⌘G</small>
                  </button>
                )}
                {group && (
                  <button type="button" onClick={() => { setContextMenu(null); ungroup(group.id); }}>
                    <Group size={14} /> 移出分组「{group.name}」 <small>⇧⌘G</small>
                  </button>
                )}
                {node.status === "error" && (
                  <button type="button" onClick={() => { setContextMenu(null); void retryNode(node); }}>
                    <RefreshCw size={14} /> 重试
                  </button>
                )}
                <button type="button" className="is-danger" onClick={() => { setContextMenu(null); setShowDeleteConfirm(node.id); }}>
                  <Trash2 size={14} /> 删除 <small>Del</small>
                </button>
              </div>
            </>
          );
        })()}

        {/* 生成模块的右键菜单 */}
        {composerMenu && (
          <>
            <div className="canvas-context-backdrop" onPointerDown={() => setComposerMenu(null)} />
            <div className="canvas-context-menu" style={{ left: composerMenu.x, top: composerMenu.y }} role="menu">
              <button type="button" className="is-danger" onClick={closeInlineComposer}>
                <Trash2 size={14} /> 删除生成模块
              </button>
              {inlineRefs.length > 0 && (
                <button type="button" onClick={() => { setInlineRefs([]); setComposerMenu(null); }}>
                  <X size={14} /> 清空全部引用
                </button>
              )}
            </div>
          </>
        )}

        {/* 双图对比（roadmap PRD D4）：A/B 滑块 + 参数 diff */}
        {comparePair && (() => {
          const a = canvasNodes.find((n) => n.id === comparePair[0]);
          const b = canvasNodes.find((n) => n.id === comparePair[1]);
          if (!a?.objectUrl || !b?.objectUrl) return null;
          return <CanvasCompareModal a={a} b={b} onClose={() => setComparePair(null)} />;
        })()}

        {/* 原图查看层：画布节点受 LOD 限制，这里始终加载 objectUrl 原图 */}
        {originalPreview?.objectUrl && (
          <div className="canvas-original-viewer" onPointerDown={() => setOriginalPreview(null)} role="dialog" aria-label="原图查看">
            <img src={originalPreview.objectUrl} alt="" />
            <div className="canvas-original-meta">
              <span>{originalPreview.model}</span>
              <span>{originalPreview.imageWidth}×{originalPreview.imageHeight}</span>
              <button type="button" onClick={() => setOriginalPreview(null)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {canvasLoaded && canvasNodes.length === 0 && (
          <div className="canvas-empty-state">
            <ImagePlus size={48} strokeWidth={1.2} />
            <strong>无限画布</strong>
            <p>在无边的空间中自由创作</p>
            <p className="canvas-empty-hint">在右侧面板输入提示词，图片将生成到画布上。<br />选中图片后可以基于它继续优化。</p>
            <button type="button" className="canvas-empty-action" onClick={() => { setIsPanelOpen(true); promptInputRef.current?.focus(); }}>
              开始第一次生成 <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* Floating toolbar */}
        {selectedIds.size > 1 && toolbarPos && (
          <div
            className="canvas-floating-toolbar"
            style={{ position: "fixed", left: toolbarPos.x, top: toolbarPos.y, transform: "translate(-50%, -100%)" }}
          >
            <span className="canvas-floating-count">已选 {selectedIds.size}</span>
            {(() => {
              // 双图对比（roadmap PRD D4）：恰好选中 2 张成功图片时出现
              const pair = selectedImageNodes();
              return pair.length === 2 && pair.every((n) => n.status === "success" && n.objectUrl) ? (
                <button type="button" onClick={() => setComparePair([pair[0].id, pair[1].id])}>
                  <Maximize2 size={14} /> 对比
                </button>
              ) : null;
            })()}
            <button type="button" onClick={() => void downloadNodes(selectedImageNodes())}>
              <Download size={14} /> 下载 <small>⌘D</small>
            </button>
            <button type="button" onClick={() => copyPrompts(selectedImageNodes())}>
              <Copy size={14} /> 复制提示词 <small>⌘C</small>
            </button>
            <button type="button" onClick={createGroup}>
              <Group size={14} /> 编组 <small>⌘G</small>
            </button>
            <button type="button" onClick={() => setShowDeleteConfirm(selectedNodeId ?? [...selectedIds][0])}>
              <Trash2 size={14} /> 删除
            </button>
          </div>
        )}
        {selectedIds.size <= 1 && selectedNode && toolbarPos && (
          <div
            className="canvas-floating-toolbar"
            style={{ position: "fixed", left: toolbarPos.x, top: toolbarPos.y, transform: "translate(-50%, -100%)" }}
          >
            {selectedNode.type === "note" && (
              <>
                <button type="button" onClick={() => { markHistory(); setEditingNoteId(selectedNode.id); }}>
                  <StickyNote size={14} /> 编辑便签
                </button>
                <button type="button" onClick={() => setShowDeleteConfirm(selectedNode.id)}>
                  <Trash2 size={14} /> 删除
                </button>
              </>
            )}
            {selectedNode.type === "image" && selectedNode.status === "success" && (
              <>
                <button type="button" onClick={() => void enterOptimizeMode(selectedNode)}>
                  <WandSparkles size={14} /> 优化
                </button>
                <button type="button" onClick={() => downloadNode(selectedNode)}>
                  <Download size={14} /> 下载
                </button>
                <button type="button" onClick={() => copyPrompt(selectedNode)}>
                  <Copy size={14} /> 复制提示词
                </button>
                <button
                  type="button"
                  disabled={canvasRecommending === selectedNode.id}
                  onClick={() => void recommendCanvasNode(selectedNode)}
                >
                  <Send size={14} /> {canvasRecommending === selectedNode.id ? "推荐中…" : "推荐到广场"}
                </button>
                <button type="button" onClick={() => setShowDeleteConfirm(selectedNode.id)}>
                  <Trash2 size={14} /> 删除
                </button>
              </>
            )}
            {selectedNode.type === "image" && selectedNode.status === "error" && (
              <>
                <button type="button" onClick={() => void retryNode(selectedNode)}>
                  <RefreshCw size={14} /> 重试
                </button>
                <button type="button" onClick={() => copyErrorText(selectedNode)}>
                  <Copy size={14} /> 复制错误
                </button>
                <button type="button" onClick={() => setShowDeleteConfirm(selectedNode.id)}>
                  <Trash2 size={14} /> 删除
                </button>
              </>
            )}
            {selectedNode.type === "image" && selectedNode.status === "generating" && (
              <button type="button" onClick={() => cancelNode(selectedNode)}>
                <X size={14} /> 取消生成
              </button>
            )}
          </div>
        )}

        {/* Zoom bar */}
        <div className="canvas-history-bar">
          <button type="button" onClick={undo} disabled={!canUndo} title="撤销 (⌘Z)" aria-label="撤销">
            <Undo2 size={15} />
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} title="重做 (⇧⌘Z)" aria-label="重做">
            <Redo2 size={15} />
          </button>
          <button type="button" onClick={() => addNote()} title="添加便签" aria-label="添加便签">
            <StickyNote size={15} />
          </button>
          <button
            type="button"
            onClick={() => void exportCanvasSnapshot()}
            disabled={isExportingSnapshot || canvasNodes.length === 0}
            title="导出画布快照"
            aria-label="导出画布快照"
          >
            <DownloadCloud size={15} />
          </button>
          {selectedIds.size > 1 && <span className="canvas-selection-count">已选 {selectedIds.size}</span>}
        </div>
        <div className="canvas-zoom-bar">
          <button type="button" onClick={() => { const nz = clampZoomVal(viewport.zoom / 1.2); zoomAtCenter(nz); }}>-</button>
          <input
            type="range"
            min={10}
            max={300}
            step={5}
            value={Math.round(viewport.zoom * 100)}
            onChange={(e) => zoomAtCenter(Number(e.target.value) / 100)}
          />
          <span className="canvas-zoom-label">{Math.round(viewport.zoom * 100)}%</span>
          <button type="button" onClick={() => { const nz = clampZoomVal(viewport.zoom * 1.2); zoomAtCenter(nz); }}>+</button>
          <button type="button" onClick={fitAllNodes} title="适应全部节点">
            <Maximize2 size={15} />
          </button>
        </div>

        {/* Minimap */}
        {isMinimapVisible && minimapData && (
          <div
            className="canvas-minimap"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = (e.clientX - rect.left) / minimapData.scale + minimapData.minX;
              const my = (e.clientY - rect.top) / minimapData.scale + minimapData.minY;
              setViewport((v) => ({
                ...v,
                x: mx - minimapData.vpW / 2,
                y: my - minimapData.vpH / 2,
              }));
            }}
          >
            {canvasNodes.map((n) => (
              <div
                key={n.id}
                className={`canvas-minimap-node ${n.type === "note" ? "note" : n.status} ${n.id === selectedNodeId ? "selected" : ""}`}
                style={{
                  left: (n.x - minimapData.minX) * minimapData.scale,
                  top: (n.y - minimapData.minY) * minimapData.scale,
                  width: Math.max(4, n.width * minimapData.scale),
                  height: Math.max(4, n.height * minimapData.scale),
                }}
              />
            ))}
            <div
              className="canvas-minimap-viewport"
              style={{
                left: (viewport.x - minimapData.minX) * minimapData.scale,
                top: (viewport.y - minimapData.minY) * minimapData.scale,
                width: minimapData.vpW * minimapData.scale,
                height: minimapData.vpH * minimapData.scale,
              }}
            />
          </div>
        )}
      </div>

      {/* Right panel */}
      <aside className={`canvas-right-panel ${isPanelOpen ? "open" : "closed"}`}>
        {panelMode === "generate" ? (
          <>
            <div className="canvas-panel-header">
              <strong>画布生成</strong>
              <button type="button" className="icon-button" onClick={() => setIsPanelOpen(false)} title="收起面板">
                <PanelRightClose size={16} />
              </button>
            </div>

            {/* 选中节点状态区（PRD §5.4）：失败给错误详情与重试，生成中给取消 */}
            {selectedNode && selectedNode.type === "image" && selectedNode.status === "error" && (
              <div className="canvas-panel-status is-error">
                <strong>这张图生成失败</strong>
                <p>{selectedNode.error || "未知错误"}</p>
                <div className="canvas-panel-status-actions">
                  <button type="button" className="subtle-button" onClick={() => void retryNode(selectedNode)}>
                    <RefreshCw size={14} /> 重试
                  </button>
                  <button type="button" className="subtle-button" onClick={() => copyErrorText(selectedNode)}>
                    <Copy size={14} /> 复制错误
                  </button>
                  <button type="button" className="subtle-button" onClick={() => setShowDeleteConfirm(selectedNode.id)}>
                    <Trash2 size={14} /> 删除
                  </button>
                </div>
              </div>
            )}
            {selectedNode && selectedNode.type === "image" && selectedNode.status === "generating" && (
              <div className="canvas-panel-status">
                <strong>正在生成…</strong>
                <p>任务在服务端队列中执行，关闭页面也不会丢失。</p>
                <div className="canvas-panel-status-actions">
                  <button type="button" className="subtle-button" onClick={() => cancelNode(selectedNode)}>
                    <X size={14} /> 取消生成
                  </button>
                </div>
              </div>
            )}

            {/* Model selector */}
            <div className="canvas-panel-section">
              <label className="canvas-panel-label">模型</label>
              <select
                className="canvas-select"
                value={canvasModel}
                onChange={(e) => setCanvasModel(e.target.value)}
              >
                {selectableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className="canvas-panel-hint">{imageModelLaneLabel(canvasModel)}</span>
            </div>

            {/* 配方（roadmap PRD B2）：与工作台共用，同步应用提示词与参数 */}
            {canvasRecipes.length > 0 && (
              <div className="canvas-panel-section">
                <label className="canvas-panel-label">配方</label>
                <select
                  className="canvas-select"
                  value=""
                  onChange={(e) => {
                    const recipe = canvasRecipes.find((r) => r.id === e.target.value);
                    if (recipe) applyRecipeToCanvas(recipe);
                  }}
                >
                  <option value="">选择配方应用…</option>
                  {canvasRecipes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} · {r.model}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Prompt */}
            <div className="canvas-panel-section">
              <label className="canvas-panel-label">提示词</label>
              <textarea
                ref={promptInputRef}
                className="canvas-prompt-input"
                value={canvasPrompt}
                onChange={(e) => setCanvasPrompt(e.target.value)}
                placeholder="描述你想生成的图片..."
                rows={4}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleCanvasGenerate();
                  }
                }}
              />
            </div>

            {/* Params */}
            <details className="canvas-panel-details" open>
              <summary>参数</summary>
              <div className="canvas-params-grid">
                <div className="canvas-param">
                  <label>宽高比</label>
                  <select
                    className="canvas-select"
                    value={canvasAspectRatio}
                    onChange={(e) => setCanvasAspectRatio(e.target.value)}
                  >
                    {supportedAspectRatios.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="canvas-param">
                  <label>分辨率</label>
                  <select
                    className="canvas-select"
                    value={canvasResolution}
                    onChange={(e) => setCanvasResolution(e.target.value as ImageResolution)}
                    disabled={!canScale}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                </div>
                {canvasExplicitSizeOptions.length > 0 && (
                  <div className="canvas-param">
                    <label>尺寸</label>
                    <select
                      className="canvas-select"
                      value={resolvedSize}
                      onChange={(e) => {
                        const option = gptImage2SizeOptionForSize(e.target.value);
                        if (!option) return;
                        setCanvasAspectRatio(option.aspectRatio);
                        setCanvasResolution(option.resolution);
                        setCanvasSize(option.size);
                      }}
                    >
                      {canvasExplicitSizeOptions.map((option) => (
                        <option key={option.size} value={option.size}>
                          {option.size}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="canvas-param">
                  <label>质量</label>
                  <select
                    className="canvas-select"
                    value={canvasQuality}
                    onChange={(e) => setCanvasQuality(e.target.value)}
                  >
                    <option value="auto">auto</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
              </div>
            </details>

            {/* Size preview */}
            <div className="canvas-size-preview">
              {resolvedSize} &middot; {selectedCanvasSizeOption?.label || imageModelLaneLabel(canvasModel)}
            </div>

            {/* Generate button */}
            <button
              type="button"
              className="canvas-generate-btn"
              disabled={!canvasPrompt.trim() || !isApiReady || isGenerating}
              onClick={() => void handleCanvasGenerate()}
            >
              {isGenerating ? <><Loader2 size={16} className="spin" /> 生成中...</> : "生成到画布"}
            </button>

            {!isApiReady && (
              <div className="canvas-api-hint">
                请先在工作台配置 API Key 并验证连接
                <button type="button" className="link-button" onClick={onEnterStudio}>前往配置</button>
              </div>
            )}

            {/* Selected node info */}
            {selectedNode && selectedNode.type === "image" && selectedNode.status === "success" && panelMode === "generate" && (
              <div className="canvas-panel-section canvas-selected-hint">
                <span>已选中图片</span>
                <button type="button" className="canvas-optimize-entry" onClick={() => void enterOptimizeMode(selectedNode)}>
                  <WandSparkles size={14} /> 基于此图优化
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Optimize mode */}
            <div className="canvas-panel-header">
              <button type="button" className="canvas-back-btn" onClick={() => {
                setPanelMode("generate");
                setOptimizeSourceNode(null);
                setCompressedRef(null);
              }}>
                &larr; 返回
              </button>
              <strong>优化图片</strong>
            </div>

            {/* Reference preview */}
            {compressedRef && (
              <div className="canvas-ref-preview">
                <img src={compressedRef.dataUrl} alt="" />
                <span className="canvas-ref-info">已自动压缩为参考图 &middot; {formatBytes(compressedRef.size)}</span>
              </div>
            )}
            {!compressedRef && optimizeSourceNode && (
              <div className="canvas-ref-preview loading">
                <Loader2 size={20} className="spin" />
                <span>压缩参考图中...</span>
              </div>
            )}

            {/* Original prompt */}
            {optimizeSourceNode && (
              <div className="canvas-panel-section">
                <label className="canvas-panel-label">原始提示词</label>
                <div className="canvas-original-prompt">{optimizeSourceNode.prompt}</div>
              </div>
            )}

            {/* Supplementary prompt */}
            <div className="canvas-panel-section">
              <label className="canvas-panel-label">补充优化提示词</label>
              <textarea
                ref={optimizePromptRef}
                className="canvas-prompt-input"
                value={optimizePrompt}
                onChange={(e) => setOptimizePrompt(e.target.value)}
                placeholder="描述你想要的修改，如：改为夜景、增加雪花效果..."
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleCanvasOptimize();
                  }
                }}
              />
            </div>

            {/* Model & params */}
            <div className="canvas-panel-section">
              <label className="canvas-panel-label">模型</label>
              <select
                className="canvas-select"
                value={canvasModel}
                onChange={(e) => setCanvasModel(e.target.value)}
              >
                {selectableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div className="canvas-params-grid">
              <div className="canvas-param">
                <label>宽高比</label>
                <select
                  className="canvas-select"
                  value={canvasAspectRatio}
                  onChange={(e) => setCanvasAspectRatio(e.target.value)}
                >
                  {supportedAspectRatios.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="canvas-param">
                <label>分辨率</label>
                <select
                  className="canvas-select"
                  value={canvasResolution}
                  onChange={(e) => setCanvasResolution(e.target.value as ImageResolution)}
                  disabled={!canScale}
                >
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </div>
              {canvasExplicitSizeOptions.length > 0 && (
                <div className="canvas-param">
                  <label>尺寸</label>
                  <select
                    className="canvas-select"
                    value={resolvedSize}
                    onChange={(e) => {
                      const option = gptImage2SizeOptionForSize(e.target.value);
                      if (!option) return;
                      setCanvasAspectRatio(option.aspectRatio);
                      setCanvasResolution(option.resolution);
                      setCanvasSize(option.size);
                    }}
                  >
                    {canvasExplicitSizeOptions.map((option) => (
                      <option key={option.size} value={option.size}>
                        {option.size}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 追加参考图（roadmap PRD D6）：右键其他成功节点「加为优化参考」后显示在这里 */}
            {extraRefs.length > 0 && (
              <div className="canvas-panel-section">
                <label className="canvas-panel-label">追加参考（风格融合）</label>
                <div className="canvas-extra-refs">
                  {extraRefs.map((ref) => (
                    <div key={ref.nodeId} className="canvas-extra-ref-chip" title={ref.prompt}>
                      <img src={ref.dataUrl} alt="" />
                      <button
                        type="button"
                        title="移除该参考"
                        onClick={() => setExtraRefs((prev) => prev.filter((r) => r.nodeId !== ref.nodeId))}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {panelMode === "optimize" && extraRefs.length < 2 && (
              <span className="canvas-panel-hint">提示：右键画布上其他成功图片可「加为优化参考」（最多 2 张）</span>
            )}

            {/* 扇形变体数量（roadmap PRD D2） */}
            <div className="canvas-panel-section">
              <label className="canvas-panel-label">生成数量（扇形分支）</label>
              <div className="canvas-fanout-picker" role="radiogroup" aria-label="生成数量">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={optimizeCount === n ? "is-active" : ""}
                    aria-pressed={optimizeCount === n}
                    onClick={() => setOptimizeCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Size preview */}
            <div className="canvas-size-preview">
              {resolvedSize} &middot; {selectedCanvasSizeOption?.label || imageModelLaneLabel(canvasModel)}
            </div>

            {/* Optimize button */}
            <button
              type="button"
              className="canvas-generate-btn"
              disabled={!compressedRef || !isApiReady || isGenerating}
              onClick={() => void handleCanvasOptimize()}
            >
              {isGenerating
                ? <><Loader2 size={16} className="spin" /> 优化中...</>
                : optimizeCount > 1 ? `生成 ${optimizeCount} 个分支` : "生成优化"}
            </button>
          </>
        )}
      </aside>

      {/* Panel expand button when collapsed */}
      {!isPanelOpen && (
        <button type="button" className="canvas-panel-expand" onClick={() => setIsPanelOpen(true)}>
          <PanelRightOpen size={18} />
        </button>
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="canvas-toast">{toastMessage}</div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (() => {
        // 与 confirmDeleteNode 同口径：命中多选就是整块删
        const count = selectedIds.has(showDeleteConfirm) && selectedIds.size > 1 ? selectedIds.size : 1;
        return (
          <div className="canvas-dialog-overlay" onClick={() => setShowDeleteConfirm(null)}>
            <div className="canvas-dialog" onClick={(e) => e.stopPropagation()}>
              <p>{count > 1 ? `确认删除选中的 ${count} 个节点？` : "确认删除此图片？"}此操作可用 ⌘Z 撤销。</p>
              <div className="canvas-dialog-actions">
                <button type="button" className="subtle-button" onClick={() => setShowDeleteConfirm(null)}>取消</button>
                <button type="button" className="canvas-dialog-danger" onClick={() => confirmDeleteNode(showDeleteConfirm)}>删除</button>
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}

// 双图对比（roadmap PRD D4）：A/B 滑块 + 参数 diff。
// 滑块用 clip-path 裁上层图，拖动只改一个 CSS 变量，不触发布局。
function CanvasCompareModal({ a, b, onClose }: { a: CanvasNode; b: CanvasNode; onClose: () => void }) {
  const [split, setSplit] = useState(50);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const rows: Array<{ label: string; va: string; vb: string }> = [
    { label: "模型", va: a.model, vb: b.model },
    { label: "宽高比", va: a.params.aspectRatio, vb: b.params.aspectRatio },
    { label: "尺寸", va: a.params.size, vb: b.params.size },
    { label: "分辨率", va: String(a.params.resolution), vb: String(b.params.resolution) },
    { label: "质量", va: a.params.quality, vb: b.params.quality },
  ];

  return (
    <div className="canvas-compare-modal" role="dialog" aria-modal="true" aria-label="双图对比">
      <button className="preview-backdrop" type="button" aria-label="关闭对比" onClick={onClose} />
      <div className="canvas-compare-shell">
        <div className="canvas-compare-head">
          <strong>双图对比</strong>
          <span>A（左）为先选的一张 · 拖动滑杆</span>
          <button type="button" className="icon-button" onClick={onClose} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="canvas-compare-stage">
          <img src={b.objectUrl} alt="B" draggable={false} />
          <img
            src={a.objectUrl}
            alt="A"
            draggable={false}
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          <div className="canvas-compare-divider" style={{ left: `${split}%` }} />
          <span className="canvas-compare-tag is-a">A</span>
          <span className="canvas-compare-tag is-b">B</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label="对比分割位置"
        />
        <div className="canvas-compare-diff">
          {rows.map((row) => (
            <div key={row.label} className={`canvas-compare-row ${row.va !== row.vb ? "is-diff" : ""}`}>
              <span>{row.label}</span>
              <strong>{row.va || "-"}</strong>
              <strong>{row.vb || "-"}</strong>
            </div>
          ))}
          {a.prompt !== b.prompt && (
            <div className="canvas-compare-row is-diff canvas-compare-prompts">
              <span>提示词</span>
              <strong title={a.prompt}>{a.prompt}</strong>
              <strong title={b.prompt}>{b.prompt}</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
