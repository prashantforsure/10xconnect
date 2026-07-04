// npm entrypoint (package.json "main"). n8n itself loads the nodes and
// credential via the "n8n" field in package.json — it never imports this file.
// This barrel exists so that `require("n8n-nodes-10xconnect")` and TypeScript
// consumers resolve to real exports instead of a missing module.

export { TenXConnectApi } from "./credentials/TenXConnectApi.credentials";
export { TenXConnect } from "./nodes/TenXConnect/TenXConnect.node";
export { TenXConnectTrigger } from "./nodes/TenXConnectTrigger/TenXConnectTrigger.node";
