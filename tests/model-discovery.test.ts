import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { extractRawModels, queryAcpServer, type LaunchSpec } from "../model-discovery.js";
import { parseRawModels } from "../model-utils.js";
const spec: LaunchSpec = { command: process.execPath, args: [path.resolve("test/fixtures/catalog-agent.mjs")], env: {} };

test("discovery prefers valid variant roster over family-only config", () => {
  const raw = extractRawModels({ models: { availableModels: [null, { modelId: "gemini-4-argon-high", name: "Gemini 4 Argon (High)" }] },
    configOptions: [{ id: "model", type: "select", options: [{ value: "gemini-4-argon" }] }] });
  assert.deepEqual(raw, [{ id: "gemini-4-argon-high", name: "Gemini 4 Argon (High)" }]);
});
for (const roster of [undefined, [], [null, {}, { modelId: " " }]]) {
  test(`invalid or missing roster falls back to grouped config: ${JSON.stringify(roster)}`, () => {
    const raw = extractRawModels({ models: { availableModels: roster }, configOptions: [{
      id: "custom-model", category: "model", type: "select", currentValue: "gemini-4-argon",
      options: [{ group: "g", name: "G", options: [{ value: "gemini-4-argon", name: "Gemini 4 Argon" }, null] }],
    }] });
    assert.equal(raw[0].id, "gemini-4-argon");
    assert.deepEqual(parseRawModels(raw).models[0].supportedReasoningEfforts, []);
  });
}
test("malformed payloads are ignored without throwing", () => {
  for (const payload of [null, 1, { models: [] }, { configOptions: {} }, { configOptions: [null, { options: {} }] }]) assert.deepEqual(extractRawModels(payload), []);
});
test("real subprocess discovery exposes both Gemini families with real subsets", async () => {
  const raw = await queryAcpServer(spec);
  const catalog = parseRawModels(raw);
  assert.equal(catalog.models.length, 2);
  for (const model of catalog.models) assert.deepEqual(model.supportedReasoningEfforts.map(e => e.reasoningEffort), ["low", "medium", "high"]);
  assert.equal(catalog.defaultFamilyId, "gemini-3.8-flash");
});
test("config-only subprocess probes per-model thinking support", async () => {
  const catalog = parseRawModels(await queryAcpServer({ ...spec, env: { TEST_ACP_MODE: "config" } }));
  assert.deepEqual(catalog.models.find(m => m.id === "gemini-4-argon")!.supportedReasoningEfforts.map(e => e.reasoningEffort), ["low", "high"]);
  assert.deepEqual(catalog.models.find(m => m.id === "gemini-3.8-flash")!.supportedReasoningEfforts.map(e => e.reasoningEffort), ["low", "medium", "high"]);
});
for (const mode of ["silent", "exit", "auth"]) test(`discovery cleans up on ${mode}`, async () => {
  await assert.rejects(queryAcpServer({ ...spec, env: { TEST_ACP_MODE: mode } }, 300), /timed out|exited|request failed|authentication required/);
});
test("spawn failure rejects promptly without unhandled process errors", async () => {
  await assert.rejects(queryAcpServer({ command: "/nonexistent/reinh-test-agent", args: [], env: {} }, 1000), /launch|stdin|exited/);
});

test("family-only roster preserves native support and probes other families", async () => {
  const catalog = parseRawModels(await queryAcpServer({ ...spec, env: { TEST_ACP_MODE: "family-roster" } }));
  assert.deepEqual(catalog.models.find(m => m.id === "gemini-4-argon")!.supportedReasoningEfforts.map(e => e.reasoningEffort), ["low", "high"]);
});
test("cached-token handshake runs before discovery and returns typed auth recovery on failure", async () => {
  assert.equal((await queryAcpServer({ ...spec, env: { TEST_ACP_MODE: "cached-auth" } })).length, 6);
  await assert.rejects(queryAcpServer({ ...spec, env: { TEST_ACP_MODE: "auth-fail" } }), error => error instanceof Error && error.constructor.name === "AcpDiscoveryAuthError");
});

test("headless authentication timeout remains a connection error, not authRequired", async () => {
  await assert.rejects(queryAcpServer({ ...spec, env: { TEST_ACP_MODE: "auth-silent" } }, 300), error => error instanceof Error && error.constructor.name !== "AcpDiscoveryAuthError" && /timed out/.test(error.message));
});
