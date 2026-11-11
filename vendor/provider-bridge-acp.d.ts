// The local patch changes internal behavior, not the SDK's exported contract.
export {
  experimental_acpProviderBridge,
  experimental_acpLaunchSpecSchema,
} from "@get-bb/plugin-sdk/provider-bridge/acp";
export declare const reinhAcpRuntimePatch: Readonly<{
  sdkVersion: string;
  sourceSha256: string;
  patchSha256: string;
  revision: string;
}>;
