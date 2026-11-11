// CI smoke test: install the official Antigravity ACP server for this OS with the
// plugin's own installer (temporary directories) and check the ACP handshake.
// No Google sign-in is used or needed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectTarget, probeLocal, runInstall, verifyAcpHandshake } from "../install.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agy-smoke-"));
const installDir = path.join(root, "opt");
const binDir = path.join(root, "bin");
const target = detectTarget();
console.log(`target ${target.distKey} (${target.binaryName})`);
const result = await runInstall({ installDir, binDir, force: true, updatePath: false });
for (const note of result.notes) console.log(`  note: ${note}`);
if (!result.ok) throw new Error(`install failed: ${result.error}`);
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
const probe = await probeLocal();
console.log(`probe ${JSON.stringify(probe)}`);
if (!probe.ok || !probe.binaryPath) throw new Error("installed server not found on PATH");
const handshake = await verifyAcpHandshake(probe.binaryPath, result.args, 60_000);
console.log(`handshake ${JSON.stringify(handshake)}`);
if (!handshake.ok) throw new Error(`ACP handshake failed: ${handshake.error}`);

// The server must not leave helpers behind (Windows: localharness_external.exe).
function leftovers(): string[] {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" });
      return out.split(/\r?\n/).filter(line => /agy_acp_server|localharness/i.test(line));
    }
    return execFileSync("pgrep", ["-fl", root], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}
let left = leftovers();
for (let i = 0; i < 10 && left.length; i++) {
  await new Promise(resolve => setTimeout(resolve, 500));
  left = leftovers();
}
if (left.length) {
  console.error(`leftover processes:\n${left.join("\n")}`);
  process.exit(1);
}
console.log("no leftover processes");
console.log("OK");
process.exit(0);
