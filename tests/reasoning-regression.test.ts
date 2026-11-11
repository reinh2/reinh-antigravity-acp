import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRawModels, resolveRawModelId } from "../model-utils.js";

test("family-only ids never become reasoning levels", () => {
  const catalog = parseRawModels([
    { id: "gemini-4-argon", name: "Gemini 4 Argon" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  ]);
  for (const model of catalog.models) {
    assert.deepEqual(model.supportedReasoningEfforts, []);
  }
});

test("id-only genuine variants group without labels containing parentheses", () => {
  const catalog = parseRawModels(["low", "medium", "high"].map(level => ({
    id: `gemini-4-argon-${level}`, name: `Gemini 4 Argon ${level}`,
  })));
  assert.equal(catalog.models.length, 1);
  assert.equal(resolveRawModelId("gemini-4-argon", "high", catalog), "gemini-4-argon-high");
});

test("missing models and unsupported effort never synthesize ACP ids", () => {
  const catalog = parseRawModels([{ id: "gemini-4-argon-high", name: "Gemini 4 Argon (High)" }]);
  assert.throws(() => resolveRawModelId("removed-model", "low", catalog));
  assert.throws(() => resolveRawModelId("gemini-4-argon", "medium", catalog));
});

test("a raw variant can switch effort within its own family", () => {
  const catalog = parseRawModels(["low", "high"].map(level => ({
    id: `gemini-4-argon-${level}`, name: `Gemini 4 Argon (${level})`,
  })));
  assert.equal(resolveRawModelId("gemini-4-argon-low", "high", catalog), "gemini-4-argon-high");
});

test("a single supported level does not invent a ladder", () => {
  const catalog = parseRawModels([{ id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" }]);
  assert.deepEqual(catalog.models[0].supportedReasoningEfforts.map(e => e.reasoningEffort), ["low"]);
  assert.equal(resolveRawModelId(undefined, undefined, catalog), "gemini-3.8-flash-low");
});
test("opaque ACP ids keep exact punctuation and case at execution", () => {
  const catalog = parseRawModels([{ id: "provider/Model:Preview", name: "Model (Preview)" }]);
  assert.equal(resolveRawModelId("provider/Model:Preview", undefined, catalog), "provider/Model:Preview");
});
test("native configured defaults are resolved even when family id is also a raw id", () => {
  const catalog = parseRawModels([{ id: "gemini-4-argon", name: "Gemini 4 Argon", nativeReasoning: { configId: "thinking_level", levelValues: { low: "low", high: "high" } } }], undefined, { model: "gemini-4-argon", effort: "high" });
  assert.equal(catalog.families.get("gemini-4-argon")!.defaultEffort, "high");
  // Executing native config is separately blocked by the SDK compatibility guard.
  assert.equal(resolveRawModelId("gemini-4-argon", undefined, catalog), "gemini-4-argon");
});

test("ACP current variant default is preserved unless plugin settings override it", () => {
  const raw = ["low", "medium", "high"].map(level => ({ id: `gemini-4-argon-${level}`, name: `Gemini 4 Argon (${level})`, isDefault: level === "high" }));
  assert.equal(parseRawModels(raw).models[0].defaultReasoningEffort, "high");
  assert.equal(parseRawModels(raw, undefined, { model: "Gemini 4 Argon", effort: "low" }).models[0].defaultReasoningEffort, "low");
});

test("contradictory suffix and label are not advertised as an executable effort", () => {
  const catalog = parseRawModels([{ id: "gemini-4-argon-low", name: "Gemini 4 Argon (High)" }]);
  assert.deepEqual(catalog.models[0].supportedReasoningEfforts, []);
  assert.throws(() => resolveRawModelId("gemini-4-argon", "high", catalog));
});
test("plain roster family id does not bypass its configured concrete variant default", () => {
  const raw = [{ id: "gemini-4-argon", name: "Gemini 4 Argon" }, ...["low", "high"].map(level => ({ id: `gemini-4-argon-${level}`, name: `Gemini 4 Argon (${level})` }))];
  const catalog = parseRawModels(raw, undefined, { model: "gemini-4-argon", effort: "high" });
  assert.equal(resolveRawModelId("gemini-4-argon", undefined, catalog), "gemini-4-argon-high");
});
