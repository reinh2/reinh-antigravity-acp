import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResetTime, parseUsageReport, toProviderWindows, UsageCache } from "../usage.js";
import { harness } from "../test/helpers/bridge-harness.js";

// Shape copied from a real Antigravity `/usage` answer (no personal data in it).
const REPORT = `### Session Usage
- **Session total:** data not available yet

### Quota Limits
- **Gemini Models**
  *(Models within this group: Gemini Flash, Gemini Pro)*
  - **Weekly Limit Remaining:** 97% remaining (resets Nov 14, 2026, 06:48 UTC)
  - **Five Hour Limit Remaining:** 99% remaining (resets Nov 11, 2026, 19:51 UTC)
- **Claude and GPT models**
  *(Models within this group: Claude Opus, Claude Sonnet, GPT-OSS)*
  - **Weekly Limit Remaining:** 42% remaining (resets Nov 16, 2026, 15:08 UTC)
  - **Five Hour Limit Remaining:** 100% remaining (resets Nov 11, 2026, 21:22 UTC)
- **Gemini 4 Argon**
  *(For paid Pro plans, Argon quota is separate. Higher Argon quota (included as part of the larger Gemini quota bucket) is available on Ultra plans.)*
  - **Gemini 4 Argon Weekly Limit:** 60% remaining (resets Nov 14, 2026, 06:44 UTC)`;

const FAMILIES = [{ id: "gemini-4-argon", displayName: "Gemini 4 Argon" }, { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash" }];
const EXPECTED = [
  { id: "gemini-models-weekly", label: "7d · Flash/Pro", kind: "custom", model: "gemini-3.8-flash", usedPercent: 3, resetsAt: "2026-11-14T06:48:00.000Z" },
  { id: "gemini-models-5h", label: "5h · Flash/Pro", kind: "custom", model: "gemini-3.8-flash", usedPercent: 1, resetsAt: "2026-11-11T19:51:00.000Z" },
  { id: "gemini-4-argon-weekly", label: "7d · Argon", kind: "custom", model: "gemini-4-argon", usedPercent: 40, resetsAt: "2026-11-14T06:44:00.000Z" },
];

test("Argon and Flash/Pro quota are reported as separate windows", () => {
  const report = parseUsageReport(REPORT);
  assert.equal(report.windows.length, 5);
  assert.deepEqual(toProviderWindows(report, FAMILIES), EXPECTED);
});

test("a bucket covering two catalog families is not tied to either one", () => {
  const both = [...FAMILIES, { id: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro" }];
  const windows = toProviderWindows(parseUsageReport(REPORT), both);
  assert.deepEqual(windows.map(w => w.model), [null, null, "gemini-4-argon"]);
});

test("new Gemini families and Claude/GPT buckets are shown when the account's roster has those models", () => {
  const wide = `### Quota Limits
- **Gemini 5 Carbon**
  - **Gemini 5 Carbon Weekly Limit:** 80% remaining (resets Nov 14, 2026, 06:44 UTC)
- **Claude and GPT models**
  *(Models within this group: Claude Opus, Claude Sonnet, GPT-OSS)*
  - **Weekly Limit Remaining:** 42% remaining (resets Nov 16, 2026, 15:08 UTC)`;
  const families = [{ id: "gemini-5-carbon", displayName: "Gemini 5 Carbon" }, { id: "claude-opus-4-7", displayName: "Claude Opus 4.7" }];
  assert.deepEqual(toProviderWindows(parseUsageReport(wide), families).map(w => [w.label, w.model, w.usedPercent]), [
    ["7d · Carbon", "gemini-5-carbon", 20],
    ["7d · Claude and GPT", "claude-opus-4-7", 58],
  ]);
  // Without Claude in the catalog the Claude/GPT bucket stays hidden; a new Gemini bucket never does.
  assert.deepEqual(toProviderWindows(parseUsageReport(wide), []).map(w => w.label), ["7d · Carbon"]);
});

test("buckets for models this provider cannot run are left out", () => {
  const labels = toProviderWindows(parseUsageReport(REPORT)).map(w => w.label);
  assert.ok(labels.every(label => !/claude|gpt/i.test(label)));
});

test("reset times parse as UTC; unknown formats become null", () => {
  assert.equal(parseResetTime("Nov 14, 2026, 06:44 UTC"), "2026-11-14T06:44:00.000Z");
  assert.equal(parseResetTime("Sept 2, 2026, 6:05 UTC"), "2026-09-02T06:05:00.000Z");
  assert.equal(parseResetTime("tomorrow"), null);
});

test("non-quota text and session totals never become windows", () => {
  assert.deepEqual(parseUsageReport("### Session Usage\n- **Weekly Limit Remaining:** 5% remaining").windows, []);
  assert.deepEqual(parseUsageReport("random text 50% remaining").windows, []);
  const na = parseUsageReport("### Quota Limits\n- Quota limits are not applicable for the current auth method.");
  assert.deepEqual(na, { windows: [], notApplicable: true });
});

test("remaining percentages are clamped and a missing reset is null", () => {
  const report = parseUsageReport("### Quota Limits\n- **Gemini 4 Argon**\n  - **Daily Limit:** 140% remaining");
  assert.deepEqual(toProviderWindows(report), [{ id: "gemini-4-argon-daily", label: "1d · Argon", kind: "custom", model: null, usedPercent: 0, resetsAt: null }]);
});

test("usage cache reuses fresh results, coalesces reads and retries errors", async () => {
  let now = 0, reads = 0, fail = true;
  const cache = new UsageCache(async () => {
    reads++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return fail ? { supported: true, usage: { status: "error", message: "x", accountEmail: null, planLabel: null } }
      : { supported: true, usage: { status: "ok", accountEmail: null, planLabel: null, windows: [] } };
  }, 60_000, () => now);
  const spec = { command: "agy", args: [], env: {} };
  await Promise.all([cache.get(spec), cache.get(spec)]);
  assert.equal(reads, 1);
  fail = false;
  await cache.get(spec); assert.equal(reads, 2);
  await cache.get(spec); assert.equal(reads, 2);
  now = 60_001;
  await cache.get(spec); assert.equal(reads, 3);
});

test("provider/usage returns Antigravity quota through the bridge without a model turn", async t => {
  const h = await harness(t);
  const response = await h.send("provider/usage", { providerId: "acp-antigravity", providerOptions: h.options().providerOptions });
  assert.ok(response.result, JSON.stringify(response));
  assert.deepEqual(response.result, { supported: true, usage: { status: "ok", accountEmail: null, planLabel: "Synthetic Pro", windows: EXPECTED } });
  const rpc = h.rpc();
  const prompts = rpc.filter(r => r.method === "session/prompt");
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].params.prompt, [{ type: "text", text: "/usage" }]);
  assert.equal(rpc.filter(r => r.method === "session/set_model" || r.method === "session/set_config_option").length, 0);
});

test("provider/usage reports unauthenticated and not-applicable auth honestly", async t => {
  const auth = await harness(t, "auth");
  const unauth = await auth.send("provider/usage", { providerId: "acp-antigravity", providerOptions: auth.options().providerOptions });
  assert.deepEqual(unauth.result, { supported: true, usage: { status: "unauthenticated" } });
  const na = await harness(t, "usage-na");
  const result = await na.send("provider/usage", { providerId: "acp-antigravity", providerOptions: na.options().providerOptions });
  assert.equal(result.result.usage.status, "ok");
  assert.deepEqual(result.result.usage.windows, []);
});
