#!/usr/bin/env node
// Synthetic ACP only. No Google connection, credentials, or user project access.
import readline from "node:readline";
import { appendFileSync, readFileSync } from "node:fs";
const send = message => process.stdout.write(JSON.stringify(message) + "\n");
const mode = process.env.TEST_ACP_MODE ?? "variants";
let selected = "gemini-3.8-flash-medium";
let sessionId = "synthetic-session-" + process.pid;
let authenticated = false;
let executing = false;
const families = ["gemini-4-argon", "gemini-3.8-flash"];
const levels = ["low", "medium", "high"];
const nativeMode = mode === "config" || mode === "family-roster" || mode.startsWith("native-");
const log = event => { if (process.env.TEST_RPC_LOG) appendFileSync(process.env.TEST_RPC_LOG, JSON.stringify(event) + "\n"); };
const currentLevel = () => selected.match(/-(low|medium|high)$/)?.[1] ?? (selected.startsWith("gemini-4") ? "low" : "medium");
function config() {
  const modelOptions = families.map(value => ({ value, name: value }));
  const model = { id: "model", category: "model", type: "select", currentValue: selected.replace(/-(low|medium|high)$/, ""), options: mode === "grouped" ? [{ group: "models", name: "Models", options: modelOptions }] : modelOptions };
  let thought = { id: "thinking_level", category: "thought_level", type: "select", currentValue: currentLevel(), options: (nativeMode && selected.startsWith("gemini-4") ? ["low", "high"] : levels).map(value => ({ value, name: value })) };
  if (mode === "native-custom") {
    thought.id = selected.startsWith("gemini-4") ? "budget_argon" : "budget_flash";
    if (executing) delete thought.category;
  }
  if (mode === "native-unsupported" && executing) {
    thought.options = [{ value: "low", name: "Low" }]; thought.currentValue = "low";
  }
  if (mode === "native-missing" && executing) return [model];
  if (mode === "native-mismatch" && executing) thought.currentValue = "low";
  return [model, thought];
}
const WIDE = [
  ["gemini-5-carbon-low", "Gemini 5 Carbon (Low)"], ["gemini-5-carbon-medium", "Gemini 5 Carbon (Medium)"], ["gemini-5-carbon-high", "Gemini 5 Carbon (High)"],
  ["gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)"], ["gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"],
  ["claude-opus-4-7", "Claude Opus 4.7"], ["gpt-oss-120b-medium", "GPT-OSS 120B (Medium)"],
];
function state() {
  if (mode === "wide-roster") return { configOptions: [], models: { currentModelId: selected, availableModels: WIDE.map(([modelId, name]) => ({ modelId, name })) } };
  if (mode === "missing-model" || (mode === "runtime-drift" && executing)) return {
    models: { currentModelId: "gemini-3.8-flash-medium", availableModels: [{ modelId: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" }] }, configOptions: [],
  };
  return { configOptions: config(), ...(nativeMode && mode !== "family-roster" ? {} : { models: {
    currentModelId: selected,
    availableModels: mode === "family-roster" ? families.map(modelId => ({ modelId, name: modelId })) : families.flatMap((family, index) => levels.map(level => ({ modelId: `${family}-${level}`, name: `${index ? "Gemini 3.8 Flash" : "Gemini 4 Argon"} (${level[0].toUpperCase() + level.slice(1)})` }))),
  } }) };
}
const error = (request, message) => send({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message } });
if (mode === "slow-exit") process.on("SIGTERM", () => {
  log({ fixtureEvent: "SIGTERM", pid: process.pid });
  setTimeout(() => process.exit(0), 250);
});
let sessionCwd = process.cwd();
const outgoing = new Map();
let outgoingId = 9000;
const ask = (label, toolCall) => {
  const id = outgoingId++;
  outgoing.set(id, label);
  send({ jsonrpc: "2.0", id, method: "session/request_permission", params: { sessionId, toolCall, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "deny", name: "Deny", kind: "reject_once" }] } });
};
const editCall = (toolCallId, file) => ({ toolCallId, kind: "edit", status: "pending", title: "Run client_create_file?", content: [{ type: "diff", path: file, newText: "hi" }], locations: [{ path: file }], rawInput: { target_file: file, code_content: "hi" } });
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (request.method === undefined && outgoing.has(request.id)) {
    log({ fixtureEvent: "permission", which: outgoing.get(request.id), outcome: request.result?.outcome ?? request.error });
    outgoing.delete(request.id); return;
  }
  log(request);
  if (mode === "silent") return;
  if (mode === "exit") process.exit(2);
  if (mode === "auth" && request.method === "session/new") {
    send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Authentication required" } }); return;
  }
  let result;
  switch (request.method) {
    case "initialize":
      result = { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { additionalDirectories: {} } }, ...(mode === "cached-auth" || mode === "auth-fail" || mode === "auth-silent" ? { authMethods: [{ id: "cached_token", name: "Cached token" }] } : {}) };
      if (mode === "slow-initialize") { setTimeout(() => send({ jsonrpc: "2.0", id: request.id, result }), 400); return; }
      break;
    case "authenticate":
      if (mode === "auth-silent") return;
      if (mode === "auth-fail") { send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Authentication required" } }); return; }
      authenticated = true; result = {}; break;
    case "session/new":
      if (typeof request.params?.cwd === "string") sessionCwd = request.params.cwd;
      if (mode === "cached-auth" && !authenticated) { send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Authentication required" } }); return; }
      executing = process.env.TEST_RPC_LOG ? readFileSync(process.env.TEST_RPC_LOG, "utf8").trim().split("\n").map(line => JSON.parse(line)).filter(r => r.method === "session/new").length > 1 : false;
      result = { sessionId, ...state(), _meta: { antigravity: { tier: { name: "Synthetic Pro", id: "synthetic" } } } }; break;
    case "session/load":
      executing = true; sessionId = request.params.sessionId;
      result = mode === "restore-null" ? null : state();
      if (mode === "slow-load") { setTimeout(() => send({ jsonrpc: "2.0", id: request.id, result }), 400); return; }
      break;
    case "session/set_config_option":
      if (request.params.configId === "model") {
        // Real Antigravity accepts an effort-qualified id here and reports family + thinking_level.
        if (mode === "google" && /-(low|medium|high)$/.test(request.params.value) && families.includes(request.params.value.replace(/-(low|medium|high)$/, ""))) {
          selected = request.params.value; result = { configOptions: config() }; break;
        }
        if (!families.includes(request.params.value)) { error(request, "Expected family id"); return; }
        selected = request.params.value;
      } else if (request.params.configId === "thinking_level" || request.params.configId.startsWith("budget_")) {
        if (mode === "native-refuse") { error(request, "Synthetic thinking level refused"); return; }
        selected = selected.replace(/-(low|medium|high)$/, "") + "-" + request.params.value;
        if (mode === "native-null") { result = null; break; }
        if (mode === "native-empty") { result = {}; break; }
      }
      result = state(); break;
    case "session/set_model":
      if (mode === "google") { selected = request.params.modelId; result = {}; break; }
      if (mode === "refuse-low" && request.params.modelId.endsWith("-low")) { error(request, "Synthetic model selection refused"); return; }
      if (mode === "model-mismatch") { result = state(); break; }
      selected = request.params.modelId; result = state();
      if (mode === "slow-low" && selected.endsWith("-low")) { setTimeout(() => send({ jsonrpc: "2.0", id: request.id, result }), 400); return; }
      break;
    case "session/prompt":
      if (mode === "edit-permission" && request.params.prompt?.[0]?.text !== "/usage") {
        ask("inside", editCall("edit-inside", sessionCwd + "/probe.txt"));
        ask("traversal", editCall("edit-traversal", sessionCwd + "/../escape.txt"));
        ask("relative", editCall("edit-relative", "probe.txt"));
        ask("command", { toolCallId: "cmd-1", kind: "execute", status: "pending", title: "Run command?", rawInput: { command: "echo hi" } });
        setTimeout(() => send({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } }), 300);
        return;
      }
      if (request.params.prompt?.[0]?.text === "/usage") {
        const report = mode === "usage-na"
          ? "### Quota Limits\n- Quota limits are not applicable for the current auth method.\n"
          : "### Session Usage\n- **Session total:** data not available yet\n\n### Quota Limits\n- **Gemini Models**\n  *(Models within this group: Gemini Flash, Gemini Pro)*\n  - **Weekly Limit Remaining:** 97% remaining (resets Nov 14, 2026, 06:48 UTC)\n  - **Five Hour Limit Remaining:** 99% remaining (resets Nov 11, 2026, 19:51 UTC)\n- **Claude and GPT models**\n  *(Models within this group: Claude Opus, Claude Sonnet, GPT-OSS)*\n  - **Weekly Limit Remaining:** 42% remaining (resets Nov 16, 2026, 15:08 UTC)\n- **Gemini 4 Argon**\n  *(For paid Pro plans, Argon quota is separate.)*\n  - **Gemini 4 Argon Weekly Limit:** 60% remaining (resets Nov 14, 2026, 06:44 UTC)";
        for (const piece of [report.slice(0, 120), report.slice(120)]) send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: piece } } } });
        result = { stopReason: "end_turn" }; break;
      }
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: selected } } } });
      result = { stopReason: "end_turn" }; break;
    default: result = {};
  }
  send({ jsonrpc: "2.0", id: request.id, result });
});
