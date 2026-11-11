import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "../test/helpers/bridge-harness.js";

test("canonical bb bridge: discovery → family+effort → exact RPC → direct effort switch → resume", async t => {
  const h = await harness(t);
  const models = await h.send("model/list", { cwd: h.dir, providerOptions: h.options().providerOptions });
  assert.ok(models.result, JSON.stringify(models));
  assert.equal(models.result.models.length, 2);
  assert.deepEqual(models.result.models[0].supportedReasoningEfforts.map((e: any) => e.reasoningEffort), ["low", "medium", "high"]);
  let result = await h.send("thread/start", { threadId: "test-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(result.result, JSON.stringify(result));
  const sessionId = result.result.providerThreadId;
  result = await h.send("turn/start", { threadId: "test-thread", providerThreadId: sessionId, clientRequestId: "creq_abcdefghij", input: [{ type: "text", text: "synthetic smoke", mentions: [] }], options: h.options("gemini-4-argon", "high") });
  assert.ok(result.result, JSON.stringify(result));
  await h.waitCompleted(1);
  const firstPrompt = h.rpc().map(r => r.method).lastIndexOf("session/prompt");
  assert.ok(firstPrompt >= 0);
  assert.ok(h.rpc().slice(0, firstPrompt).some(r => r.method === "session/set_model" && r.params.modelId === "gemini-4-argon-high"));
  assert.equal(h.rpc().filter(r => r.method === "session/set_config_option" && r.params.configId === "thinking_level").length, 0);
  const loadCount = h.rpc().filter(r => r.method === "session/load").length;
  const changed = await h.send("turn/start", { threadId: "test-thread", providerThreadId: sessionId, clientRequestId: "creq_cdefghijkm", input: [{ type: "text", text: "direct low switch", mentions: [] }], options: h.options("gemini-4-argon", "low") });
  assert.ok(changed.result, JSON.stringify(changed));
  await h.waitCompleted(2);
  assert.equal(h.rpc().filter(r => r.method === "session/load").length, loadCount);
  assert.ok(h.rpc().some(r => r.method === "session/set_model" && r.params.modelId === "gemini-4-argon-low"));
  result = await h.send("thread/resume", { threadId: "test-thread", providerThreadId: sessionId, cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "medium") });
  assert.ok(result.result, JSON.stringify(result)); assert.equal(result.result.providerThreadId, sessionId);
  result = await h.send("turn/start", { threadId: "test-thread", providerThreadId: sessionId, clientRequestId: "creq_bcdefghijk", input: [{ type: "text", text: "synthetic second smoke", mentions: [] }], options: h.options("gemini-4-argon", "medium") });
  assert.ok(result.result, JSON.stringify(result));
  await h.waitCompleted(3);
  const rpc = h.rpc();
  assert.ok(rpc.some(r => r.method === "session/load" && r.params.sessionId === sessionId));
  assert.ok(rpc.some(r => r.method === "session/set_model" && r.params.modelId === "gemini-4-argon-low"));
  assert.equal(rpc.filter(r => r.method === "session/prompt").length, 3);
  assert.ok(rpc.some(r => r.method === "session/set_model" && r.params.modelId === "gemini-4-argon-medium"));
  assert.ok(rpc.filter(r => r.method === "session/new" || r.method === "session/load").every(r => Array.isArray(r.params.mcpServers)));
  h.record("synthetic-argon-rpc", { models: models.result.models, rpc, events: h.events });
});

test("config-only thinking selects and verifies the real native level before prompt", async t => {
  const h = await harness(t, "config");
  const result = await h.send("thread/start", { threadId: "config-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(result.result, JSON.stringify(result));
  const prompt = await h.send("turn/start", { threadId: "config-thread", providerThreadId: result.result.providerThreadId, clientRequestId: "creq_abcdefghij", input: [{ type: "text", text: "synthetic native high", mentions: [] }], options: h.options("gemini-4-argon", "high") });
  assert.ok(prompt.result, JSON.stringify(prompt));
  await h.waitCompleted(1);
  const rpc = h.rpc();
  assert.ok(rpc.some(r => r.method === "session/set_config_option" && r.params.configId === "thinking_level" && r.params.value === "high"));
});

test("canonical bridge rejects invalid, missing and unsupported models before execution", async t => {
  const h = await harness(t);
  for (const [model, effort] of [["gemini-4-argon", "argon"], ["gemini-3.8-flash", "flash"], ["removed-model", "high"]]) {
    const result = await h.send("thread/start", { threadId: "invalid-thread", cwd: h.dir, instructionMode: "append", options: h.options(model, effort) });
    assert.equal(result.error.code, -32602);
  }
  assert.equal(h.rpc().filter(r => r.method === "session/prompt" || r.method === "session/set_model").length, 0);
});

test("Gemini Flash switches Low/Medium/High on the same ACP session without restart", async t => {
  const h = await harness(t);
  const result = await h.send("thread/start", { threadId: "flash-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-3.8-flash", "medium") });
  assert.ok(result.result, JSON.stringify(result));
  const sessionId = result.result.providerThreadId;
  for (const [index, level] of ["low", "medium", "high"].entries()) {
    const id = ["creq_abcdefghij", "creq_bcdefghijk", "creq_cdefghijkm"][index];
    const response = await h.send("turn/start", { threadId: "flash-thread", providerThreadId: sessionId, clientRequestId: id, input: [{ type: "text", text: `synthetic ${level}`, mentions: [] }], options: h.options("gemini-3.8-flash", level) });
    assert.ok(response.result, JSON.stringify(response));
    await h.waitCompleted(index + 1);
    const rpc = h.rpc();
    const promptIndex = rpc.map(r => r.method).lastIndexOf("session/prompt");
    const selections = rpc.slice(0, promptIndex).filter(r => r.method === "session/set_model");
    assert.equal(selections.at(-1).params.modelId, `gemini-3.8-flash-${level}`);
    assert.ok(h.events.some(e => e.method === "thread/delta" && e.params.deltas.some((delta: any) => delta.kind === "item.textDelta" && delta.text === `gemini-3.8-flash-${level}`)));
  }
  assert.equal(h.rpc().filter(r => r.method === "session/load").length, 0);
  assert.equal(h.rpc().filter(r => r.method === "session/new").length, 2, "one discovery session and one executing session");
  h.record("synthetic-flash-rpc", { rpc: h.rpc(), events: h.events });
});

test("a refused model switch returns an error before prompt and the session can recover", async t => {
  const h = await harness(t, "refuse-low");
  const started = await h.send("thread/start", { threadId: "refusal-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const params = { threadId: "refusal-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_abcdefghij", input: [{ type: "text", text: "must not run at the old effort", mentions: [] }], options: h.options("gemini-4-argon", "low") };
  const failed = await h.send("turn/start", params);
  assert.ok(failed.error, JSON.stringify(failed));
  assert.equal(h.rpc().filter(r => r.method === "session/prompt").length, 0);
  const recovered = await h.send("turn/start", { ...params, clientRequestId: "creq_bcdefghijk", options: h.options("gemini-4-argon", "high") });
  assert.ok(recovered.result, JSON.stringify(recovered));
  await h.waitCompleted(1);
  assert.equal(h.rpc().filter(r => r.method === "session/prompt").length, 1);
  assert.ok(h.events.some(e => e.method === "thread/delta" && e.params.deltas.some((delta: any) => delta.kind === "item.textDelta" && delta.text === "gemini-4-argon-high")));
  h.record("synthetic-refusal-rpc", { failed, rpc: h.rpc(), events: h.events });
});

test("SDK 0.6.132 executes a roster model with grouped config options", async t => {
  const h = await harness(t, "grouped");
  const started = await h.send("thread/start", { threadId: "grouped-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const prompt = await h.send("turn/start", { threadId: "grouped-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_abcdefghij", input: [{ type: "text", text: "synthetic grouped options", mentions: [] }], options: h.options("gemini-4-argon", "high") });
  assert.ok(prompt.result, JSON.stringify(prompt));
  await h.waitCompleted(1);
  assert.ok(h.events.some(e => e.method === "thread/delta" && e.params.deltas.some((delta: any) => delta.kind === "item.textDelta" && delta.text === "gemini-4-argon-high")));
});

test("Antigravity-style decomposed model config (family + thinking_level) is accepted as the requested variant", async t => {
  const h = await harness(t, "google");
  const started = await h.send("thread/start", { threadId: "google-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const sessionId = started.result.providerThreadId;
  for (const [n, level, req] of [[1, "high", "creq_gaaaaaaaaa"], [2, "low", "creq_gbbbbbbbbb"]] as const) {
    const turn = await h.send("turn/start", { threadId: "google-thread", providerThreadId: sessionId, clientRequestId: req, input: [{ type: "text", text: "synthetic google " + level, mentions: [] }], options: h.options("gemini-4-argon", level) });
    assert.ok(turn.result, JSON.stringify(turn));
    await h.waitCompleted(n);
  }
  const rpc = h.rpc();
  const prompts = rpc.flatMap((r, i) => r.method === "session/prompt" ? [i] : []);
  assert.equal(prompts.length, 2);
  const applied = (end: number) => rpc.slice(0, end).filter(r => (r.method === "session/set_config_option" && r.params.configId === "model") || r.method === "session/set_model").at(-1);
  assert.equal(applied(prompts[0])?.params.value ?? applied(prompts[0])?.params.modelId, "gemini-4-argon-high");
  assert.equal(applied(prompts[1])?.params.value ?? applied(prompts[1])?.params.modelId, "gemini-4-argon-low");
});

test("any model the account's roster offers is listed and runs: new Gemini families, Claude, single-level models", async t => {
  const h = await harness(t, "wide-roster");
  const models = await h.send("model/list", { cwd: h.dir, providerOptions: h.options().providerOptions });
  assert.ok(models.result, JSON.stringify(models));
  const byId = new Map(models.result.models.map((m: any) => [m.id, (m.supportedReasoningEfforts ?? []).map((e: any) => e.reasoningEffort)]));
  assert.deepEqual(byId.get("gemini-5-carbon"), ["low", "medium", "high"]);
  assert.deepEqual(byId.get("gemini-3.8-flash"), ["medium", "high"]);
  assert.ok(byId.has("claude-opus-4-7"));
  assert.ok(byId.has("gpt-oss-120b"));
  const runs: Array<[string, string | undefined, string]> = [
    ["gemini-5-carbon", "high", "gemini-5-carbon-high"],
    ["claude-opus-4-7", undefined, "claude-opus-4-7"],
    ["gpt-oss-120b", "medium", "gpt-oss-120b-medium"],
  ];
  let completed = 0;
  for (const [index, [model, level, exact]] of runs.entries()) {
    const threadId = `wide-${index}`;
    const started = await h.send("thread/start", { threadId, cwd: h.dir, instructionMode: "append", options: h.options(model, level) });
    assert.ok(started.result, `${model}: ${JSON.stringify(started)}`);
    const turn = await h.send("turn/start", { threadId, providerThreadId: started.result.providerThreadId, clientRequestId: `creq_wide${"abc"[index]}aaaaa`, input: [{ type: "text", text: "synthetic", mentions: [] }], options: h.options(model, level) });
    assert.ok(turn.result, `${model}: ${JSON.stringify(turn)}`);
    await h.waitCompleted(++completed);
    const rpc = h.rpc();
    const prompt = rpc.map(r => r.method).lastIndexOf("session/prompt");
    const applied = rpc.slice(0, prompt).filter(r => r.method === "session/set_model").at(-1)?.params.modelId;
    assert.equal(applied, exact, model);
  }
});
