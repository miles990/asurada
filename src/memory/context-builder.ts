/**
 * ContextBuilder — Memory-aware context assembly for OODA cycles.
 *
 * Combines MemoryStore (topic files) + MemoryIndex (cognitive graph) + MemorySearch (FTS5)
 * to build rich, relevant context for each cycle prompt.
 *
 * Key innovation (Phase 6):
 * - Keyword-based topic loading (preserved from mini-agent)
 * - Memory-index boosting: surfaces additional relevant topics via semantic matching
 * - Direction-change injection: strategy audit trails appear alongside related topics
 * - Budget-aware: respects character limits to keep context focused
 *
 * Usage:
 *   const builder = new ContextBuilder(store, index, search);
 *   const ctx = await builder.build('mushi routing architecture');
 *   // ctx.sections → [{ name: 'agent-architecture', content: '...' }, ...]
 *   // ctx.directionChanges → [{ entry, formatted: '之前認為 X → ...' }]
 *   // ctx.manifest → '<memory-index>...'
 */

import type { MemoryStore } from './store.js';
import type { MemoryIndex } from './memory-index.js';
import type { MemorySearch } from './search.js';
import type { IndexEntry } from './index-types.js';

/** A loaded topic section */
export interface ContextSection {
  /** Topic name (file name without .md) */
  name: string;
  /** Full topic content */
  content: string;
  /** How this topic was selected */
  source: 'keyword' | 'index-boost';
}

/** A formatted direction-change entry */
export interface DirectionChangeContext {
  entry: IndexEntry;
  /** Pre-formatted display string */
  formatted: string;
}

/** Result of context building */
export interface MemoryContextResult {
  /** Loaded topic sections */
  sections: ContextSection[];
  /** Direction-change entries related to loaded topics */
  directionChanges: DirectionChangeContext[];
  /** Memory-index manifest (recent entries summary) */
  manifest: string;
  /** Main memory content (if requested) */
  mainMemory: string | null;
  /** Debug: which topics were considered but not loaded */
  skipped: string[];
}

/** A conversation message for keyword extraction */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Options for context building */
export interface ContextBuildOptions {
  /** Maximum number of topics to load (default: 5) */
  maxTopics?: number;
  /** Maximum number of index-boosted topics beyond keyword matches (default: 2) */
  maxBoostTopics?: number;
  /** Maximum characters per topic section (default: 4000) */
  maxTopicChars?: number;
  /** Maximum direction-change entries to include (default: 5) */
  maxDirectionChanges?: number;
  /** Include main memory content (default: false) */
  includeMainMemory?: boolean;
  /** Maximum entries in memory-index manifest (default: 20) */
  maxManifestEntries?: number;
  /**
   * Recent conversation history for keyword extraction.
   * Only non-assistant messages are used as keyword sources — this prevents
   * the agent's own verbose responses from polluting topic matching.
   */
  conversationHistory?: ConversationMessage[];
}

export class ContextBuilder {
  constructor(
    private readonly store: MemoryStore,
    private readonly index: MemoryIndex,
    private readonly search: MemorySearch,
  ) {}

