// Subscription quota for bb's provider/usage, read from Antigravity's own `/usage`
// slash command. The ACP server answers it locally (no LLM turn, no token cost)
// with a Markdown report; Argon and the Flash/Pro group are separate buckets.
import fs from "node:fs";
import type { ProviderUsageResult, ProviderUsageWindow } from "@get-bb/plugin-sdk/provider-bridge";
import { AcpDiscoveryAuthError, extractRawModels, withAcpConnection, type LaunchSpec } from "./model-discovery.js";
import { parseRawModels } from "./model-utils.js";

export interface QuotaWindow { group: string; members: string[]; window: string; remainingPercent: number; resetsAt: string | null }
export interface UsageReport { windows: QuotaWindow[]; notApplicable: boolean }

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "Nov 14, 2026, 06:44 UTC" → ISO. Anything else is reported as unknown.
export function parseResetTime(text: string): string | null {
  const match = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*UTC$/.exec(text.trim());
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  const ms = Date.UTC(Number(match[3]), month, Number(match[2]), Number(match[4]), Number(match[5]));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function windowName(label: string): string {
  if (/five[\s-]*hour|5[\s-]*hour/i.test(label)) return "5h";
  if (/week/i.test(label)) return "weekly";
  if (/dai?ly|day/i.test(label)) return "daily";
  if (/month/i.test(label)) return "monthly";
  return label.replace(/\s*(limit|remaining)\s*/gi, " ").trim() || label;
}

export function parseUsageReport(text: string): UsageReport {
  const windows: QuotaWindow[] = [];
  let inQuota = false;
  let group: { name: string; members: string[] } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { inQuota = /quota|limit/i.test(heading[1]); group = undefined; continue; }
    if (!inQuota) continue;
    // Top-level bullet: "- **Gemini 4 Argon**"
    const groupMatch = /^[-*]\s+\*\*(.+?)\*\*\s*$/.exec(line);
    if (groupMatch) { group = { name: groupMatch[1].trim(), members: [] }; continue; }
    const members = /Models within this group:\s*([^)]*)\)/i.exec(line);
    if (members && group) { group.members = members[1].split(",").map(m => m.trim().replace(/[*_]/g, "")).filter(Boolean); continue; }
    // Nested bullet: "  - **Weekly Limit Remaining:** 97% remaining (resets Nov 14, 2026, 06:48 UTC)"
    const entry = /^\s+[-*]\s+\*\*(.+?):?\*\*:?\s*(\d{1,3}(?:\.\d+)?)%\s*remaining(?:\s*\(resets\s+([^)]*)\))?/i.exec(line);
    if (entry && group) {
      const remaining = Math.max(0, Math.min(100, Number(entry[2])));
      windows.push({ group: group.name, members: group.members, window: windowName(entry[1]), remainingPercent: remaining, resetsAt: entry[3] ? parseResetTime(entry[3]) : null });
    }
  }
  return { windows, notApplicable: windows.length === 0 && /not applicable/i.test(text) };
}

export interface FamilyRef { id: string; displayName: string }
const distinctive = (name: string) => name.toLowerCase().split(/[^a-z0-9.]+/).filter(t => t && t !== "gemini" && !/^[\d.]+$/.test(t));
// "Gemini Flash" covers "Gemini 3.8 Flash"; "Gemini 4 Argon" covers "Gemini 4 Argon".
function coveredFamilies(subjects: string[], families: FamilyRef[]): FamilyRef[] {
  return families.filter(family => {
    const tokens = new Set(distinctive(family.displayName));
    return subjects.some(subject => {
      const wanted = distinctive(subject);
      return wanted.length > 0 && wanted.every(t => tokens.has(t));
    });
  });
}
// The panel is narrow, and bb rewrites the label of any non-"custom" window from
// kind + model ("Weekly · Gemini-3.8-flash"). Short labels are sent as "custom".
const PERIOD: Record<string, string> = { "5h": "5h", daily: "1d", weekly: "7d", monthly: "30d" };
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
// "Gemini Flash, Gemini Pro" → "Flash/Pro"; "Gemini 4 Argon" → "Argon";
// a wide group such as "Claude and GPT models" keeps its own short name.
const shortSubject = (group: string, members: string[]) => {
  if (members.length > 2) return group.replace(/\s+models?$/i, "").trim() || group;
  const subjects = members.length ? members : [group];
  const words = subjects.map(subject => distinctive(subject).map(capitalize).join(" ")).filter(Boolean);
  return words.length ? words.join("/") : subjects.join("/");
};
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");

