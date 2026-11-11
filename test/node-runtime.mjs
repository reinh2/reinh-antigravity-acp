// Verify the public SDK module can load in plain Node ESM before source tests.
// SDK 0.6.132 no longer needs the global require shim used during the 0.4.50 audit.
await import("@get-bb/plugin-sdk/provider-bridge");
