# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product

ImageHub / Image Studio (`codex-image-batch-studio` in package.json) — a local-first batch image-generation workbench. The user fills in an upstream API URL + key, picks an `image-2`-class model, and submits batches; results stay in-browser via IndexedDB. Three major feature surfaces: **Studio** (batch generation), **Square** (community gallery with recommend/like), and **Agent Mode A** (NLP-driven brochure planning). Admin dashboard tracks request metadata only — no image data, URLs, base64, or API keys are persisted server-side. README.md (Chinese) is the canonical product spec; `docs/agent-mode-brochure-prd.md` is the Agent Mode A spec.

## Commands

```bash
npm install          # one-time
npm run dev          # Vite dev server on http://localhost:8877 (port hardcoded)
npm run build        # tsc -b && vite build  — TypeScript check is gated here
npm run preview      # serve the production build, also on :8877
```

There is **no test framework, ESLint, Prettier, Biome, or pre-commit hook** in this repo — don't go hunting for them. There is no standalone `typecheck` script either; `tsc -b` runs as part of `npm run build`. Use that to check types.

Admin defaults: `admin` / `admin123456` at `http://localhost:8877/#admin`. Override via env: `ADMIN_USERNAME=... ADMIN_INITIAL_PASSWORD=... npm run dev`.

## Architecture — the non-obvious parts

**The entire backend lives inside `vite.config.ts`** (~4200 lines). It registers a custom Vite plugin whose `configureServer` middleware implements every `/api/*` route. There is no `server/`, `api/`, or `backend/` directory. When the task involves request logging, admin auth, the upstream proxy, or reference-image temp URLs, edit `vite.config.ts`, not files under `src/`.

Server-side route groups:
- `/api/models`, `/api/images/generate`, `/api/temp-reference/:id` — core generation proxy.
- `/api/admin/*` (login, logout, change-password, stats, requests, me) — admin dashboard.
- `/api/square/*` (feed, quota, recommend, like, image/:id, admin/overview, admin/export) — community gallery. Data persisted to `.data/square-store.json`. Feed/quota GET endpoints authenticate via `x-imagehub-api-key` header (not query params). Thumbnails are served as binary from `/api/square/image/:id` with long cache headers — the feed response returns `thumbnailUrl` (not inline base64).
- `/api/agent/analyze` — Agent Mode A intent classification (single_image, multi_image_batch, brochure_project, page_refine).

**The entire frontend lives inside `src/App.tsx`** (~9700 lines). One monolithic component handles home, studio, square, and admin views via a `mainPage` state switch (`"home" | "studio" | "square" | "admin"`) — there is no router, no Redux/Zustand, no React Context for app state. State is `useState` + `useRef` (the generation queue uses `pendingQueueRef` deliberately to avoid re-renders mid-pump). Styles are in `src/styles.css` (~7200 lines) as plain CSS with custom properties.

**Square (community gallery):** users can recommend generated images to a shared feed. Browse by latest/hot/top; daily quotas (10 recommends, 10 likes). Admin has overview + CSV/JSON export. Square state is server-persisted in `.data/square-store.json`, not IndexedDB.

**Agent Mode A (brochure workflow):** toggleable mode that NLP-parses the prompt into an intent (single image → direct generation, multi-image batch → parallel generation, brochure project → multi-page planning with style-board selection). Brochure flow: analyze → plan → generate 4 style boards → user picks one → refine individual pages. Key state: `isAgentModeEnabled`, `agentModeState`, `agentModePendingPlan`, `agentModeBrochureDraft`.

**Generation pipeline:**
1. Client builds `Job` objects, pushes them onto `pendingQueueRef.current`, and `pumpQueue()` drains them respecting client-side `concurrency` (1–6).
2. Each job POSTs to `/api/images/generate` with `{ baseUrl, apiKey, request: { protocol, model, prompt, referenceImages, aspectRatio, seed, ... } }`.
3. Reference images are sent as data URLs; the Vite middleware stashes them in an in-memory `temporaryReferences` Map with a ~10-minute TTL, generates `/api/temp-reference/{id}` URLs, and forwards those URLs (not base64) to the upstream `/v1/images/generations` endpoint.
4. Server logs request *metadata only* — `requestId`, prompt, model, params, status, duration, error class — to `.data/admin-store.json`. Never the API key, never image data, never image URLs.
5. Client receives the result, stores the Blob + history record in IndexedDB. Server-side never sees the generated image again.

**Hard whitelists (enforced both client- and server-side):**
- API base URL must be `https://www.taijiai.online/` or `https://bobdong.cn/` — hardcoded in `vite.config.ts`.
- Model name must be `gpt-image-2`, `gpt-5.4-image-2`, or contain `image-2`.

If a task seems to require loosening either whitelist, confirm with the user — these are deliberate product constraints, not oversights.

**Admin auth:** scrypt-hashed password persisted in `.data/admin-store.json`; in-memory session map with ~8h TTL; cookie-based. The first login forces a password reset.

**Frontend version banner:** `vite.config.ts` computes `FRONTEND_BUILD_VERSION` from the latest mtime across `src/`, `vite.config.ts`, and `package.json`; the client polls `/build-version.json` to detect deploys. Don't strip this if you're refactoring the config.

## Local-first invariant — do not break

The privacy model is load-bearing for this product (README §数据与隐私策略). When adding features that touch the server side:
- Never log API keys (the existing code logs only `apiKeyPresent`, `apiKeyLength`, and a 4-char prefix).
- Never persist image bytes, image URLs, base64, or reference-image content to disk or to admin logs.
- Anything image-related stays in browser IndexedDB.

If a change would require crossing this line, raise it with the user before implementing.

## Repo layout

- `src/App.tsx` — all UI + client logic (home, studio, square, admin).
- `src/main.tsx` — React mount point.
- `src/styles.css` — global CSS.
- `src/assets/` — logo + screenshot images used by the home page.
- `vite.config.ts` — Vite config **and** the entire backend middleware.
- `docs/agent-mode-brochure-prd.md` — Agent Mode A product spec (canonical).
- `docs/screenshots/` — README screenshots (committed).
- `.data/admin-store.json` — runtime admin + request-log store; gitignored.
- `.data/square-store.json` — community gallery data; gitignored.
- `dist/`, `node_modules/`, `generated_images/`, `screenshot-*.png` — gitignored.
