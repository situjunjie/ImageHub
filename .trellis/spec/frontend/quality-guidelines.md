# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

### Browser API Compatibility

Feature-detect browser APIs that are not guaranteed in every supported runtime before using them.

**Problem**: Direct calls such as `crypto.randomUUID()` can crash app initialization in browsers or contexts where the method is unavailable.

**Required behavior**:
- Check the method exists before calling it.
- Prefer the stronger compatible API when available, such as `crypto.getRandomValues()` for ID generation.
- Provide a narrow fallback for non-security-sensitive identifiers so the UI can still load.

```typescript
function uid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
```

### Deployment Host Allowlist

#### 1. Scope / Trigger
- Trigger: Vite dev or preview servers are exposed behind a deployment domain or reverse proxy.

#### 2. Signatures
- Configure `server.allowedHosts` and `preview.allowedHosts` in `vite.config.ts`.

#### 3. Contracts
- `allowedHosts` must be a string array of explicit hostnames such as `["ai-img.gigimed.cn"]`.
- Avoid `allowedHosts: true` because it allows any Host header.

#### 4. Validation & Error Matrix
- Missing deployed hostname -> Vite returns "Blocked request. This host (...) is not allowed."
- Host configured only under `server` -> `vite preview` deployments can still reject the domain.

#### 5. Good/Base/Bad Cases
- Good: A shared constant is assigned to both `server.allowedHosts` and `preview.allowedHosts`.
- Base: Localhost and IP access continue to work through Vite defaults.
- Bad: Disabling host validation globally with `allowedHosts: true`.

#### 6. Tests Required
- Run `npm run build` to verify the config is type-compatible with the installed Vite version.
- For deployment incidents, restart the Vite process and request the deployed domain once to confirm the block is gone.

#### 7. Wrong vs Correct

Wrong:
```typescript
server: {
  allowedHosts: true,
}
```

Correct:
```typescript
const ALLOWED_HOSTS = ["ai-img.gigimed.cn"];

server: {
  allowedHosts: ALLOWED_HOSTS,
}

preview: {
  allowedHosts: ALLOWED_HOSTS,
}
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
