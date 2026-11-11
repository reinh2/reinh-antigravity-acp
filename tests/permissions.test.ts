// accept-edits must not ask the user for each file edit inside the workspace,
// while edits elsewhere and commands still go to the user. Synthetic ACP only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "../test/helpers/bridge-harness.js";

async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${label} was not observed`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("accept-edits auto-approves workspace edits and still asks for the rest", async t => {
  const h = await harness(t, "edit-permission");
  const started = await h.send("thread/start", { threadId: "perm-thread", cwd: h.dir, instructionMode: "append", options: h.options("gemini-3.8-flash", "low") });
  assert.ok(started.result, JSON.stringify(started));
  const turn = await h.send("turn/start", { threadId: "perm-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_permaaaaaa", input: [{ type: "text", text: "synthetic edit", mentions: [] }], options: h.options("gemini-3.8-flash", "low") });
  assert.ok(turn.result, JSON.stringify(turn));
  const answered = () => h.rpc().filter(r => r.fixtureEvent === "permission");
  const asked = () => h.events.filter(e => e.method === "interaction/request");
  await until(() => answered().some(r => r.which === "inside"), "workspace edit approval");
  await until(() => asked().length >= 3, "user prompts for the other requests");
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(answered().map(r => [r.which, r.outcome]), [["inside", { outcome: "selected", optionId: "allow" }]]);
  assert.equal(asked().length, 3);
});

test("full permission mode still approves every request without asking", async t => {
  const h = await harness(t, "edit-permission");
  const full = (model: string, level: string) => ({ ...h.options(model, level), permissionMode: "full", permissionScope: "full", approvalReviewer: null, permissionEscalation: null });
  const started = await h.send("thread/start", { threadId: "full-thread", cwd: h.dir, instructionMode: "append", options: full("gemini-3.8-flash", "low") });
  assert.ok(started.result, JSON.stringify(started));
  const turn = await h.send("turn/start", { threadId: "full-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_permbbbbbb", input: [{ type: "text", text: "synthetic edit", mentions: [] }], options: full("gemini-3.8-flash", "low") });
  assert.ok(turn.result, JSON.stringify(turn));
  await until(() => h.rpc().filter(r => r.fixtureEvent === "permission").length === 4, "four approvals");
  assert.ok(h.rpc().filter(r => r.fixtureEvent === "permission").every(r => r.outcome.optionId === "allow"));
  assert.equal(h.events.filter(e => e.method === "interaction/request").length, 0);
});

test("Antigravity is not told about extra write roots, so its working directory stays the project", async t => {
  const h = await harness(t, "edit-permission");
  const storage = h.dir + "/zz-thread-storage";
  const withRoot = (model: string, level: string) => {
    const options = h.options(model, level);
    return { ...options, providerOptions: { ...options.providerOptions, additionalWorkspaceWriteRoots: [storage] } };
  };
  const started = await h.send("thread/start", { threadId: "roots-thread", cwd: h.dir, instructionMode: "append", options: withRoot("gemini-3.8-flash", "low") });
  assert.ok(started.result, JSON.stringify(started));
  const created = h.rpc().filter(r => r.method === "session/new").at(-1);
  assert.equal(created.params.cwd, h.dir);
  assert.equal(created.params.additionalDirectories, undefined);
  // The root still belongs to BB's write policy: an edit there is auto-approved.
  const turn = await h.send("turn/start", { threadId: "roots-thread", providerThreadId: started.result.providerThreadId, clientRequestId: "creq_permcccccc", input: [{ type: "text", text: "synthetic edit", mentions: [] }], options: withRoot("gemini-3.8-flash", "low") });
  assert.ok(turn.result, JSON.stringify(turn));
  await until(() => h.rpc().some(r => r.fixtureEvent === "permission" && r.which === "inside"), "workspace edit approval");
});