  /**
   * Build memory context for a cycle prompt.
   *
   * @param query - The query/trigger text to find relevant context for
   * @param options - Budget and limit controls
   */
  async build(query: string, options?: ContextBuildOptions): Promise<MemoryContextResult> {
    const maxTopics = options?.maxTopics ?? 5;
    const maxBoostTopics = options?.maxBoostTopics ?? 2;
    const maxTopicChars = options?.maxTopicChars ?? 4000;
    const maxDirectionChanges = options?.maxDirectionChanges ?? 5;
    const maxManifestEntries = options?.maxManifestEntries ?? 20;

    // 1. Get available topics
    const allTopics = await this.store.listTopics();

    // 2. Keyword-based topic selection (preserved from mini-agent pattern)
    //    Enrich the query with conversation history keywords, but only from
    //    non-assistant messages — the agent's own responses are excluded to
    //    prevent its verbose output from dominating topic matching.
    const enrichedQuery = this.enrichQueryFromHistory(query, options?.conversationHistory);
    const keywordTopics = this.matchTopicsByKeyword(enrichedQuery, allTopics);

    // 3. Memory-index boosted topics (Phase 6 addition)
    const indexTopics = await this.index.getRelevantTopics(query, maxBoostTopics + keywordTopics.length);
    const boostTopics = indexTopics
      .filter(t => !keywordTopics.includes(t) && allTopics.includes(t))
      .slice(0, maxBoostTopics);

    // 4. Merge and limit
    const selectedTopics = [...keywordTopics, ...boostTopics].slice(0, maxTopics);
    const skipped = indexTopics.filter(t => !selectedTopics.includes(t));

    // 5. Load topic content
    const sections: ContextSection[] = [];
    for (const topic of selectedTopics) {
      const content = await this.store.readTopic(topic);
      if (content) {
        const truncated = content.length > maxTopicChars
          ? content.slice(0, maxTopicChars) + '\n...(truncated)'
          : content;
        sections.push({
          name: topic,
          content: truncated,
          source: keywordTopics.includes(topic) ? 'keyword' : 'index-boost',
        });
      }
    }

    // 6. Direction-change injection (Phase 6 core feature)
    const topicNames = sections.map(s => s.name);
    const dcEntries = await this.index.getDirectionChanges(topicNames, maxDirectionChanges);
    const directionChanges: DirectionChangeContext[] = dcEntries.map(entry => ({
      entry,
      formatted: `[${entry.createdAt.slice(0, 10)}] ${entry.content}`,
    }));

    // 7. Build memory-index manifest
    const manifest = await this.buildManifest(maxManifestEntries);

    // 8. Main memory (optional)
    let mainMemory: string | null = null;
    if (options?.includeMainMemory) {
      mainMemory = await this.store.read();
    }

    return { sections, directionChanges, manifest, mainMemory, skipped };
  }

  /**
   * Format context result as prompt sections (ready for LLM consumption).
   */
  formatForPrompt(result: MemoryContextResult): string {
    const parts: string[] = [];

    // Topic sections
    for (const section of result.sections) {
      const badge = section.source === 'index-boost' ? ' (index-boosted)' : '';
      parts.push(`<topic-memory name="${section.name}"${badge}>`);
      parts.push(section.content);
      parts.push(`</topic-memory>`);
      parts.push('');
    }

    // Direction-change audit trail
    if (result.directionChanges.length > 0) {
      parts.push('<direction-changes>');
      for (const dc of result.directionChanges) {
        parts.push(`- ${dc.formatted}`);
      }
      parts.push('</direction-changes>');
      parts.push('');
    }

    // Memory-index manifest
    if (result.manifest) {
      parts.push('<memory-index>');
      parts.push(result.manifest);
      parts.push('</memory-index>');
      parts.push('');
    }

    // Main memory
    if (result.mainMemory) {
      parts.push('<memory>');
      parts.push(result.mainMemory);
      parts.push('</memory>');
      parts.push('');
    }

    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Enrich the query with keywords from recent conversation history.
   * Only non-assistant messages are used — this prevents the agent's own
   * verbose responses from polluting topic matching (repeated-response fix).
   */
  private enrichQueryFromHistory(query: string, history?: ConversationMessage[]): string {
    if (!history || history.length === 0) return query;

    const userMessages = history
      .filter(c => c.role !== 'assistant')
      .slice(-3)
      .map(c => c.content.toLowerCase());

    if (userMessages.length === 0) return query;

    return [query, ...userMessages].join(' ');
  }

  /**
   * Simple keyword matching: check if query tokens appear in topic names.
   * Preserves the mini-agent pattern of keyword-based topic loading.
   */
  private matchTopicsByKeyword(query: string, topics: string[]): string[] {
    const tokens = query
      .toLowerCase()
      .split(/[\s,;:./\-_]+/)
      .filter(t => t.length > 2);

    if (tokens.length === 0) return [];

    return topics.filter(topic => {
      const topicLower = topic.toLowerCase();
      return tokens.some(token => topicLower.includes(token));
    });
  }

  /**
   * Build a compact manifest of recent memory-index entries.
   */
  private async buildManifest(limit: number): Promise<string> {
    const entries = await this.index.query({ limit });
    if (entries.length === 0) return '';

    return entries
      .map(e => {
        const date = e.createdAt.slice(0, 10);
        const status = e.status ? `/${e.status}` : '';
        const tags = e.tags?.length ? ` ${e.tags.join(',')}` : '';
        const preview = e.content.slice(0, 100).replace(/\n/g, ' ');
        return `- [${e.type}${status}]${tags} [${date}] ${preview}${e.content.length > 100 ? '...' : ''}`;
      })
      .join('\n');
  }
}
