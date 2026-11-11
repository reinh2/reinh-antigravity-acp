// Reproducible synthetic evidence, never a Google server capture or a bb screenshot.
import fs from "node:fs";
import { extractRawModels } from "../model-discovery.js";
import { parseRawModels, resolveModelSelection } from "../model-utils.js";
const fixture = {
  models: { currentModelId: "gemini-3.8-flash-medium", availableModels: ["gemini-4-argon", "gemini-3.8-flash"].flatMap((id, index) => ["low", "medium", "high"].map(level => ({ modelId: `${id}-${level}`, name: `${index ? "Gemini 3.8 Flash" : "Gemini 4 Argon"} (${level[0].toUpperCase() + level.slice(1)})` }))) },
  configOptions: [{ id: "model", type: "select", options: [{ value: "gemini-4-argon", name: "Gemini 4 Argon" }, { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }] }],
};
const before = fixture.configOptions[0].options.map(option => ({ model: option.value, supportedReasoningEfforts: [option.value.split("-").at(-1)], defaultReasoningEffort: option.value.split("-").at(-1) }));
const catalog = parseRawModels(extractRawModels(fixture));
const after = catalog.models;
const routes = ["low", "medium", "high"].map(level => ({ input: { model: "gemini-4-argon", reasoningLevel: level }, acpModelId: resolveModelSelection("gemini-4-argon", level, catalog).modelId }));
fs.mkdirSync("qa/before-after", { recursive: true });
for (const [name, value] of Object.entries({ fixture, before, after, routes })) fs.writeFileSync(`qa/before-after/${name}.json`, JSON.stringify({ evidence: "SYNTHETIC — NOT LIVE GOOGLE ACP", data: value }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ evidence: "SYNTHETIC", before, after, routes }, null, 2) + "\n");
