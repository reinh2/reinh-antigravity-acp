import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createModelBridge } from "../model-bridge.js";
import { ModelCatalogCache } from "../model-cache.js";
import { AcpDiscoveryAuthError } from "../model-discovery.js";
import type { LaunchSpec } from "../model-discovery.js";
import type { RawModel } from "../model-utils.js";
const variants = ["low", "high"].map(level => ({ id: `gemini-4-argon-${level}`, name: `Gemini 4 Argon (${level})` }));
function harness(query: (spec: LaunchSpec) => Promise<RawModel[]> = async () => variants) {
  const forwarded: any[] = [], output: any[] = [];
  const bridge = createModelBridge({
    bridge: { handleLine(line) { forwarded.push(JSON.parse(line)); } },
    cache: new ModelCatalogCache(fs.mkdtempSync(path.join(os.tmpdir(), "reinh-route-")), query),
    localize() {}, write(line) { output.push(JSON.parse(line)); },
  });
  const request = (method: string, reasoningLevel?: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, method,
    params: { threadId: "thread", cwd: "/synthetic", instructionMode: "append", providerThreadId: "session", intent: "release", activeTurnId: null, clientRequestId: "creq_abcdefghij", input: [{ type: "text", text: "synthetic", mentions: [] }], options: { model: "gemini-4-argon", reasoningLevel, permissionMode: "accept-edits", permissionScope: "workspace", approvalReviewer: "user", permissionEscalation: "deny",
      providerOptions: { acpLaunchSpec: { displayName: "Synthetic", command: "synthetic", args: [], env: {} } } } },
  });
  return { bridge, forwarded, output, request };
}
for (const method of ["thread/stop", "thread/discard", "close"]) test(`${method} cannot resurrect an in-flight discovery/start`, async () => {
  let release!: (models: RawModel[]) => void;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const start = h.bridge.handleLine(h.request("thread/start", "high"));
  if (method === "close") h.bridge.onClose(); else await h.bridge.handleLine(h.request(method));
  release(variants); await start;
  assert.equal(h.forwarded.filter(r => r.method === "thread/start").length, 0);
});
test("discard retains the last requested selection for implicit turns", async () => {
  const h = harness();
  await h.bridge.handleLine(h.request("thread/start", "high"));
  await h.bridge.handleLine(h.request("thread/discard"));
  const turn = JSON.parse(h.request("turn/start"));
  delete turn.params.options.model;
  await h.bridge.handleLine(JSON.stringify(turn));
  assert.equal(h.forwarded.at(-1).params.options.model, "gemini-4-argon-high");
  assert.equal(h.output.length, 0);
});
test("auth failure preserves canonical recovery shape, without forwarding an unresolved model", async () => {
  const h = harness(async () => { throw new AcpDiscoveryAuthError(); });
  await h.bridge.handleLine(h.request("thread/start", "high"));
  assert.equal(h.output[0].error.code, -32000);
  assert.equal(h.output[0].error.data.recovery.kind, "authRequired");
  assert.equal(h.forwarded.length, 0);
});
test("invalid effort cannot leak to the canonical bridge and permissions stay intact", async () => {
  const h = harness();
  await h.bridge.handleLine(h.request("thread/start", "argon"));
  assert.equal(h.forwarded.length, 0);
  await h.bridge.handleLine(h.request("thread/start", "low"));
  assert.equal(h.forwarded[0].params.options.model, "gemini-4-argon-low");
  assert.equal(h.forwarded[0].params.options.reasoningLevel, undefined);
  assert.equal(h.forwarded[0].params.options.permissionMode, "accept-edits");
});

test("a malformed start cannot replace the guard of the existing live session", async () => {
  const h = harness();
  await h.bridge.handleLine(h.request("thread/start", "high"));
  const invalid = JSON.parse(h.request("thread/start", "low"));
  delete invalid.params.instructionMode;
  await h.bridge.handleLine(JSON.stringify(invalid));
  const turn = JSON.parse(h.request("turn/start"));
  delete turn.params.options.model;
  await h.bridge.handleLine(JSON.stringify(turn));
  assert.equal(h.forwarded.filter(r => r.method === "thread/start").length, 1);
  assert.equal(h.forwarded.at(-1).params.options.model, "gemini-4-argon-high");
});

