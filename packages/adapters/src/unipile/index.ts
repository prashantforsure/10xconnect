// Internal barrel for the Unipile adapter. NOT re-exported from the package root
// (packages/adapters/src/index.ts) so Unipile wire types never leak out — only
// the factory constructs UnipileChannelAdapter.
export { UnipileChannelAdapter } from "./unipile-channel-adapter";
