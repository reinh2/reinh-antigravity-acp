# Third-party runtime attribution

The original Antigravity plugin is Copyright (c) 2025 rawizhere, MIT; its root LICENSE is unchanged.

`vendor/provider-bridge-acp.js` is a deterministic locally patched copy of the published `@get-bb/plugin-sdk@0.6.132` ACP runtime. BB is Copyright (c) 2026 Michael Yong, MIT: see `vendor/BB-SDK-LICENSE` and https://github.com/get-bb/bb/blob/main/LICENSE. Reinh's modifications are confined to the versioned patch in `patches/` and are identified in the generated module banner. The full BB runtime is not represented as Reinh-authored code.

The published SDK bundle embeds Agent Client Protocol TypeScript SDK code (its original source path/version comments remain intact). See `vendor/ACP-SDK-LICENSE` (Apache-2.0) and https://github.com/agentclientprotocol/typescript-sdk. Other embedded source-module names and versions are retained verbatim in the generated file. External npm dependencies remain governed by their installed package licenses. Do not remove upstream notices when regenerating or packaging this local runtime.

Packaging must keep these notices; local SDK patching does not change the upstream projects' authorship.
