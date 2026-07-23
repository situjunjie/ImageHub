// ImageHub 生产服务器：托管 dist/ 静态资源 + 全部 /api/* 路由（与 Vite 开发模式共用同一份路由实现）
// 构建：npm run build && npm run build:server
// 启动：node server-dist/index.mjs  （PORT 环境变量可改端口，默认 8877）
import { readFileSync, statSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { registerApiRoutes } from "../vite.config";

const PORT = Number(process.env.PORT || 8877) || 8877;
const HOST = process.env.HOST || "0.0.0.0";
const DIST_DIR = resolve(process.cwd(), "dist");

// ── connect 风格的前缀路由：剥离挂载前缀后调用处理器（与 Vite dev 行为一致） ──
type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
const routes: Array<{ prefix: string; handler: RouteHandler }> = [];
registerApiRoutes({
  use(path: string, handler: RouteHandler) {
    routes.push({ prefix: path.replace(/\/+$/, "") || "/", handler });
  },
});

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }
  let relative = pathname === "/" ? "/index.html" : pathname;
  try {
    relative = decodeURIComponent(relative);
  } catch {
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }
  let filePath = resolve(join(DIST_DIR, relative));
  // 防路径穿越 + SPA 回退（hash 路由，未知路径一律回 index.html）
  if (!filePath.startsWith(DIST_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST_DIR, "index.html");
    if (!existsSync(filePath)) {
      res.statusCode = 503;
      res.end("前端产物不存在，请先执行 npm run build");
      return;
    }
  }
  const ext = extname(filePath).toLowerCase();
  const isAsset = filePath.includes(`${DIST_DIR}/assets/`) || filePath.startsWith(join(DIST_DIR, "assets"));
  const isIndex = filePath.endsWith("index.html");
  const isBuildVersion = filePath.endsWith("build-version.json");
  const bytes = readFileSync(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
  res.setHeader("Content-Length", String(bytes.length));
  // 带 hash 的静态资源永久缓存；index.html 与 build-version.json 不缓存（保证版本横幅生效）
  if (isIndex || isBuildVersion) {
    res.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
  } else if (isAsset) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "public, max-age=300");
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(bytes);
}

const server = createServer((req, res) => {
  const url = req.url || "/";
  const queryIndex = url.indexOf("?");
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : url.slice(queryIndex);

  if (pathname === "/healthz") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
    return;
  }

  // API 路由：按注册顺序做前缀匹配，剥离前缀后调用（与 connect 挂载语义一致）
  for (const route of routes) {
    if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
      const remainder = pathname.slice(route.prefix.length) || "/";
      req.url = remainder + query;
      Promise.resolve(route.handler(req, res)).catch((error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        try {
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        } catch {
          // 响应已结束
        }
      });
      return;
    }
  }

  // 未匹配的 /api/* 返回 404 JSON，其余走静态托管
  if (pathname.startsWith("/api/")) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`[imagehub] 生产服务器已启动 http://${HOST}:${PORT} （静态目录: ${DIST_DIR}）`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[imagehub] 收到 ${signal}，正在退出...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
