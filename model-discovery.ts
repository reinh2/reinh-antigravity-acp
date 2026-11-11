import { spawn } from "node:child_process";
import readline from "node:readline";
import { isReasoningLevel, parseRawModels, type RawModel, type NativeReasoning } from "./model-utils.js";

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}
export class AcpDiscoveryAuthError extends Error {
  constructor() { super("ACP authentication required. Sign in using the provider login flow, then refresh models."); }
}
type Obj = Record<string, any>;
const object = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export function selectOptions(value: unknown): Obj[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    const option = object(entry);
    if (Array.isArray(option.options)) return selectOptions(option.options);
    return nonempty(option.value) ? [option] : [];
  });
}
function configOptions(session: unknown): Obj[] {
  const options = object(session).configOptions;
  return Array.isArray(options) ? options.map(object) : [];
}
function modelOption(session: unknown) {
  const options = configOptions(session);
  return options.find(o => o.category === "model" && o.type === "select") ?? options.find(o => o.id === "model" && o.type === "select");
}
function nativeReasoning(session: unknown): { nativeReasoning?: NativeReasoning; defaultReasoningEffort?: RawModel["defaultReasoningEffort"] } {
  const options = configOptions(session);
  const option = options.find(o => o.category === "thought_level" && o.type === "select") ?? options.find(o => o.id === "thinking_level" && o.type === "select");
  if (!option || !nonempty(option.id)) return {};
  const levelValues: NativeReasoning["levelValues"] = {};
  for (const entry of selectOptions(option.options)) {
    const level = entry.value === "minimal" ? "low" : entry.value;
    if (isReasoningLevel(level) && (!levelValues[level] || entry.value === level)) levelValues[level] = entry.value;
  }
  if (!Object.keys(levelValues).length) return {};
  const currentLevel = option.currentValue === "minimal" ? "low" : option.currentValue;
  return {
    nativeReasoning: { configId: option.id, levelValues },
    ...(isReasoningLevel(currentLevel) && levelValues[currentLevel] ? { defaultReasoningEffort: currentLevel } : {}),
  };
}

export function extractRawModels(session: unknown): RawModel[] {
  const data = object(session);
  const models = object(data.models);
  const roster: unknown[] = Array.isArray(models.availableModels) ? models.availableModels : [];
  const seen = new Set<string>();
  const raw: RawModel[] = [];
  for (const entry of roster) {
    const model = object(entry);
    if (!nonempty(model.modelId) || seen.has(model.modelId)) continue;
    seen.add(model.modelId);
    raw.push({ id: model.modelId, name: nonempty(model.name) ? model.name : model.modelId, ...(models.currentModelId === model.modelId ? { isDefault: true } : {}) });
  }
  // Validate first: a nonempty but wholly invalid roster must still use the fallback.
  if (raw.length) return raw;
  const option = modelOption(session);
  for (const entry of selectOptions(option?.options)) {
    if (seen.has(entry.value)) continue;
    seen.add(entry.value);
    raw.push({ id: entry.value, name: nonempty(entry.name) ? entry.name : entry.value,
      ...(entry.value === option?.currentValue ? { isDefault: true, ...nativeReasoning(session) } : {}),
    });
  }
  return raw;
}

