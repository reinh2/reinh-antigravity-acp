import { test } from "node:test";
import assert from "node:assert/strict";
import plugin from "../server.js";

test("provider identity, permissions, host RPC and settings remain compatible", async () => {
  const registrations: any[] = [], commands: any[] = [];
  let onChange!: (next: any) => void;
  let disposed = 0;
  const rpc: { contract?: any; handlers?: any; options?: any } = {};
  let hostAnswer: any = { status: "ok", planLabel: "Google AI Pro", windows: [{ id: "gemini-4-argon-weekly", label: "Gemini 4 Argon · weekly", kind: "weekly", model: "gemini-4-argon", usedPercent: 40, resetsAt: "2026-11-14T06:44:00.000Z" }] };
  const hostCalls: any[] = [];
  const settings = { installDir: "~/.local/opt/agy-acp-server", binDir: "~/.local/bin", defaultModel: "gemini-4-argon", defaultReasoningEffort: "high" };
  const api = {
    settings: { define() { return { async get() { return settings; }, onChange(handler: typeof onChange) { onChange = handler; } }; } },
    providers: { register(value: unknown) { registrations.push(value); return { dispose() { disposed++; } }; } },
    hosts: { experimental_client() { return { async call(method: string, input: unknown, options: any) { hostCalls.push([method, input, options.hostId]); if (hostAnswer instanceof Error) throw hostAnswer; return hostAnswer; } }; } },
    rpc: { register(contract: unknown, handlers: unknown, options: unknown) { Object.assign(rpc, { contract, handlers, options }); } },
    sdk: { hosts: { async list() { return [{ id: "host_a", name: "Mac", status: "connected" }, { id: "host_b", name: "Off", status: "disconnected" }]; } } },
    cli: { register(value: unknown) { commands.push(value); } },
  };
  await plugin(api as unknown as Parameters<typeof plugin>[0]);
  const provider = registrations[0];
  assert.equal(provider.id, "acp-antigravity");
  assert.equal(provider.family, "acp");
  assert.deepEqual(provider.capabilities.permissionModes, ["accept-edits", "full"]);
  assert.equal(provider.experimental_bridgeOptions.acpLaunchSpec.env.BB_ANTIGRAVITY_DEFAULT_MODEL, "gemini-4-argon");
  assert.equal(provider.experimental_bridgeOptions.acpLaunchSpec.env.BB_ANTIGRAVITY_DEFAULT_REASONING, "high");
  assert.deepEqual(provider.reasoningLevels.map((level: any) => level.id), ["low", "medium", "high"]);
  assert.equal(commands[0].name, "google-antigravity-acp");
  onChange({ ...settings, defaultReasoningEffort: "low" });
  assert.equal(disposed, 1);
  assert.equal(registrations[1].experimental_bridgeOptions.acpLaunchSpec.env.BB_ANTIGRAVITY_DEFAULT_REASONING, "low");
});

test("Provider Usage panel source lists connected hosts and maps host quota", async () => {
  const rpc: any = {};
  let hostAnswer: any = { status: "ok", planLabel: "Google AI Pro", windows: [{ id: "gemini-4-argon-weekly", label: "Gemini 4 Argon · weekly", kind: "weekly", model: "gemini-4-argon", usedPercent: 40, resetsAt: "2026-11-14T06:44:00.000Z" }] };
  const api = {
    settings: { define() { return { async get() { return { installDir: "a", binDir: "b", defaultModel: "", defaultReasoningEffort: "" }; }, onChange() {} }; } },
    providers: { register() { return { dispose() {} }; } },
    hosts: { experimental_client() { return { async call(method: string) { assert.equal(method, "usage"); if (hostAnswer instanceof Error) throw hostAnswer; return hostAnswer; } }; } },
    rpc: { register(contract: any, handlers: any) { Object.assign(rpc, { contract, handlers }); } },
    sdk: { hosts: { async list() { return [{ id: "host_a", name: "Mac", status: "connected" }, { id: "host_b", name: "Off", status: "disconnected" }]; } } },
    cli: { register() {} },
  };
  await plugin(api as unknown as Parameters<typeof plugin>[0]);
  const list = await rpc.handlers["provider-usage.v1.listResources"]({});
  assert.deepEqual(list.resources.map((r: any) => [r.id, r.providerId]), [["host_a", "acp-antigravity"]]);
  const get = (input: any) => rpc.handlers["provider-usage.v1.getResource"](input);
  const ok = await get({ resourceId: "host_a", refresh: false });
  assert.deepEqual(ok.usage, { status: "ok", plan: null, accountEmail: null, planLabel: "Google AI Pro", windows: [{ id: "gemini-4-argon-weekly", label: "Gemini 4 Argon · weekly", kind: "weekly", model: "gemini-4-argon", usedPercent: 40, resetsAt: "2026-11-14T06:44:00.000Z", cost: null }] });
  assert.ok(rpc.contract["provider-usage.v1.getResource"].output.safeParse(ok).success);
  hostAnswer = { status: "not_installed" };
  const missing = await get({ resourceId: "host_a", refresh: true });
  assert.deepEqual(missing.usage, { status: "not_installed", plan: null, accountEmail: null, planLabel: null });
  hostAnswer = new Error("host offline");
  const failed = await get({ resourceId: "host_a", refresh: true });
  assert.equal(failed.usage.status, "error");
  assert.ok(rpc.contract["provider-usage.v1.getResource"].output.safeParse(failed).success);
});
