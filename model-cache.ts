import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { queryAcpServer, type LaunchSpec } from "./model-discovery.js";
import { isReasoningLevel, parseRawModels, type RawModel, type ModelCatalog } from "./model-utils.js";

const CACHE_VERSION = 2;
export const CACHE_TTL_MS = 60_000;
export function launchKey(spec: LaunchSpec): string {
  const env = { ...process.env, ...spec.env };
  delete env.BB_ANTIGRAVITY_DEFAULT_MODEL;
  delete env.BB_ANTIGRAVITY_DEFAULT_REASONING;
  return createHash("sha256").update(JSON.stringify([spec.command, spec.args, spec.cwd, Object.entries(env).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
}
function validModels(value: unknown): value is RawModel[] {
  return Array.isArray(value) && value.length > 0 && value.every(raw => {
    if (!raw || typeof raw.id !== "string" || !raw.id.trim() || typeof raw.name !== "string") return false;
    if (raw.selectionConfigIds !== undefined && (!Array.isArray(raw.selectionConfigIds) || !raw.selectionConfigIds.every((id: unknown) => typeof id === "string" && id.length > 0))) return false;
    if (raw.isDefault !== undefined && typeof raw.isDefault !== "boolean") return false;
    if (raw.defaultReasoningEffort !== undefined && !isReasoningLevel(raw.defaultReasoningEffort)) return false;
    if (raw.nativeReasoning !== undefined) {
      const native = raw.nativeReasoning;
      if (!native || typeof native.configId !== "string" || !native.configId || !native.levelValues || typeof native.levelValues !== "object") return false;
      if (!Object.entries(native.levelValues).every(([level, value]) => isReasoningLevel(level) && typeof value === "string" && value.length > 0)) return false;
    }
    return true;
  });
}

export class ModelCatalogCache {
  private entries = new Map<string, { timestamp: number; rawModels: RawModel[] }>();
  private failedKeys = new Set<string>();
  private pending = new Map<string, Promise<RawModel[]>>();
  constructor(private directory: string, private query = queryAcpServer, private now = Date.now) {}

  async get(spec: LaunchSpec, force = false): Promise<ModelCatalog> {
    const key = launchKey(spec);
    let entry = this.entries.get(key);
    const file = path.join(this.directory, `${key}.json`);
    if (!entry && !this.failedKeys.has(key)) {
      try {
        const disk = JSON.parse(fs.readFileSync(file, "utf8"));
        if (disk.version === CACHE_VERSION && disk.key === key && Number.isFinite(disk.timestamp) && validModels(disk.rawModels)) {
          entry = { timestamp: disk.timestamp, rawModels: disk.rawModels };
          this.entries.set(key, entry);
        }
      } catch { /* Missing, corrupt, or legacy caches require fresh discovery. */ }
    }
    if (force || !entry || entry.timestamp > this.now() || this.now() - entry.timestamp >= CACHE_TTL_MS) {
      let pending = this.pending.get(key);
      if (!pending) {
        pending = this.query(spec).then(rawModels => {
          if (!validModels(rawModels)) throw new Error("ACP model discovery returned an empty or invalid catalog.");
          const next = { timestamp: this.now(), rawModels };
          this.entries.set(key, next);
          this.failedKeys.delete(key);
          // Cache IO cannot turn a successful discovery into a failed model request.
          const temporary = `${file}.${randomUUID()}.tmp`;
          try {
            fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
            fs.writeFileSync(temporary, JSON.stringify({ version: CACHE_VERSION, key, ...next }), { mode: 0o600 });
            fs.renameSync(temporary, file);
          } catch {
            try { fs.unlinkSync(temporary); } catch { /* best effort */ }
          }
          return rawModels;
        }).catch(error => {
          this.entries.delete(key);
          this.failedKeys.add(key);
          throw error;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, pending);
      }
      // Capture this request's result, never read a catalog written by another key.
      entry = { timestamp: this.now(), rawModels: await pending };
    }
    const envModel = spec.env.BB_ANTIGRAVITY_DEFAULT_MODEL ?? process.env.BB_ANTIGRAVITY_DEFAULT_MODEL;
    const effort = spec.env.BB_ANTIGRAVITY_DEFAULT_REASONING ?? process.env.BB_ANTIGRAVITY_DEFAULT_REASONING ?? "";
    return parseRawModels(entry.rawModels, undefined, envModel ? { model: envModel.trim(), effort: effort.trim().toLowerCase() } : null);
  }
}
