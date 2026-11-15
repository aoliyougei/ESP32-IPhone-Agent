# Pi Client Reload Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure entry and PhoneClient refresh together during same-process Pi reload, with actionable compatibility errors.

**Architecture:** Migrate the relative client dependency from client.mjs to client.ts, verified using Jiti 2.6.1-style loading with moduleCache:false. Keep HTTP behavior unchanged. Guard only missing detection methods, preserving cause; do not relabel HTTP/schema errors as cache errors.

**Tech Stack:** Pi 1.2.0, Jiti, Node 22, tsx, node:test; all execution in Docker.

**Spec:** Operator's detailed runtime evidence and five requested optimization areas in the current conversation.

## Global Constraints
- No real phone APIs, actions, calibration, stop, service restarts, pushes or tagging.
- No random query-string module imports.
- Preserve existing unrelated files and changes.
- No internal runtime paths/hostname in normal tool results.
- Keep existing mjs tests executable through tsx after their import is migrated.

## Review Focus
- Old mjs migration: document one-time RPC restart if existing runtime still binds old modules.
- Same-process regression must prove dependency updates, not merely entry changes.
- HTTP errors preserve their original classification and cause.
- Client runtime guard must not issue requests or retry missing methods.
- Future dependency regression: tests must derive the dependency filename from the real extension import.

## Pre-implementation experiment (completed)
Docker probe creates temporary old/new entry and dependency files and imports twice using new Jiti instances, moduleCache:false and fsCache:false, without restarting Node.
- mjs: entry after, client status old, detection undefined.
- ts: entry after, client status new, detection function.
Current checkout has no esp32-detection-runtime-v1 marker or tracked diagnostic diff. Do not assume another deployment's temporary edits exist here.

### Task 1: Client migration and same-process regression
**Files:** pi-extension/client.mjs -> client.ts; index.ts; client.test.mjs; detection.test.mjs; new reload.test.mjs.
**Interfaces:** PhoneClient API and HTTP routes unchanged; entry imports ./client.ts.
- [ ] Write regression using real entry's relative client import to choose fixture suffix. Load old entry/client, rewrite both, create new Jiti with actual loader options and assert new entry and detection function. Include reproducible mjs negative control with fsCache:false.
- [ ] Run against mjs dependency and inspect expected stale-client failure.
- [ ] Migrate dependency to ts; add minimal types needed by noEmit without altering request behavior; update test imports.
- [ ] Run regression in same process with default fsCache and disabled fsCache; both must pass for ts.

### Task 2: Missing-method compatibility error
**Files:** index.ts, analysis.test.ts or new runtime-compatibility.test.ts.
**Interface:** Missing detection method throws Error with original TypeError as cause, upgrade/restart guidance, no filesystem/runtime identity disclosure.
- [ ] Write test loading mocked old client through Jiti alias; detection fails with actionable message and TypeError cause, no request/action. Separately assert ordinary HTTP/schema errors are not relabeled.
- [ ] Add narrow typeof guard immediately before detection invocation, not broad wrapping of all detection failures.
- [ ] Verify tests and existing HTTP error/no-retry behavior.

### Task 3: Upgrade docs and full verification
**Files:** README.md; any affected test commands.
- [ ] Replace client.mjs references and document tsx execution for mjs tests importing TS.
- [ ] Explain session reload versus process restart, one-time old-mjs recovery, and host-level ESM invalidation limitation. Include minimal reproduction commands/test reference for upstream.
- [ ] Inspect/remove diagnostic marker only if present; current checkout has none.
- [ ] In Docker run all *.test.mjs and *.test.ts with tsx plus existing TypeScript noEmit. Inspect output; report dependency audit findings separately.
- [ ] git diff --check and scoped diff review. No commit/push without additional operator request.
