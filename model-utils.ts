// Pure catalog parsing. ACP ids are opaque: never invent executable model ids.
export const REASONING_LEVELS = ["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"] as const;
export type ReasoningLevel = typeof REASONING_LEVELS[number];
export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}
export interface NativeReasoning {
  configId: string;
  levelValues: Partial<Record<ReasoningLevel, string>>;
}
export interface RawModel {
  id: string;
  name: string;
  isDefault?: boolean;
  defaultReasoningEffort?: ReasoningLevel;
  nativeReasoning?: NativeReasoning;
  selectionConfigIds?: string[];
}
export interface ModelFamily {
  id: string;
  displayName: string;
  variants: Map<string, string>;
  defaultEffort: string;
  nativeReasoning?: NativeReasoning;
}
export interface AvailableModelReasoningEffort {
  reasoningEffort: ReasoningLevel;
  description: string;
}
export interface AvailableModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: AvailableModelReasoningEffort[];
  defaultReasoningEffort: ReasoningLevel;
  isDefault: boolean;
}
export interface ModelCatalog {
  families: Map<string, ModelFamily>;
  models: AvailableModel[];
  defaultFamilyId: string;
  rawModels: RawModel[];
}
// Kept as exported legacy constants; execution never uses a hardcoded fallback.
export const FALLBACK_DEFAULT_MODEL_ID = "gemini-3.8-flash";
export const FALLBACK_DEFAULT_VARIANT_ID = "gemini-3.8-flash-medium";
export function normalizeModelId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}
export function normalizeEffort(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-") || "medium";
}
export function prettyEffort(effort: string): string {
  return effort.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
}
export function extractVersion(id: string): number[] {
  return id.match(/(\d+(?:\.\d+)*)/)?.[1].split(".").map(Number) ?? [0];
}
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

export function parseRawModels(
  rawList: RawModel[], preferredDefaultId?: string,
  preferredFromSettings?: { model: string; effort: string } | null,
): ModelCatalog {
  const families = new Map<string, ModelFamily>();
  let acpDefaultFamily = "";
  for (const raw of rawList) {
    const rawName = raw.name || raw.id;
    const paren = rawName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const namedEffort = paren ? normalizeEffort(paren[2]) : "";
    const suffix = paren && !isReasoningLevel(namedEffort) ? null : raw.id.match(/^(.*)-(none|low|medium|high|xhigh|ultracode|max|ultra)$/i);
    // Parenthetical metadata such as (Preview) is not a reasoning level.
    const conflictingMetadata = suffix && isReasoningLevel(namedEffort) && namedEffort !== suffix[2].toLowerCase();
    const effort = conflictingMetadata ? "" : isReasoningLevel(namedEffort) ? namedEffort : suffix?.[2].toLowerCase() ?? "";
    let displayName = rawName;
    if (!conflictingMetadata && paren && isReasoningLevel(namedEffort)) displayName = paren[1].trim();
    else if (!conflictingMetadata && suffix) displayName = rawName.replace(new RegExp(`(?:[ -]+|\\s*\\()${effort}\\)?$`, "i"), "").trim();
    const familyId = conflictingMetadata ? raw.id : suffix ? suffix[1] : effort ? normalizeModelId(displayName) : raw.id;
    let fam = families.get(familyId);
    if (!fam) {
      fam = { id: familyId, displayName, variants: new Map(), defaultEffort: effort };
      families.set(familyId, fam);
    }
    // Do not overwrite ambiguous variants: the first advertised executable id wins.
    if (!fam.variants.has(effort)) fam.variants.set(effort, raw.id);
    if (raw.nativeReasoning && !effort) {
      fam.nativeReasoning = raw.nativeReasoning;
      for (const level of REASONING_LEVELS) {
        if (raw.nativeReasoning.levelValues[level]) fam.variants.set(level, raw.id);
      }
    }
    if (raw.isDefault) acpDefaultFamily = familyId;
    if (raw.defaultReasoningEffort && fam.variants.has(raw.defaultReasoningEffort)) {
      fam.defaultEffort = raw.defaultReasoningEffort;
    }
  }
  for (const fam of families.values()) {
    const explicit = rawList.find(raw => raw.defaultReasoningEffort && [...fam.variants.values()].includes(raw.id));
    const current = rawList.find(raw => raw.isDefault && [...fam.variants.values()].includes(raw.id));
    const currentEffort = current ? [...fam.variants].find(([level, id]) => id === current.id && isReasoningLevel(level))?.[0] : undefined;
    fam.defaultEffort = explicit?.defaultReasoningEffort ?? currentEffort ?? (fam.variants.has("medium") ? "medium" : [...fam.variants.keys()].find(isReasoningLevel) ?? "");
    if (preferredFromSettings && (preferredFromSettings.model === fam.id || normalizeModelId(preferredFromSettings.model) === fam.id) && fam.variants.has(preferredFromSettings.effort)) {
      fam.defaultEffort = preferredFromSettings.effort;
    }
  }
  const sorted = [...families.keys()].sort((a, b) => compareVersions(extractVersion(b), extractVersion(a)));
  const preferredSettingModel = preferredFromSettings?.model && (families.has(preferredFromSettings.model) ? preferredFromSettings.model : normalizeModelId(preferredFromSettings.model));
  const defaultFamilyId = [preferredDefaultId, preferredSettingModel, acpDefaultFamily, sorted.find(id => id.includes("flash")), sorted[0]]
    .find(id => id && families.has(id)) ?? "";
  const models = [...families.values()].map(fam => ({
    id: fam.id, model: fam.id, displayName: fam.displayName, description: "",
    supportedReasoningEfforts: REASONING_LEVELS.filter(eff => fam.variants.has(eff)).map(reasoningEffort => ({
      reasoningEffort, description: `${prettyEffort(reasoningEffort)} reasoning effort`,
    })),
    // bb requires an enum even when there is no reasoning selector. It is not sent to ACP.
    defaultReasoningEffort: isReasoningLevel(fam.defaultEffort) ? fam.defaultEffort : "medium" as const,
    isDefault: fam.id === defaultFamilyId,
  }));
  return { families, models, defaultFamilyId, rawModels: rawList };
}

