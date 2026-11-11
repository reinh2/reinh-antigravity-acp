import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CACHE_TTL_MS, ModelCatalogCache, launchKey } from "../model-cache.js";
import type { LaunchSpec } from "../model-discovery.js";
const spec: LaunchSpec = { command: "synthetic-agent", args: [], env: {} };
const fixture = [{ id: "gemini-4-argon-high", name: "Gemini 4 Argon (High)" }];
const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), "reinh-model-cache-"));

test("coalesces concurrent refreshes and changes TTL catalog without stale fallback", async () => {
  let now = 1000, count = 0;
  let raw = fixture;
  const cache = new ModelCatalogCache(directory(), async () => { count++; await new Promise(resolve => setImmediate(resolve)); return raw; }, () => now);
  await Promise.all([cache.get(spec), cache.get(spec)]);
  assert.equal(count, 1);
  raw = [{ id: "new-model-low", name: "New Model (Low)" }];
  now += CACHE_TTL_MS;
  assert.equal((await cache.get(spec)).models[0].id, "new-model");
  assert.equal(count, 2);
  raw = [];
  now += CACHE_TTL_MS;
  await assert.rejects(cache.get(spec), /empty/);
});
test("launch keys isolate environments and simultaneous discoveries", async () => {
  const cache = new ModelCatalogCache(directory(), async spec => [{ id: spec.env.TEST_MODEL, name: spec.env.TEST_MODEL }]);
  const [a, b] = await Promise.all([cache.get({ ...spec, env: { TEST_MODEL: "a" } }), cache.get({ ...spec, env: { TEST_MODEL: "b" } })]);
  assert.equal(a.models[0].id, "a"); assert.equal(b.models[0].id, "b");
  assert.notEqual(launchKey(spec), launchKey({ ...spec, cwd: "/other-workspace" }));
});
test("settings defaults reapply without requerying or leaking between callers", async () => {
  let count = 0;
  const cache = new ModelCatalogCache(directory(), async () => { count++; return [...fixture, { id: "gemini-4-argon-low", name: "Gemini 4 Argon (Low)" }]; });
  const get = (effort: string) => cache.get({ ...spec, env: { BB_ANTIGRAVITY_DEFAULT_MODEL: "gemini-4-argon", BB_ANTIGRAVITY_DEFAULT_REASONING: effort } });
  assert.equal((await get("low")).models[0].defaultReasoningEffort, "low");
  assert.equal((await get("high")).models[0].defaultReasoningEffort, "high");
  assert.equal(count, 1);
});
test("disk schema rejects legacy, corrupt, and future timestamps; disk roundtrip keeps metadata", async () => {
  const dir = directory(); const file = path.join(dir, `${launchKey(spec)}.json`);
  let count = 0;
  const query = async () => { count++; return fixture; };
  for (const value of ["{", JSON.stringify({ rawModels: fixture, timestamp: Date.now() }), JSON.stringify({ version: 2, key: launchKey(spec), timestamp: Date.now() + 100_000, rawModels: fixture })]) {
    fs.writeFileSync(file, value);
    await new ModelCatalogCache(dir, query).get(spec);
  }
  assert.equal(count, 3);
  await new ModelCatalogCache(dir, async () => { throw new Error("must use fresh disk cache"); }).get(spec);
});
test("failed stale discovery is retryable and cannot execute the stale catalog", async () => {
  let now = 1000, fail = false;
  const cache = new ModelCatalogCache(directory(), async () => { if (fail) throw new Error("offline"); return fixture; }, () => now);
  await cache.get(spec); now += CACHE_TTL_MS; fail = true;
  await assert.rejects(cache.get(spec), /offline/);
  await assert.rejects(cache.get(spec), /offline/);
  fail = false; assert.equal((await cache.get(spec)).models.length, 1);
});

test("failed forced refresh cannot reload a still-fresh disk catalog in the same host", async () => {
  let fail = false, calls = 0;
  const cache = new ModelCatalogCache(directory(), async () => { calls++; if (fail) throw new Error("offline"); return fixture; });
  await cache.get(spec);
  fail = true;
  await assert.rejects(cache.get(spec, true), /offline/);
  await assert.rejects(cache.get(spec), /offline/);
  assert.equal(calls, 3);
});
