// @10xconnect/engine — the DB-backed sequence + dispatch engine (CLAUDE.md §5
// "the brain"). Imported by apps/api (start/stop/enroll, inbound processing) and
// apps/worker (the dispatch loop). Provider-agnostic: it receives a ChannelAdapter
// interface — never a provider SDK.
export * from "./types";
export * from "./nodes";
export * from "./config";
export * from "./campaign-runner";
export * from "./dispatch";
export * from "./inbound";
export * from "./restrictions";
export * from "./suppression";
export { evaluateCondition } from "./conditions";
export { injectVariables, leadVariables } from "./variables";
export {
  createAiResolver,
  createCachedAiResolver,
  previewNode,
  profileFromLead,
  resolvePersonalizedMessage,
  type PreviewInput,
  type PreviewResult,
  type ResolveInput,
  type ResolveResult,
} from "./personalization";
export { loadGraph } from "./repository";
export * from "./templates";
export * from "./workflow-templates";
export * from "./campaign-duplicate";
export * from "./lead-import";
export * from "./account-health";
export * from "./unit-economics";
export * from "./brain";
