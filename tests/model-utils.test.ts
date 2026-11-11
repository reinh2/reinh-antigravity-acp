import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEffort,
  normalizeModelId,
  extractVersion,
  compareVersions,
  parseRawModels,
  resolveRawModelId,
  rawListsEqual,
  type RawModel,
} from "../model-utils.js";

// Synthetic fixtures based on the upstream issue; not a live Google capture.
const CURRENT_RAW: RawModel[] = [
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
  { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)" },
  { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)" },
  { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)" },
  { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)" },
  { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
  { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
];

describe("normalizeEffort — generic, no allow-list", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(normalizeEffort("High"), "high");
    assert.equal(normalizeEffort("LOW-MEDIUM"), "low-medium");
    assert.equal(normalizeEffort("Thinking High"), "thinking-high");
    assert.equal(normalizeEffort("Ultra"), "ultra");
  });
  it("handles future naming conventions", () => {
    assert.equal(normalizeEffort(" Turbo "), "turbo");
    assert.equal(normalizeEffort("Default"), "default");
    assert.equal(normalizeEffort("None"), "none");
    assert.equal(normalizeEffort("Off"), "off");
    assert.equal(normalizeEffort("Max"), "max");
  });
});

describe("version parsing and latest flash model selection", () => {
  it("extracts and compares numeric versions", () => {
    assert.deepEqual(extractVersion("gemini-3.8-flash"), [3, 8]);
    assert.deepEqual(extractVersion("gemini-3.7-flash"), [3, 7]);
    assert.deepEqual(extractVersion("gemini-3.6-flash"), [3, 6]);
    assert.ok(compareVersions([3, 8], [3, 7]) > 0);
    assert.ok(compareVersions([3, 7], [3, 8]) < 0);
    assert.ok(compareVersions([3, 7], [3, 7]) === 0);
  });

  it("selects latest flash model by version descending (3.8 > 3.7 > 3.6)", () => {
    const { defaultFamilyId, models } = parseRawModels(CURRENT_RAW);
    assert.equal(defaultFamilyId, "gemini-3.8-flash");
    const defModel = models.find((m) => m.id === "gemini-3.8-flash")!;
    assert.ok(defModel.isDefault);
    assert.equal(defModel.defaultReasoningEffort, "medium");
  });

  it("automatically promotes newer flash model (e.g. 3.9 or 4.0) to default without code change", () => {
    const rawWithNewer: RawModel[] = [
      ...CURRENT_RAW,
      { id: "gemini-4.0-flash-medium", name: "Gemini 4.0 Flash (Medium)" },
      { id: "gemini-4.0-flash-high", name: "Gemini 4.0 Flash (High)" },
    ];
    const { defaultFamilyId, models } = parseRawModels(rawWithNewer);
    assert.equal(defaultFamilyId, "gemini-4.0-flash");
    const m4 = models.find((m) => m.id === "gemini-4.0-flash")!;
    assert.ok(m4.isDefault);
    assert.equal(m4.defaultReasoningEffort, "medium");
  });
});

describe("parseRawModels — dynamic discovery", () => {
  it("groups current 11 raw models into 4 families", () => {
    const { families, models, defaultFamilyId } = parseRawModels(CURRENT_RAW);
    assert.equal(families.size, 4);
    assert.equal(models.length, 4);
    assert.ok(families.has("gemini-3.8-flash"));
    assert.ok(families.has("gemini-3.7-flash"));
    assert.ok(families.has("gemini-3.6-flash"));
    assert.ok(families.has("gemini-3.1-pro"));
    assert.equal(defaultFamilyId, "gemini-3.8-flash");
  });

  it("strips effort from displayName, no double-naming", () => {
    const { models } = parseRawModels(CURRENT_RAW);
    for (const m of models) {
      assert.ok(!m.displayName.includes("("), `displayName should not contain parens: ${m.displayName}`);
    }
  });

  it("exposes only efforts actually available per family", () => {
    const { models } = parseRawModels(CURRENT_RAW);
    const pro = models.find((m) => m.id === "gemini-3.1-pro")!;
    // Pro only has low + high (mapped)
    assert.ok(pro.supportedReasoningEfforts.some((e) => e.reasoningEffort === "low"));
    assert.ok(pro.supportedReasoningEfforts.some((e) => e.reasoningEffort === "high"));
    assert.equal(pro.supportedReasoningEfforts.length, 2);
  });

  it("retains unknown future variants as standalone models without invalid reasoning", () => {
    const raw = [
      { id: "future-model-turbo", name: "Future Model (Turbo)" },
      { id: "future-model-thinking-high", name: "Future Model (Thinking High)" },
    ];
    const { models } = parseRawModels(raw);
    assert.equal(models.length, 2);
    for (const model of models) assert.deepEqual(model.supportedReasoningEfforts, []);
  });

  it("respects preferred default from settings (per-provider configurability)", () => {
    const pref = { model: "gemini-3.1-pro", effort: "low" } as const;
    const { models, defaultFamilyId } = parseRawModels(CURRENT_RAW, undefined, pref);
    assert.equal(defaultFamilyId, "gemini-3.1-pro");
    assert.ok(models.find((m) => m.id === "gemini-3.1-pro")!.isDefault);
    assert.equal(models.find((m) => m.id === "gemini-3.1-pro")!.defaultReasoningEffort, "low");
  });

  it("falls back to latest flash at medium if preferred default not in catalog", () => {
    const pref = { model: "non-existent", effort: "high" } as const;
    const { defaultFamilyId } = parseRawModels(CURRENT_RAW, undefined, pref);
    assert.equal(defaultFamilyId, "gemini-3.8-flash");
  });
});

