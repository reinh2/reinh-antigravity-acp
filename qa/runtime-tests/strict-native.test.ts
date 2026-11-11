import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "../../test/helpers/bridge-harness.js";
for (const [mode, message] of [["native-missing", /reasoning config/], ["native-unsupported", /not supported/], ["native-mismatch", /different reasoning/], ["model-mismatch", /different model/]] as const) {
  test(`executing session rejects ${mode} before any prompt`, async t => {
    const h = await harness(t, mode);
    const response = await h.send("thread/start", { threadId: "strict-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
    assert.ok(response.error, JSON.stringify(response));
    assert.match(response.error.message, message);
    assert.ok(h.rpc().filter(r => r.method === "session/new").length >= 2, "discovery plus actual execution reached");
    assert.equal(h.rpc().filter(r => r.method === "session/prompt").length, 0);
  });
}
for (const mode of ["native-null", "native-empty"]) test(`legacy successful ${mode} ACK remains compatible`, async t => {
  const h = await harness(t, mode);
  const started = await h.send("thread/start", { threadId: "ack-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const turn = await h.send("turn/start", { threadId: "ack-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_abcdefghij", input: [{ type: "text", text: "synthetic legacy ACK", mentions: [] }], options: h.options("gemini-4-argon", "high") });
  assert.ok(turn.result, JSON.stringify(turn)); await h.waitCompleted(1);
});
test("native custom IDs and omitted reasoning retain the requested level across turns", async t => {
  const h = await harness(t, "native-custom");
  const started = await h.send("thread/start", { threadId: "native-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  assert.ok(started.result, JSON.stringify(started));
  const params = { threadId: "native-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_abcdefghij", input: [{ type: "text", text: "synthetic native default", mentions: [] }], options: h.options("gemini-4-argon") };
  assert.ok((await h.send("turn/start", params)).result); await h.waitCompleted(1);
  const first = h.rpc().filter(r => r.method === "session/set_config_option" && r.params.configId === "budget_argon");
  assert.ok(first.length > 0); assert.ok(first.every(r => r.params.value === "high"));
  assert.ok((await h.send("turn/start", { ...params, clientRequestId: "creq_bcdefghijk", options: h.options("gemini-3.8-flash", "low") })).result); await h.waitCompleted(2);
  assert.ok(h.rpc().some(r => r.method === "session/set_config_option" && r.params.configId === "budget_flash" && r.params.value === "low"));
});