// Buckets for Gemini models, plus any bucket covering a model in this account's
// catalog (higher plans can expose Claude/GPT or new Gemini families). Each
// bucket keeps its own window, so Argon and Flash/Pro are reported separately;
// a bucket that covers exactly one catalog family is tied to it through `model`.
export function toProviderWindows(report: UsageReport, families: FamilyRef[] = []): ProviderUsageWindow[] {
  return report.windows
    .map(w => ({ w, subjects: w.members.length ? w.members : [w.group] }))
    .map(({ w, subjects }) => ({ w, covered: coveredFamilies(subjects, families) }))
    .filter(({ w, covered }) => covered.length > 0 || /gemini/i.test(w.group) || w.members.some(m => /gemini/i.test(m)))
    .map(({ w, covered }) => {
      return {
        id: slug(`${w.group}-${w.window}`),
        label: `${PERIOD[w.window] ?? w.window} · ${shortSubject(w.group, w.members)}`,
        kind: "custom" as const,
        model: covered.length === 1 ? covered[0].id : null,
        usedPercent: Math.round((100 - w.remainingPercent) * 10) / 10,
        resetsAt: w.resetsAt,
      };
    });
}

export async function readAntigravityUsage(spec: LaunchSpec, timeoutMs = 20_000): Promise<ProviderUsageResult> {
  let text = "";
  try {
    let planLabel: string | null = null;
    let families: FamilyRef[] = [];
    await withAcpConnection(spec, timeoutMs, async ({ send }) => {
      const session = await send("session/new", { cwd: spec.cwd ?? process.cwd(), mcpServers: [] }) as any;
      const tier = session?._meta?.antigravity?.tier?.name;
      if (typeof tier === "string" && tier.trim()) planLabel = tier.trim();
      families = [...parseRawModels(extractRawModels(session)).families.values()].map(f => ({ id: f.id, displayName: f.displayName }));
      if (typeof session?.sessionId !== "string") throw new Error("ACP server returned no session.");
      await send("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: "/usage" }] });
    }, (method, params) => {
      const update = params.update;
      if (method === "session/update" && update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text" && typeof update.content.text === "string") {
        if (text.length < 64 * 1024) text += update.content.text;
      }
    });
    const report = parseUsageReport(text);
    if (!report.windows.length && !report.notApplicable) {
      return { supported: true, usage: { status: "error", message: "Antigravity /usage returned no quota data.", accountEmail: null, planLabel } };
    }
    return { supported: true, usage: { status: "ok", accountEmail: null, planLabel, windows: toProviderWindows(report, families) } };
  } catch (error) {
    if (error instanceof AcpDiscoveryAuthError) return { supported: true, usage: { status: "unauthenticated" } };
    return { supported: true, usage: { status: "error", message: error instanceof Error ? error.message : "Antigravity usage query failed.", accountEmail: null, planLabel: null } };
  }
}

// bb polls usage; reuse a recent answer and share one in-flight query.
export class UsageCache {
  private value?: { at: number; key: string; result: ProviderUsageResult };
  private inflight = new Map<string, Promise<ProviderUsageResult>>();
  constructor(private read: (spec: LaunchSpec) => Promise<ProviderUsageResult>, private ttlMs = 60_000, private now = () => Date.now()) {}
  async get(spec: LaunchSpec): Promise<ProviderUsageResult> {
    const key = JSON.stringify([spec.command, spec.args, spec.env]);
    if (this.value && this.value.key === key && this.now() - this.value.at < this.ttlMs) return this.value.result;
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = this.read(spec).then(result => {
      // Errors are not cached, so the next poll retries.
      if (result.supported && result.usage.status === "ok") this.value = { at: this.now(), key, result };
      return result;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}

export function ensureProbeDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
