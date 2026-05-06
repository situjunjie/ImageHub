# Restrict API URL to Gigimed AI

## Goal

Limit the image generation site's selectable API URL to the single Gigimed AI endpoint `https://ai.gigimed.cn/`, so users can no longer choose the old two service addresses.

## What I Already Know

* The current frontend selector is backed by `ALLOWED_API_ENDPOINTS` in `src/App.tsx`.
* The server-side proxy validates incoming `baseUrl` values against `ALLOWED_API_BASE_URLS` in `vite.config.ts`.
* README currently documents the older two-entry API URL choice.

## Requirements

* Replace the existing selectable API URL list with a single option:
  * label: `有济AI`
  * value: `https://ai.gigimed.cn/`
* Make `https://ai.gigimed.cn/` the default API URL.
* Ensure the server-side allowlist accepts only `https://ai.gigimed.cn/`.
* Keep URL normalization behavior compatible with stored values that may include or omit a trailing slash.
* Update user-facing documentation that describes the allowed API entry.

## Acceptance Criteria

* [ ] The API URL dropdown renders only `有济AI · https://ai.gigimed.cn/`.
* [ ] Previously stored old API URLs normalize back to the new default instead of remaining selectable.
* [ ] Proxy requests using old URLs fail allowlist validation.
* [ ] README no longer documents the old two endpoints as allowed choices.
* [ ] Project lint/type-check passes.

## Out of Scope

* Changing generation protocols, model behavior, or API key handling.
* Migrating request logs/history that may already contain old endpoint strings.
* Changing application site/reference-host settings such as `PUBLIC_REFERENCE_BASE_URL`; this task only changes the AI API base URL users can select and submit.

## Technical Notes

* Relevant files discovered: `src/App.tsx`, `vite.config.ts`, `README.md`.
* Spec context: `.trellis/spec/frontend/index.md`.
