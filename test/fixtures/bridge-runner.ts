import readline from "node:readline";
import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { ModelCatalogCache } from "../../model-cache.js";
import { createModelBridge } from "../../model-bridge.js";
import { UsageCache, readAntigravityUsage } from "../../usage.js";
const selectedSdk = process.env.REINH_TEST_UPSTREAM === "1"
  ? experimental_acpProviderBridge
  : (await import("../../runtime-entry.js")).experimental_acpProviderBridge;
// Bundle mode always runs the final host, even for the native raw-SDK gate.
const bridge = process.env.REINH_TEST_BUNDLE === "1"
  ? (await import("../../dist/host.js")).experimental_providerBridge
  : process.env.REINH_TEST_RAW_SDK === "1" ? selectedSdk : createModelBridge({
      bridge: selectedSdk,
      cache: new ModelCatalogCache(process.env.TEST_CACHE_DIR!),
      usage: new UsageCache(spec => readAntigravityUsage(spec, 8000)),
      usageCwd: process.env.HOME,
      localize() {},
      write(line) { process.stdout.write(line); },
    });
readline.createInterface({ input: process.stdin }).on("line", line => { void bridge.handleLine(line); }).on("close", () => bridge.onClose());
