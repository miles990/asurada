/**
 * Memory System Types
 *
 * File-based memory with topic scoping and full-text search.
 * Core principle: File = Truth — files are the single source of truth.
 */

/** A single memory entry stored in a topic or general memory file */
export interface MemoryEntry {
  /** Source file (e.g. "design-philosophy.md", "MEMORY.md") */
  source: string;
  /** Date string in YYYY-MM-DD format, empty if undated */
  date: string;
  /** The memory content */
  content: string;
}

/** FTS5 search result with relevance ranking */
export interface SearchResult extends MemoryEntry {
  /** BM25 relevance score (lower = more relevant) */
  rank: number;
}

/** Configuration for the memory system */
export interface MemoryConfig {
  /** Root directory for memory files (e.g. "./memory") */
  memoryDir: string;
  /** Directory for topic files within memoryDir (default: "topics") */
  topicsSubdir?: string;
  /** Path for the FTS5 SQLite database */
  dbPath: string;
  /** Main memory file name (default: "MEMORY.md") */
  mainFile?: string;
}

/** Memory store interface — pluggable storage backend */
export interface MemoryStoreProvider {
  /** Read a memory entry or topic content */
  read(topic?: string): Promise<string | null>;
  /** Append content to main memory or a specific topic */
  append(content: string, topic?: string): Promise<void>;
  /** List available topic files */
  listTopics(): Promise<string[]>;
  /** Read topic content by name */
  readTopic(name: string): Promise<string | null>;
}
