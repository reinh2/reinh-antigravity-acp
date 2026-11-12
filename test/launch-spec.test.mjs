import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_DIST, localizeLaunchSpec } from "../install.ts";

const targets = {
  darwin: { platform: "darwin", arch: "aarch64", distKey: "darwin-aarch64", binaryName: "agy_acp_server.par", isWindows: false },
  linux: { platform: "linux", arch: "x86_64", distKey: "linux-x86_64", binaryName: "agy_acp_server.par", isWindows: false },
  win: { platform: "win32", arch: "x86_64", distKey: "windows-x86_64", binaryName: "agy_acp_server.exe", isWindows: true },
};

test("localizeLaunchSpec — rewrites command/args per host platform, keeps env", () => {
  // linux spec arriving on a darwin host loses --uid=
  const linuxSpec = { command: "agy_acp_server.par", args: ["--uid="], env: { BB_ANTIGRAVITY_DEFAULT_MODEL: "gemini-3.8-flash" } };
  localizeLaunchSpec(linuxSpec, targets.darwin);
  assert.deepEqual(linuxSpec.args, []);
  assert.equal(linuxSpec.command, "agy_acp_server.par");
  assert.equal(linuxSpec.env.BB_ANTIGRAVITY_DEFAULT_MODEL, "gemini-3.8-flash");

  // spec arriving on a linux host gains --uid= and the linux command
  const macSpec = { command: "agy_acp_server.par", args: [], env: {} };
  localizeLaunchSpec(macSpec, targets.linux);
  assert.deepEqual(macSpec.args, FALLBACK_DIST["linux-x86_64"].args);
  assert.equal(macSpec.command, "agy_acp_server.par");

  // windows host gets the .exe command
  const winSpec = { command: "agy_acp_server.par", args: [] };
  localizeLaunchSpec(winSpec, targets.win);
  assert.equal(winSpec.command, "agy_acp_server.exe");
});

test("localizeLaunchSpec — missing spec is a no-op", () => {
  assert.doesNotThrow(() => localizeLaunchSpec(undefined, targets.darwin));
});

test("detectTarget — every supported host maps to a registry distribution key", async () => {
  const { detectTarget } = await import("../install.ts");
  const real = { platform: process.platform, arch: process.arch };
  const cases = [["darwin", "arm64", "darwin-aarch64"], ["darwin", "x64", "darwin-x86_64"], ["linux", "x64", "linux-x86_64"], ["linux", "arm64", "linux-aarch64"], ["win32", "x64", "windows-x86_64"], ["win32", "arm64", "windows-aarch64"]];
  try {
    for (const [platform, arch, key] of cases) {
      Object.defineProperty(process, "platform", { value: platform });
      Object.defineProperty(process, "arch", { value: arch });
      const target = detectTarget();
      assert.equal(target.distKey, key);
      assert.ok(FALLBACK_DIST[target.distKey], `${key} must exist in FALLBACK_DIST`);
      assert.equal(target.binaryName, platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par");
    }
  } finally {
    Object.defineProperty(process, "platform", { value: real.platform });
    Object.defineProperty(process, "arch", { value: real.arch });
  }
});

test("psQuote — Windows paths with apostrophes stay one PowerShell literal", async () => {
  const { psQuote } = await import("../install.ts");
  assert.equal(psQuote("C:\\Users\\O'Brien\\x.zip"), "'C:\\Users\\O''Brien\\x.zip'");
});

test("FALLBACK_DIST pins agy-acp-server 1.4.5 with a SHA-256 for every platform", () => {
  for (const [key, entry] of Object.entries(FALLBACK_DIST)) {
    assert.match(entry.archive, /agy-acp-server-1\.4\.5-/, key);
    assert.match(entry.sha256 ?? "", /^[0-9a-f]{64}$/, key);
  }
});

test("sha256File hashes an archive", async () => {
  const { sha256File } = await import("../install.ts");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const file = join(mkdtempSync(join(tmpdir(), "sha-")), "a.zip");
  writeFileSync(file, "abc");
  assert.equal(await sha256File(file), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
