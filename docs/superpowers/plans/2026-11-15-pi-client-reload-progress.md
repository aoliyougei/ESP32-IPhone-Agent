# Progress — docs/superpowers/plans/2026-11-15-pi-client-reload.md

- Ruling: implement in existing workspace as explicitly approved; preserve unrelated untracked files. No commit/push, no subagents (operator-approved inline execution).
- Ruling: do not run skill bookkeeping scripts locally because project execution is Docker-only; record progress directly here.
- Preflight: client rename consumed by index.ts and mjs tests; test commands changed to tsx for TS-importing tests, loader regressions remain native Node.
- Task 1 complete: reload.test.mjs RED on real mjs dependency for both fsCache variants (entry after, status old). Migrated to client.ts, added minimal TS annotations. GREEN for default fsCache and false. Negative mjs control remains reproducible.
- Task 2 complete: runtime-compatibility.test.mjs RED with plain TypeError, GREEN with narrow missing-method guard and original TypeError cause. Mock client failures HTTP 503 and invalid response retain their messages without compatibility wrapping. No requests/actions performed.
- Ruling: use temporary fixture containing actual entry source and mock relative client rather than Jiti virtualModules absolute-path override; experiment showed that override did not replace the relative dependency. Fixture now blocks unexpected global fetch and asserts zero calls.
- Task 3 complete: README documents migration, one-time old-mjs RPC restart, native ESM cache limitation, upstream reproduction and test commands. No temporary diagnostic exists in checkout; no target deployment touched.
- Verification: initial environment resolved Jiti 2.7.0, tests passed. Explicitly pinned Jiti 2.6.1 and Pi 1.2.0 companion packages in Docker, same 15 tests and tsc passed. Test dependency audit reports 3 vulnerabilities (2 moderate, 1 high); no force upgrades.
- Final review: self-review (operator requested inline/no subagents). Checked rename references, no random query imports, no PID/hostname diagnostics in normal result, no real phone requests; unrelated files preserved. Additional HTTP cause assertion added.
- Remaining limit: generic third-party native ESM dependencies still need host-level invalidation/isolation; ts migration does not promise all host reload implementations work.
