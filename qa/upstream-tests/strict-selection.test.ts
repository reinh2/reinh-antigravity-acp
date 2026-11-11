// Required release gates. These intentionally fail on the unmodified SDK 0.6.132.
// Synthetic ACP processes only: no Google, credentials, installed plugin or user data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "../../test/helpers/bridge-harness.js";

test("release gate: execution-session roster drift must reject a missing selected model", async t => {
  const h = await harness(t, "runtime-drift");
  const started = await h.send("thread/start", { threadId: "drift-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  if (!started.error) {
    const prompt = await h.send("turn/start", { threadId: "drift-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_abcdefghij", input: [{ type: "text", text: "synthetic drift probe", mentions: [] }], options: h.options("gemini-4-argon", "high") });
    if (prompt.result) await h.waitCompleted(1);
  }
  h.record("upstream-runtime-drift", { started, rpc: h.rpc(), events: h.events });
  assert.ok(started.error, "SDK must reject Argon-high when the executing session advertises only Flash; it currently reports success");
  assert.equal(h.rpc().filter(r => r.method === "session/prompt").length, 0);
});

test("release gate: concurrent changed turns must not pass model reconciliation together", async t => {
  const h = await harness(t, "slow-low");
  const started = await h.send("thread/start", { threadId: "race-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const params = { threadId: "race-thread", providerThreadId: started.result.providerThreadId, input: [{ type: "text", text: "synthetic low request", mentions: [] }], options: h.options("gemini-4-argon", "low"), clientRequestId: "creq_abcdefghij" };
  const low = h.send("turn/start", params);
  const deadline = Date.now() + 2000;
  while (!h.rpc().some(r => r.method === "session/set_model" && r.params.modelId.endsWith("-low"))) {
    if (Date.now() > deadline) throw new Error("Low selection RPC was not observed");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const high = h.send("turn/start", { ...params, clientRequestId: "creq_bcdefghijk", input: [{ type: "text", text: "synthetic high request", mentions: [] }], options: h.options("gemini-4-argon", "high") });
  const [lowResult, highResult] = await Promise.all([low, high]);
  h.record("upstream-concurrent-turns", { lowResult, highResult, rpc: h.rpc(), events: h.events });
  assert.ok(lowResult.result, JSON.stringify(lowResult));
  assert.ok(highResult.error, "SDK must reject the second start while the first is applying its model selection");
  await h.waitCompleted(1);
  assert.equal(h.rpc().filter(r => r.method === "session/prompt").length, 1);
});
