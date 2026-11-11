// Edge cases of the locally corrected ACP runtime. Synthetic ACP processes only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "../../test/helpers/bridge-harness.js";

const input = (text: string) => [{ type: "text", text, mentions: [] }];
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${label} was not observed`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("thread/stop during a pending model selection never sends a prompt", async t => {
  const h = await harness(t, "slow-low");
  const started = await h.send("thread/start", { threadId: "stop-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const turn = h.send("turn/start", { threadId: "stop-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_abcdefghij", input: input("synthetic cancelled request"), options: h.options("gemini-4-argon", "low") });
  await until(() => h.rpc().some(r => r.method === "session/set_model" && r.params.modelId.endsWith("-low")), "Low selection RPC");
  const stopped = await h.send("thread/stop", { threadId: "stop-thread", providerThreadId: started.result.providerThreadId, intent: "release", activeTurnId: null });
  assert.ok(stopped.result !== undefined, JSON.stringify(stopped));
  await turn;
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(h.rpc().filter(r => r.method === "session/prompt").length, 0);
});

test("concurrent thread/resume requests are not admitted together", async t => {
  const h = await harness(t, "slow-load");
  const started = await h.send("thread/start", { threadId: "resume-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const released = await h.send("thread/stop", { threadId: "resume-thread", providerThreadId: started.result.providerThreadId, intent: "release", activeTurnId: null });
  assert.ok(released.result !== undefined, JSON.stringify(released));
  const params = { threadId: "resume-thread", providerThreadId: started.result.providerThreadId, cwd: h.dir, instructionMode: "append" };
  const first = h.send("thread/resume", { ...params, options: h.options("gemini-4-argon", "low") });
  await until(() => h.rpc().some(r => r.method === "session/load"), "session/load");
  const second = await h.send("thread/resume", { ...params, options: h.options("gemini-4-argon", "high") });
  const firstResult = await first;
  assert.ok(firstResult.result, JSON.stringify(firstResult));
  assert.ok(second.error, "second resume must be rejected while the first applies its settings");
  const turn = await h.send("turn/start", { threadId: "resume-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_bcdefghijk", input: input("synthetic after resume"), options: h.options("gemini-4-argon", "low") });
  assert.ok(turn.result, JSON.stringify(turn));
  await h.waitCompleted(1);
  const rpc = h.rpc();
  const prompt = rpc.map(r => r.method).lastIndexOf("session/prompt");
  const lastModel = rpc.slice(0, prompt).filter(r => r.method === "session/set_model").at(-1);
  assert.equal(lastModel?.params.modelId, "gemini-4-argon-low");
});

test("resume without restore metadata still applies the requested model before prompt", async t => {
  const h = await harness(t, "restore-null");
  const started = await h.send("thread/start", { threadId: "null-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const released = await h.send("thread/stop", { threadId: "null-thread", providerThreadId: started.result.providerThreadId, intent: "release", activeTurnId: null });
  assert.ok(released.result !== undefined, JSON.stringify(released));
  const resumed = await h.send("thread/resume", { threadId: "null-thread", providerThreadId: started.result.providerThreadId, cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "medium") });
  assert.ok(resumed.result, JSON.stringify(resumed));
  const turn = await h.send("turn/start", { threadId: "null-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_cdefghijkm", input: input("synthetic restore"), options: h.options("gemini-4-argon", "medium") });
  assert.ok(turn.result, JSON.stringify(turn));
  await h.waitCompleted(1);
  const rpc = h.rpc();
  const load = rpc.map(r => r.method).lastIndexOf("session/load");
  const prompt = rpc.map(r => r.method).lastIndexOf("session/prompt");
  assert.ok(load >= 0 && prompt > load);
  assert.ok(rpc.slice(load, prompt).some(r => r.method === "session/set_model" && r.params.modelId === "gemini-4-argon-medium"));
});
