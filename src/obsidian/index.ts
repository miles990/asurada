/**
 * Obsidian integration — transparent agent memory visualization.
 *
 * Users open Obsidian → see their agent's cognitive graph → browse, search, edit.
 * The agent's memory is not a black box — it's a navigable knowledge base.
 */

export { VaultSync } from './vault-sync.js';
export type { SyncResult } from './vault-sync.js';
export { initVault } from './vault-init.js';
export {
  parseFrontmatter,
  generateFrontmatter,
  setFrontmatter,
  mergeFrontmatter,
} from './frontmatter.js';
export type { Frontmatter, VaultSyncOptions, ObsidianConfig } from './types.js';
