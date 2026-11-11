// A static import: bb's builder bundles the locally corrected module itself.
import { experimental_acpProviderBridge, experimental_acpLaunchSpecSchema, reinhAcpRuntimePatch } from "./vendor/provider-bridge-acp.js";
import lock from "./patches/acp-runtime-lock.json";
if (reinhAcpRuntimePatch.sourceSha256 !== lock.sourceSha256 ||
    reinhAcpRuntimePatch.patchSha256 !== lock.patchSha256 ||
    reinhAcpRuntimePatch.revision !== lock.revision) {
  throw new Error("Local ACP runtime identity does not match the reviewed patch");
}
export { experimental_acpProviderBridge, experimental_acpLaunchSpecSchema, reinhAcpRuntimePatch };
