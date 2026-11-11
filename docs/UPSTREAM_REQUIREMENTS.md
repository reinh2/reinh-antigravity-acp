# Upstream bb proposal

The plugin ships a locally patched copy of the ACP bridge from `@get-bb/plugin-sdk@0.6.132`
(`vendor/provider-bridge-acp.js`, generated from `patches/provider-bridge-acp-0.6.132.patch`).
These fixes belong in bb's `packages/provider-bridge-acp`; once released there, the vendor layer can be removed.

1. **Execution-session roster drift.** Reject a selected model that the executing session does not offer instead of silently prompting on another model.
2. **Concurrent turn admission.** Admit one `thread/start|resume|fork` / `turn/start` per thread while execution settings are applied; `thread/stop` cancels a pending construction.
3. **Native reasoning errors.** Propagate a refused or contradicted `session/set_config_option` instead of acknowledging the turn.
4. **Decomposed model acknowledgement.** Accept an agent that reports an effort-qualified id back as `model` family + `thinking_level` (Google Antigravity does).
5. **accept-edits.** Auto-approve `kind: "edit"` permission requests whose absolute paths are all inside the workspace write roots.
6. **Antigravity working directory.** Antigravity sorts `cwd` + `additionalDirectories` and uses the first as its working directory, so extra roots are not advertised to it.

Each item has a regression test that fails on the unmodified SDK (`REINH_TEST_UPSTREAM=1`):
`qa/upstream-tests/`, `qa/runtime-tests/`, `tests/bridge-integration.test.ts`, `tests/permissions.test.ts`.
`npm run check:upstream-proposal` applies the patch to an isolated copy of the SDK and runs them.
