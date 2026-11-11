// Host entry: wraps the shared ACP provider bridge, discovers models from the running Antigravity server, and serves the install/status host RPC.
export { reinhAcpRuntimePatch } from "./runtime-entry.js";
import path from "node:path";
import os from "node:os";
import { experimental_acpProviderBridge } from "./runtime-entry.js";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { agyHostContract } from "./contract.js";
import { FALLBACK_DIST, detectTarget, localizeLaunchSpec, probeLocal, runInstall } from "./install.js";
import { ModelCatalogCache } from "./model-cache.js";
import { createModelBridge } from "./model-bridge.js";
import { UsageCache, ensureProbeDir, readAntigravityUsage } from "./usage.js";

// Versioned, launch-scoped cache. Legacy family-only models-cache.json is ignored.
const pluginDataDir = path.join(os.homedir(), ".bb", "plugins", "google-antigravity-acp");
// One cache serves both bb's provider/usage and the Provider Usage panel RPC.
const usageCache = new UsageCache(spec => readAntigravityUsage(spec));
const usageCwd = ensureProbeDir(path.join(pluginDataDir, "usage-probe"));
export const experimental_providerBridge = createModelBridge({
  bridge: experimental_acpProviderBridge,
  cache: new ModelCatalogCache(path.join(pluginDataDir, "models-v2")),
  usage: usageCache,
  usageCwd,
  localize: localizeLaunchSpec,
  write: line => { process.stdout.write(line); },
});

export default experimental_defineHostEntry({
  contract: agyHostContract,
  handlers: {
    usage: async () => {
      const target = detectTarget();
      if (!(await probeLocal()).binaryPath) return { status: "not_installed" as const };
      const result = await usageCache.get({ command: target.binaryName, args: FALLBACK_DIST[target.distKey]?.args ?? [], env: {}, cwd: usageCwd });
      if (!result.supported) return { status: "error" as const, message: "Antigravity usage is not supported on this host." };
      const usage = result.usage;
      if (usage.status === "ok") {
        return {
          status: "ok" as const, planLabel: usage.planLabel,
          windows: usage.windows.map((window: any) => ({
            id: String(window.id ?? window.label), label: window.label, kind: window.kind ?? "custom",
            model: window.model ?? null, usedPercent: window.usedPercent, resetsAt: window.resetsAt,
          })),
        };
      }
      if (usage.status === "error") return { status: "error" as const, message: usage.message };
      return { status: usage.status };
    },
    probe: async () => {
      return probeLocal();
    },
    install: async (params) => {
      return runInstall({
        installDir: params.installDir,
        binDir: params.binDir,
        force: params.force,
        updatePath: params.updatePath,
        source: params.source,
      });
    },
  },
});
