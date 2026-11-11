import { z } from "zod";
import {
  threadStartParamsSchema, threadResumeParamsSchema, threadForkParamsSchema,
  turnStartParamsSchema, turnSteerParamsSchema, threadStopParamsSchema, threadDiscardParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_acpLaunchSpecSchema } from "./runtime-entry.js";
import { AcpDiscoveryAuthError, type LaunchSpec } from "./model-discovery.js";
import { ModelCatalogCache } from "./model-cache.js";
import { resolveModelSelection } from "./model-utils.js";
import type { ProviderUsageResult } from "@get-bb/plugin-sdk/provider-bridge";

// Additional options are validated again by the canonical bridge before it
// stops an existing session; match those checks before changing our guard.
const providerOptionsSchema = z.object({
  additionalWorkspaceWriteRoots: z.array(z.string()).optional(),
  acpDialect: z.string().min(1).optional(),
  parameterizedModelPicker: z.boolean().optional(),
  primaryModels: z.array(z.string().min(1)).optional(),
  reasoningProbePriorityModelIds: z.array(z.string().min(1)).optional(),
}).passthrough();

interface Bridge { handleLine(line: string): unknown; onClose?(): unknown }
export function createModelBridge(deps: {
  bridge: Bridge;
  cache: ModelCatalogCache;
  localize(spec: LaunchSpec): void;
  write(line: string): void;
  /** provider/usage: Antigravity quota. Omitted → the canonical bridge answers. */
  usage?: { get(spec: LaunchSpec): Promise<ProviderUsageResult> };
  usageCwd?: string;
}) {
  // Last requested selection supplies defaults when a later request omits model.
  // SDK 0.6.132 reconciles the resolved selection before every prompt.
  const selections = new Map<string, { modelId: string; reasoningLevel?: string; cwd?: string; env: Record<string, string> }>();
  const generations = new Map<string, number>();
  let closed = false;
  const sendError = (id: unknown, message: string, auth = false) => {
    if (typeof id === "string" || typeof id === "number") deps.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: auth ? -32000 : -32602, message, ...(auth ? { data: { recovery: { kind: "authRequired", message, retryable: false } } } : {}) } }) + "\n");
  };
  return {
    experimental_apiVersion: 1 as const,
    async handleLine(line: string) {
      if (closed) return;
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { return deps.bridge.handleLine(line); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.jsonrpc !== "2.0" ||
          typeof parsed.method !== "string" || (typeof parsed.id !== "string" && typeof parsed.id !== "number")) {
        return deps.bridge.handleLine(line);
      }
      const method = parsed.method;
      if (method === "provider/usage" && deps.usage) {
        const launch = parsed.params?.providerOptions?.acpLaunchSpec;
        let result: ProviderUsageResult;
        if (!experimental_acpLaunchSpecSchema.safeParse(launch).success) result = { supported: false };
        else {
          deps.localize(launch);
          // A fixed private directory: the quota probe never opens a user project.
          result = await deps.usage.get({ command: launch.command, args: launch.args, env: { ...launch.env }, cwd: deps.usageCwd ?? launch.cwd });
        }
        if (!closed) deps.write(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }) + "\n");
        return;
      }
      const schemas = new Map<string, { safeParse(value: unknown): { success: boolean } }>(Object.entries({
        "thread/start": threadStartParamsSchema, "thread/resume": threadResumeParamsSchema,
        "thread/fork": threadForkParamsSchema, "turn/start": turnStartParamsSchema,
        "turn/steer": turnSteerParamsSchema, "thread/stop": threadStopParamsSchema,
        "thread/discard": threadDiscardParamsSchema,
      }));
      const schema = schemas.get(method);
      // Validate before discovery or changing guards. A rejected start must not
      // replace the guard for a still-running session.
      if (schema && !schema.safeParse(parsed.params).success) {
        sendError(parsed.id, `Invalid params for "${method}".`);
        return;
      }
      const construction = ["thread/start", "thread/resume", "thread/fork"].includes(method);
      const turn = method === "turn/start" || method === "turn/steer";
      if (method !== "model/list" && !construction && !turn) {
        if (method === "thread/stop" || method === "thread/discard") {
          const threadId = parsed.params?.threadId;
          generations.set(threadId, (generations.get(threadId) ?? 0) + 1);
          // discard is a no-op in the canonical ACP bridge: retain its selection guard.
          // Keep the guard even if the SDK rejects a malformed stop request.
        }
        return deps.bridge.handleLine(line);
      }
      try {
        const params = parsed.params;
        if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Request params must be an object.");
        const options = method === "model/list" ? params : params.options;
        if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Execution options must be an object.");
        if (construction && options.permissionMode !== "accept-edits" && options.permissionMode !== "full") {
          throw new Error("Antigravity supports only accept-edits and full permission modes.");
        }
        if (method === "thread/fork" && params.sourceProviderCheckpointId !== undefined) {
          throw new Error("ACP cannot fork at a checkpoint.");
        }
        if (!providerOptionsSchema.safeParse(options.providerOptions ?? {}).success) throw new Error("Invalid ACP provider options.");
        if (turn && !selections.has(params.threadId)) return deps.bridge.handleLine(line);
        const launch = options.providerOptions?.acpLaunchSpec;
        if (!experimental_acpLaunchSpecSchema.safeParse(launch).success) throw new Error("A valid options.providerOptions.acpLaunchSpec is required.");
        if (launch.modelCli || launch.reasoningCli) throw new Error("Antigravity model discovery requires native ACP selection, not CLI model/reasoning flags.");
        deps.localize(launch);
        const previous = selections.get(params.threadId);
        // The SDK retains construction env when a turn supplies no overrides.
        const hasEnvOverrides = Object.keys(options.envVars ?? {}).length > 0;
        const env = turn && previous && !hasEnvOverrides ? previous.env : { ...launch.env, ...(method === "model/list" ? {} : options.envVars) };
        const spec: LaunchSpec = {
          command: launch.command, args: launch.args,
          env,
          cwd: launch.cwd ?? params.cwd ?? (turn ? previous?.cwd : undefined),
        };
        let generation = generations.get(params.threadId) ?? 0;
        if (construction) { generation++; generations.set(params.threadId, generation); }
        const catalog = await deps.cache.get(spec, construction);
        if (closed || ((construction || turn) && generation !== (generations.get(params.threadId) ?? 0))) {
          throw new Error("Antigravity request superseded or cancelled while discovering models.");
        }
        if (method === "model/list") {
          deps.write(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { models: catalog.models, selectedOnlyModels: [] } }) + "\n");
          return;
        }
        const selectionConfigIds = new Set(["model", "thinking_level", ...catalog.rawModels.flatMap(raw => [...(raw.selectionConfigIds ?? []), ...(raw.nativeReasoning ? [raw.nativeReasoning.configId] : [])])]);
        if (options.sessionOptions && Object.keys(options.sessionOptions).some(id => selectionConfigIds.has(id))) {
          throw new Error("Use the model and reasoning selectors instead of conflicting ACP session options.");
        }
        const resolved = resolveModelSelection(options.model ?? (turn ? previous?.modelId : undefined), options.reasoningLevel ?? (turn && (!options.model || options.model === previous?.modelId) ? previous?.reasoningLevel : undefined), catalog);
        const native = resolved.family.nativeReasoning;
        const selection = { modelId: resolved.modelId, reasoningLevel: native ? resolved.reasoningLevel : undefined, cwd: spec.cwd, env: spec.env };
        options.model = resolved.modelId;
        // Variants encode effort. Native thinking uses a separately validated setter.
        delete options.reasoningLevel;
        delete launch.nativeReasoning;
        if (native && resolved.reasoningLevel) {
          options.reasoningLevel = resolved.reasoningLevel;
          launch.nativeReasoning = {
            ...native,
            supportedLevels: Object.keys(native.levelValues),
            defaultLevel: resolved.reasoningLevel,
          };
        }
        if ((construction || turn) && typeof params.threadId === "string") selections.set(params.threadId, selection);
        return deps.bridge.handleLine(JSON.stringify(parsed));
      } catch (error) {
        sendError(parsed.id, error instanceof Error ? error.message : "Antigravity model selection failed.", error instanceof AcpDiscoveryAuthError);
        // Do not forward the original request after a resolution/discovery failure.
      }
    },
    onClose() { closed = true; selections.clear(); for (const [id, generation] of generations) generations.set(id, generation + 1); return deps.bridge.onClose?.(); },
  };
}