for (const method of ["toString", "constructor", "__proto__"]) test(`unknown prototype-named method ${method} delegates without crashing`, async () => {
  const h = harness();
  await h.bridge.handleLine(h.request(method));
  assert.equal(h.forwarded[0].method, method);
});
test("invalid RPC envelopes cannot replace a live-session guard", async () => {
  const h = harness();
  await h.bridge.handleLine(h.request("thread/start", "high"));
  for (const patch of [{ jsonrpc: "1.0" }, { id: null }, { id: undefined }]) {
    const invalid = { ...JSON.parse(h.request("thread/start", "low")), ...patch };
    await h.bridge.handleLine(JSON.stringify(invalid));
  }
  const turn = JSON.parse(h.request("turn/start"));
  delete turn.params.options.model;
  await h.bridge.handleLine(JSON.stringify(turn));
  assert.equal(h.forwarded.at(-1).params.options.model, "gemini-4-argon-high");
});

test("auto permission mode, checkpoint fork and malformed provider options cannot replace a live guard", async () => {
  const h = harness();
  await h.bridge.handleLine(h.request("thread/start", "high"));
  const auto = JSON.parse(h.request("thread/start", "low"));
  Object.assign(auto.params.options, { permissionMode: "auto", permissionScope: "workspace", approvalReviewer: "automatic", permissionEscalation: "deny" });
  await h.bridge.handleLine(JSON.stringify(auto));
  const fork = JSON.parse(h.request("thread/fork", "low"));
  Object.assign(fork.params, { sourceProviderThreadId: "session", sourceProviderCheckpointId: "checkpoint" });
  await h.bridge.handleLine(JSON.stringify(fork));
  const invalidOptions = JSON.parse(h.request("thread/start", "low"));
  invalidOptions.params.options.providerOptions.parameterizedModelPicker = "invalid";
  await h.bridge.handleLine(JSON.stringify(invalidOptions));
  const turn = JSON.parse(h.request("turn/start"));
  delete turn.params.options.model;
  await h.bridge.handleLine(JSON.stringify(turn));
  assert.equal(h.forwarded.filter(r => r.method === "thread/start").length, 1);
  assert.equal(h.forwarded.at(-1).params.options.model, "gemini-4-argon-high");
});

test("turn discovery retains execution cwd and construction env until explicit overrides", async () => {
  const specs: LaunchSpec[] = [];
  const h = harness(async spec => { specs.push(structuredClone(spec)); return variants; });
  const start = JSON.parse(h.request("thread/start", "high"));
  start.params.options.envVars = { SYNTHETIC_ACCOUNT: "first" };
  await h.bridge.handleLine(JSON.stringify(start));
  const turn = JSON.parse(h.request("turn/start", "low"));
  delete turn.params.cwd;
  turn.params.options.envVars = {};
  await h.bridge.handleLine(JSON.stringify(turn));
  assert.equal(specs.length, 1, "turn reuses the same launch-scoped catalog");
  turn.params.options.envVars = { SYNTHETIC_ACCOUNT: "second" };
  await h.bridge.handleLine(JSON.stringify(turn));
  assert.equal(specs.length, 2);
  assert.equal(specs[1].cwd, "/synthetic");
  assert.equal(specs[1].env.SYNTHETIC_ACCOUNT, "second");
});


test("session options cannot override the model or reasoning, including discovered custom config IDs", async () => {
  const h = harness(async () => variants.map(raw => ({ ...raw, selectionConfigIds: ["custom_model", "custom_thought"] })));
  for (const id of ["model", "thinking_level", "custom_model", "custom_thought"]) {
    const request = JSON.parse(h.request("thread/start", "high"));
    request.params.options.sessionOptions = { [id]: "low" };
    await h.bridge.handleLine(JSON.stringify(request));
    assert.match(h.output.at(-1).error.message, /conflicting ACP session options/);
  }
  assert.equal(h.forwarded.length, 0);
  const safe = JSON.parse(h.request("thread/start", "high"));
  safe.params.options.sessionOptions = { context_size: "large" };
  await h.bridge.handleLine(JSON.stringify(safe));
  assert.deepEqual(h.forwarded[0].params.options.sessionOptions, { context_size: "large" });
});
