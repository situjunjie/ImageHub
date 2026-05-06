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

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