describe("resolveRawModelId — launch variant resolution (tested via payload, not LLM)", () => {
  const catalog = parseRawModels(CURRENT_RAW);

  it("resolves family + reasoning to concrete ACP id", () => {
    assert.equal(resolveRawModelId("gemini-3.7-flash", "high", catalog), "gemini-3.7-flash-high");
    assert.equal(resolveRawModelId("gemini-3.7-flash", "medium", catalog), "gemini-3.7-flash-medium");
    assert.equal(resolveRawModelId("gemini-3.7-flash", "low", catalog), "gemini-3.7-flash-low");
  });

  it("supports passing ModelCatalog object directly (clean abstraction)", () => {
    assert.equal(resolveRawModelId("gemini-3.8-flash", "high", catalog), "gemini-3.8-flash-high");
    assert.equal(resolveRawModelId("gemini-3.8-flash", "medium", catalog), "gemini-3.8-flash-medium");
    assert.equal(resolveRawModelId(undefined, undefined, catalog), "gemini-3.8-flash-medium");
  });

  it("resolves gemini-3.1-pro variants (including gemini-pro-agent mapping)", () => {
    assert.equal(resolveRawModelId("gemini-3.1-pro", "high", catalog), "gemini-pro-agent");
    assert.equal(resolveRawModelId("gemini-3.1-pro", "low", catalog), "gemini-3.1-pro-low");
    assert.throws(() => resolveRawModelId("gemini-3.1-pro", "medium", catalog));
  });

  it("passes through raw legacy ids for backward compat", () => {
    assert.equal(resolveRawModelId("gemini-3.7-flash-high", undefined, catalog), "gemini-3.7-flash-high");
    assert.equal(resolveRawModelId("gemini-pro-agent", undefined, catalog), "gemini-pro-agent");
  });

  it("resolves default latest flash model at medium effort when model omitted", () => {
    const resolved = resolveRawModelId(undefined, undefined, catalog);
    assert.equal(resolved, "gemini-3.8-flash-medium");
  });

  it("rejects execution when discovery returned no models", () => {
    assert.throws(() => resolveRawModelId(undefined, undefined, parseRawModels([])));
  });

  it("allows future protocol-supported levels but rejects non-protocol labels", () => {
    const futureCatalog = parseRawModels([
      { id: "gemini-3.9-flash-ultra", name: "Gemini 3.9 Flash (Ultra)" },
      { id: "gemini-3.9-flash-default", name: "Gemini 3.9 Flash (Default)" },
    ]);
    assert.equal(resolveRawModelId("gemini-3.9-flash", "ultra", futureCatalog), "gemini-3.9-flash-ultra");
    assert.throws(() => resolveRawModelId("gemini-3.9-flash", "default", futureCatalog));
  });

  it("verifies intercepted payload rather than LLM identity", () => {
    const fakeLine = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "thread/start",
      params: { options: { model: "gemini-3.8-flash", reasoningLevel: "high" } },
    });
    const parsed = JSON.parse(fakeLine);
    const resolved = resolveRawModelId(parsed.params.options.model, parsed.params.options.reasoningLevel, catalog);
    assert.equal(resolved, "gemini-3.8-flash-high");
    parsed.params.options.model = resolved;
    assert.equal(JSON.parse(JSON.stringify(parsed)).params.options.model, "gemini-3.8-flash-high");
  });
});

describe("rawListsEqual — staleness detection", () => {
  it("detects added and deprecated models", () => {
    const a = [...CURRENT_RAW];
    const b = [...CURRENT_RAW, { id: "gemini-3.9-flash-ultra", name: "Gemini 3.9 Flash (Ultra)" }];
    assert.equal(rawListsEqual(a, b), false);
    assert.equal(rawListsEqual(a, a), true);
    const c = CURRENT_RAW.filter((m) => m.id !== "gemini-3.6-flash-low");
    assert.equal(rawListsEqual(CURRENT_RAW, c), false);
  });
});
