# Rough-Cut Automation: Known Repo-Wide Test Issues

This note classifies repo-wide test/type failures observed while validating the
OpenCut rough-cut automation. It is diagnostic only; no renderer, export, WASM,
timeline, or action-system fixes were attempted.

## Current Rough-Cut Status

The focused rough-cut automation tests pass, the filtered TypeScript check for
rough-cut/MCP files is clean, and the MCP stdio server lists all five rough-cut
tools successfully.

## Failing Repo-Wide Tests

The full `bun test` run currently fails outside the rough-cut/MCP code:

- `apps/web/src/timeline/__tests__/update-pipeline.test.ts`
  - Fails while importing `opencut-wasm`.
  - Error: `wasm.__wbindgen_start is not a function`.
  - Classification: likely local test runtime / WASM package initialization
    issue, or upstream WASM packaging/test-environment issue.

- `apps/web/src/masks/__tests__/snap.test.ts`
  - Fails while importing timeline creation code via `@/wasm`.
  - Error: `Cannot access 'TICKS_PER_SECOND' before initialization`.
  - Classification: likely upstream module initialization/order issue around
    the WASM/time exports.

- `apps/web/src/actions/keybindings/__tests__/persistence.test.ts`
  - Fails while importing `apps/web/src/actions/index.ts`.
  - Error: `Export named 'isActionWithOptionalArgs' not found`.
  - Classification: upstream action/keybinding export mismatch.

- `apps/web/src/timeline/placement/__tests__/resolve.test.ts`
  - Several tests fail when test builders reference `ZERO_MEDIA_TIME`.
  - Error: `Cannot access 'ZERO_MEDIA_TIME' before initialization`.
  - Classification: likely upstream module initialization/order issue around
    timeline media-time constants.

## TypeScript Errors Observed

A repo-wide `bunx tsc -p apps/web/tsconfig.json --noEmit` reports errors in
these non-rough-cut files:

- `apps/web/src/actions/keybindings/persistence.ts`
  - Missing exports/import mismatches for `isShortcutKey` and
    `isActionWithOptionalArgs`.
  - Also reports string values not assignable to `ShortcutKey`.

- `apps/web/src/app/changelog/[version]/page.tsx`
  - Implicit `any` parameters.

- `apps/web/src/app/changelog/page.tsx`
  - Implicit `any` parameters.

- `apps/web/src/app/layout.tsx`
  - Missing type declaration for side-effect CSS import `./globals.css`.

- `apps/web/src/changelog/utils.ts`
  - Missing `content-collections` type/module and implicit `any` parameters.

- `apps/web/src/services/storage/migrations/runner.ts`
  - Function call arity mismatches.

- `apps/web/src/services/storage/migrations/v1-to-v2.ts`
  - Function call arity mismatches.

- `apps/web/src/stickers/providers/index.ts`
  - Function call arity mismatch.

- `apps/web/src/timeline/__tests__/update-pipeline.test.ts`
  - Test expectation compares a `number` where `MediaTime` is expected.

- `apps/web/src/timeline/placement/__tests__/resolve.test.ts`
  - Test expectation compares a `number` where `MediaTime` is expected.

No TypeScript errors were reported for:

- `apps/web/src/automation/roughcut/**`
- `apps/web/scripts/generate-roughcut.ts`
- `apps/web/scripts/roughcut-mcp.ts`
- `apps/web/scripts/roughcut/**`

## Cause Assessment

These failures are not caused by the rough-cut/MCP changes:

- The failing tests and TypeScript files are outside the rough-cut automation
  tree.
- The same failure classes appeared during Phase 3 validation before the MCP
  wrapper was added.
- Focused rough-cut tests and filtered rough-cut TypeScript checks pass.
- The MCP server starts and lists its tools through the official MCP SDK.

The failures are best classified as a mix of upstream repo issues and local test
runtime/environment issues:

- `opencut-wasm` startup is likely environment/package-initialization related.
- `ZERO_MEDIA_TIME` / `TICKS_PER_SECOND` failures are likely upstream module
  initialization-order issues.
- `isActionWithOptionalArgs` and `isShortcutKey` are upstream action/keybinding
  API/export mismatches.
- Changelog/content-collections/CSS and migration/sticker TypeScript errors
  appear to be existing repo-wide type debt or missing generated type setup.

## Rough-Cut Impact

These issues do not block:

- `bun generate:roughcut`
- `bun roughcut:mcp`
- Producing `opencut-roughcut-v1` JSON
- Running the rough-cut MCP tools

They also do not directly block importing rough-cut JSON into OpenCut through
the browser-side importer. Import still depends on OpenCut's web app running
successfully in a browser and on the user providing browser `File` objects for
media, but the known repo-wide test failures are not in the rough-cut importer
path.

## Safest Path

For the rough-cut/MCP prototype:

- Ignore these repo-wide failures for now.
- Document focused test commands for rough-cut validation.
- Keep using filtered TypeScript checks for rough-cut/MCP files.
- Fix the upstream repo-wide issues later in separate, scoped changes.

Do not fix these now as part of the rough-cut MCP work. In particular, avoid
touching renderer/export/WASM code until the rough-cut automation path needs it.
