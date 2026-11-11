import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";

export async function harness(t: TestContext, mode = "variants", rawSdk = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reinh-acp-bridge-"));
  const bin = path.join(dir, "bin"); fs.mkdirSync(bin);
  const agentSource = fs.readFileSync(path.resolve("test/fixtures/catalog-agent.mjs"), "utf8").replace('import readline from "node:readline";', 'const readline = require("node:readline");').replace('import { appendFileSync, readFileSync } from "node:fs";', 'const { appendFileSync, readFileSync } = require("node:fs");');
  // The plugin recognises the agent by its file name. POSIX runs the script
  // through its shebang; Windows cannot, so node.exe itself carries the name.
  let executable: string, agentArgs: string[];
  if (process.platform === "win32") {
    executable = path.join(bin, "agy_acp_server.exe");
    try { fs.linkSync(process.execPath, executable); } catch { fs.copyFileSync(process.execPath, executable); }
    const script = path.join(dir, "catalog-agent.cjs");
    fs.writeFileSync(script, agentSource);
    agentArgs = [script];
  } else {
    executable = path.join(bin, "agy_acp_server.par");
    fs.writeFileSync(executable, agentSource); fs.chmodSync(executable, 0o700);
    agentArgs = [];
  }
  const log = path.join(dir, "rpc.ndjson");
  const child = spawn(process.execPath, ["--import", "./test/node-runtime.mjs", "--import", "tsx", "test/fixtures/bridge-runner.ts"], {
    env: { ...process.env, HOME: dir, GEMINI_HOME: path.join(dir, "gemini"), TEST_CACHE_DIR: path.join(dir, "cache"), PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_ACP_MODE: mode, TEST_RPC_LOG: log, REINH_TEST_RAW_SDK: rawSdk ? "1" : "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "", nextId = 1;
  child.stderr.on("data", chunk => { stderr += chunk; });
  const responses = new Map<number, (value: any) => void>();
  const events: any[] = [];
  const watchers = new Set<() => void>();
  readline.createInterface({ input: child.stdout }).on("line", line => {
    const message = JSON.parse(line); events.push(message);
    for (const watcher of watchers) watcher();
    if (message.id !== undefined && !message.method) responses.get(message.id)?.(message);
  });
  const done = new Promise(resolve => child.once("close", resolve));
  t.after(async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
    await done; clearTimeout(timer);
  });
  function send(method: string, params: unknown): Promise<any> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { responses.delete(id); reject(new Error(`Bridge request ${method} timed out: ${stderr}`)); }, 8000);
      responses.set(id, value => { clearTimeout(timer); responses.delete(id); resolve(value); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  const launch = { displayName: "Synthetic Antigravity", command: executable, args: agentArgs, env: { TEST_ACP_MODE: mode, TEST_RPC_LOG: log } };
  const options = (model?: string, reasoningLevel?: string) => ({ model, reasoningLevel,
    permissionMode: "accept-edits", permissionScope: "workspace", approvalReviewer: "user", permissionEscalation: "deny",
    providerOptions: { acpLaunchSpec: structuredClone(launch) },
  });
  const initialize = await send("initialize", { protocolVersion: 2, client: { name: "reinh-test", version: "1" } });
  assert.ok(initialize.result, JSON.stringify(initialize));
  const waitCompleted = (count: number) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { watchers.delete(check); reject(new Error(`No completed turn: ${JSON.stringify(events)} ${stderr}`)); }, 8000);
    const check = () => {
      if (events.filter(e => e.method === "thread/delta" && e.params.deltas.some((d: any) => d.kind === "turn.boundary" && d.status === "completed")).length >= count) { clearTimeout(timer); watchers.delete(check); resolve(); }
    };
    watchers.add(check); check();
  });
  const record = (name: string, data: unknown) => {
    if (!process.env.REINH_TEST_EVIDENCE_DIR) return;
    const clean = JSON.stringify({ evidence: "SYNTHETIC ACP — NOT GOOGLE", data }, null, 2).replaceAll(dir, "<isolated-home>").replaceAll(process.cwd(), "<repo>");
    fs.writeFileSync(path.join(process.env.REINH_TEST_EVIDENCE_DIR, `${name}.json`), clean + "\n");
  };
  return { send, options, events, dir, waitCompleted, record,
    rpc: () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [],
  };
}

