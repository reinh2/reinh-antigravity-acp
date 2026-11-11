import { spawn, type ChildProcess } from "node:child_process";

// agy_acp_server.exe starts localharness_external.exe. On Windows, kill() ends
// only the parent; the orphaned helper keeps the stdio pipes and the process
// alive. taskkill /T ends the whole tree. POSIX children exit with their parent.
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.once("error", () => { try { child.kill(); } catch { /* already gone */ } });
      killer.unref();
    } catch {
      try { child.kill(); } catch { /* already gone */ }
    }
    return;
  }
  try { child.kill(signal); } catch { /* already gone */ }
}
