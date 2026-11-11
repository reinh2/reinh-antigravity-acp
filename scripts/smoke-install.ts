// CI smoke test: install the official Antigravity ACP server for this OS with the
// plugin's own installer (temporary directories) and check the ACP handshake.
// No Google sign-in is used or needed.
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
console.log("OK");