export function resolveModelSelection(model: string | undefined, reasoningLevel: string | undefined, catalog: ModelCatalog) {
  const target = model?.trim() || catalog.defaultFamilyId;
  const raw = catalog.rawModels.find(r => r.id === target);
  const fam = catalog.families.get(target) ?? [...catalog.families.values()].find(f => [...f.variants.values()].includes(target));
  if (!fam) throw new Error(`Model "${target || "(default)"}" is unavailable. Refresh the model catalog.`);
  if (reasoningLevel !== undefined && !isReasoningLevel(reasoningLevel)) {
    throw new Error(`Unsupported reasoning level "${reasoningLevel}". Refresh the model catalog.`);
  }
  const hasReasoning = [...fam.variants.keys()].some(isReasoningLevel);
  if (!hasReasoning) {
    // The UI may supply bb's mandatory placeholder default for a model without a selector.
    if (reasoningLevel !== undefined && reasoningLevel !== "medium") throw new Error(`Model "${target}" does not advertise reasoning levels.`);
    return { modelId: raw?.id ?? fam.variants.get("")!, family: fam };
  }
  // Preserve legacy raw ids when no new effort was requested.
  if (raw && raw.id !== fam.id && !fam.nativeReasoning && reasoningLevel === undefined) return { modelId: raw.id, family: fam };
  const level = reasoningLevel ?? fam.defaultEffort;
  const modelId = fam.variants.get(level);
  if (!modelId) throw new Error(`Model "${target}" does not advertise reasoning level "${level}".`);
  return { modelId, family: fam, reasoningLevel: isReasoningLevel(level) ? level : undefined };
}
export function resolveRawModelId(model: string | undefined, reasoningLevel: string | undefined, catalog: ModelCatalog): string {
  return resolveModelSelection(model, reasoningLevel, catalog).modelId;
}
export function rawListsEqual(a: RawModel[], b: RawModel[]): boolean {
  const canonical = (list: RawModel[]) => JSON.stringify([...list].sort((x, y) => x.id.localeCompare(y.id)).map(raw => ({
    id: raw.id, name: raw.name, isDefault: raw.isDefault, defaultReasoningEffort: raw.defaultReasoningEffort,
    selectionConfigIds: raw.selectionConfigIds,
    nativeReasoning: raw.nativeReasoning ? { configId: raw.nativeReasoning.configId, levelValues: REASONING_LEVELS.map(level => raw.nativeReasoning?.levelValues[level]) } : undefined,
  })));
  return canonical(a) === canonical(b);
}
