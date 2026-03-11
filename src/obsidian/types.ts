/**
 * Obsidian integration types.
 */

/** YAML frontmatter for Obsidian-compatible markdown files. */
export interface Frontmatter {
  id?: string;
  type?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  status?: string;
  source?: string;
  related?: string[];   // [[wikilinks]]
  aliases?: string[];
  [key: string]: unknown;
}

/** Options for vault synchronization. */
export interface VaultSyncOptions {
  /** Root of the Obsidian vault (usually = memoryDir). */
  vaultDir: string;
  /** Path to the MemoryIndex JSONL file. */
  indexPath: string;
  /** Subdirectory for index entry pages (default: "index-pages"). */
  pagesSubdir?: string;
  /** Subdirectory for conversation summaries (default: "conversations"). */
  conversationsSubdir?: string;
  /** Whether to generate daily summaries from JSONL logs (default: true). */
  generateDailySummaries?: boolean;
}

/** Minimal .obsidian workspace config. */
export interface ObsidianConfig {
  /** Graph view filter to exclude noisy files. */
  graphFilter?: string;
  /** CSS snippets to include. */
  cssSnippets?: string[];
}
