// Deterministic build-time patching of a pinned SDK into our own static module.
// Never writes node_modules, the global SDK, or bb. No runtime source transforms.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export function applyStrictPatch(source, patch) {
  const input = source.split("\n");
  const lines = patch.split("\n");
  if (lines[0] !== "--- a/provider-bridge-acp.js" || lines[1] !== "+++ b/provider-bridge-acp.js") throw new Error("Unexpected patch target");
  const output = [];
  let cursor = 0, index = 2, hunks = 0;
  while (index < lines.length && lines[index] !== "") {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index++]);
    if (!header) throw new Error("Invalid patch hunk");
    const position = Number(header[1]) - 1;
    if (position < cursor) throw new Error("Overlapping patch hunks");
    output.push(...input.slice(cursor, position)); cursor = position;
    let removed = 0, added = 0;
    while (index < lines.length && !lines[index].startsWith("@@ ") && lines[index] !== "") {
      const line = lines[index++]; const prefix = line[0]; const value = line.slice(1);
      if (prefix === " " || prefix === "-") {
        if (input[cursor] !== value) throw new Error("Patch context differs at source line " + (cursor + 1));
        cursor++; removed++;
      }
      if (prefix === " " || prefix === "+") { output.push(value); added++; }
      else if (prefix !== "-") throw new Error("Unexpected patch content");
    }
    if (removed !== Number(header[2] ?? 1) || added !== Number(header[4] ?? 1)) throw new Error("Patch hunk length differs");
    hunks++;
  }
  if (!hunks || lines.slice(index).some(line => line !== "")) throw new Error("Patch is empty or has trailing content");
  output.push(...input.slice(cursor));
  return output.join("\n");
}
export function expectedRuntime() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "patches/acp-runtime-lock.json"), "utf8"));
  const sdk = path.join(root, "node_modules/@get-bb/plugin-sdk");
  const installed = JSON.parse(fs.readFileSync(path.join(sdk, "package.json"), "utf8"));
  const source = fs.readFileSync(path.join(sdk, "dist/provider-bridge-acp.js"), "utf8");
  const patch = fs.readFileSync(path.join(root, "patches/provider-bridge-acp-0.6.132.patch"), "utf8");
  if (installed.version !== lock.sdkVersion || sha256(source) !== lock.sourceSha256 || sha256(patch) !== lock.patchSha256) {
    throw new Error("Pinned ACP SDK or patch checksum differs; explicit rebase and regression review required");
  }
  const patched = applyStrictPatch(source, patch);
  const identity = { sdkVersion: lock.sdkVersion, sourceSha256: lock.sourceSha256, patchSha256: lock.patchSha256, revision: lock.revision };
  const banner = "/*! Reinh local ACP runtime: derived from @get-bb/plugin-sdk " + lock.sdkVersion + ".\n * Copyright (c) 2026 Michael Yong, MIT. See vendor/BB-SDK-LICENSE and THIRD_PARTY_NOTICES.md.\n * Local modifications: strict model/reasoning selection and lifecycle admission.\n */\n";
  const code = banner + patched + "\nexport const reinhAcpRuntimePatch = Object.freeze(" + JSON.stringify(identity) + ");\n";
  return { code, identity, manifest: { ...identity, generatedSha256: sha256(code), upstreamUnmodified: true } };
}
export function verifyOrWrite(write = false) {
  const expected = expectedRuntime();
  const outputs = new Map([
    ["vendor/provider-bridge-acp.js", expected.code],
    ["vendor/manifest.json", JSON.stringify(expected.manifest, null, 2) + "\n"],
  ]);
  for (const [name, content] of outputs) {
    const filename = path.join(root, name);
    if (write) fs.writeFileSync(filename, content);
    else if (!fs.existsSync(filename) || fs.readFileSync(filename, "utf8") !== content) throw new Error(name + " is stale; run npm run prepare:runtime");
  }
  return expected;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyOrWrite(process.argv.includes("--write"));
  process.stdout.write("ACP runtime " + result.identity.revision + " " + result.manifest.generatedSha256 + " verified\n");
}