export interface AcpConnection {
  send(method: string, params: unknown): Promise<unknown>;
  /** The fatal connection error, once the process failed or timed out. */
  failure(): Error | undefined;
}
// One short-lived ACP process. Only non-interactive cached-token authentication
// is attempted; no login flow is started and no permission is ever granted.
export async function withAcpConnection<T>(
  spec: LaunchSpec, timeoutMs: number,
  run: (connection: AcpConnection) => Promise<T>,
  onNotification?: (method: string, params: Obj) => void,
): Promise<T> {
  const proc = spawn(spec.command, spec.args, {
    cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "ignore"],
  });
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let nextId = 1;
  let stopped: Error | undefined;
  let bytes = 0;
  const fail = (error: Error) => {
    stopped ??= error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  proc.on("error", () => fail(new Error("Cannot launch the ACP server.")));
  proc.stdin.on("error", () => fail(new Error("ACP server stdin closed.")));
  proc.on("exit", () => fail(new Error("ACP server exited unexpectedly.")));
  proc.stdout.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) fail(new Error("ACP server response exceeds size limit."));
  });
  const timer = setTimeout(() => fail(new Error("ACP server query timed out.")), timeoutMs);
  rl.on("line", line => {
    let message: Obj;
    try { message = object(JSON.parse(line)); } catch { return; }
    if (message.method) {
      // Never mistake a bidirectional server request for a pending response.
      if (message.id !== undefined) {
        if (!proc.stdin.destroyed) proc.stdin.write(JSON.stringify({
          jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "This client does not handle server requests." },
        }) + "\n");
      } else onNotification?.(String(message.method), object(message.params));
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(
      message.error.code === -32000 && /^Authentication required/i.test(String(message.error.message))
        ? new AcpDiscoveryAuthError() : new Error("ACP request failed (server error)."),
    );
    else request.resolve(message.result);
  });
  const send = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => {
    if (stopped) return reject(stopped);
    const id = nextId++;
    pending.set(id, { resolve, reject });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    const initialized = object(await send("initialize", { protocolVersion: 1, clientInfo: { name: "bb", version: "1.0.0" }, clientCapabilities: {} }));
    // Match the canonical bridge's non-interactive cached-token handshake.
    if (Array.isArray(initialized.authMethods) && initialized.authMethods.some(m => object(m).id === "cached_token")) {
      await send("authenticate", { methodId: "cached_token", _meta: { headless: true } });
    }
    return await run({ send, failure: () => stopped });
  } finally {
    clearTimeout(timer);
    fail(new Error("ACP connection closed."));
    rl.close();
    proc.stdin.destroy();
    proc.kill();
    const killTimer = setTimeout(() => proc.kill("SIGKILL"), 250);
    killTimer.unref();
    proc.once("close", () => clearTimeout(killTimer));
  }
}

// All discovery mutations are confined to its disposable ACP session;
// the executing thread uses a separate connection.
export async function queryAcpServer(spec: LaunchSpec, timeoutMs = 15_000): Promise<RawModel[]> {
  return withAcpConnection(spec, timeoutMs, async ({ send, failure }) => {
    const session = await send("session/new", { cwd: spec.cwd ?? process.cwd(), mcpServers: [] });
    const raw = extractRawModels(session);
    const data = object(session);
    // Config-only servers can vary thinking support by model. Probe each family,
    // never take the current model's options as a global Cartesian product.
    const option = modelOption(session);
    if (option && nonempty(data.sessionId)) {
      const parsed = parseRawModels(raw);
      for (const model of raw) {
        const family = [...parsed.families.values()].find(f => [...f.variants.values()].includes(model.id));
        // Effort-qualified roster entries already encode the exact selection.
        if (family && [...family.variants.keys()].some(isReasoningLevel)) continue;
        if (model.id === option.currentValue) { Object.assign(model, nativeReasoning(session)); continue; }
        try {
          const state = await send("session/set_config_option", { sessionId: data.sessionId, configId: option.id, value: model.id });
          Object.assign(model, nativeReasoning(state));
        } catch (error) {
          if (failure()) throw error;
          // The family remains usable at the server default; no unproven levels.
        }
      }
    }
    const selectionConfigIds = configOptions(session)
      .filter(option => option.category === "model" || option.category === "thought_level" || option.id === "model" || option.id === "thinking_level")
      .map(option => option.id).filter(nonempty);
    for (const model of raw) model.selectionConfigIds = selectionConfigIds;
    if (!raw.length) throw new Error("ACP server advertised no valid models.");
    return raw;
  });
}
