// Raw SDK check: the plugin currently blocks this path until upstream is strict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "../../test/helpers/bridge-harness.js";

test("upstream native thinking refusal must fail session construction", async t => {
  const h = await harness(t, "native-refuse", true);
  const started = await h.send("thread/start", { threadId: "native-refusal", cwd: h.dir, instructionMode: "append", options: h.options("gemini-4-argon", "high") });
  h.record("upstream-native-refusal", { started, rpc: h.rpc(), events: h.events });
  assert.ok(h.rpc().some(r => r.method === "session/set_config_option" && r.params.configId === "thinking_level" && r.params.value === "high"));
  assert.ok(started.error, "SDK must propagate the actual thinking RPC refusal instead of reporting a successful construction");
});
