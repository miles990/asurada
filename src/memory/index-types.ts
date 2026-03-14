/**
 * Memory Index Types — Unified Relational Cognitive Graph
 *
 * The memory-index is Asurada's unique differentiator:
 * - append-only JSONL (git-friendly, never corrupts)
 * - same-id-last-wins (upsert = append new version)
 * - generic refs[] (any entry → any entry, forms cognitive graph)
 * - unified cognitive types (all thought types in one index)
 *
 * Industry-novel combination: no existing framework does all four.
 */

/** Types of cognitive entries — everything the agent thinks */
export type CognitiveType =
  | 'remember'           // Persistent memory ("I learned that...")
  | 'commitment'         // Promises and commitments ("I will...")
  | 'learning'           // Knowledge acquired ("From reading X...")
  | 'thread'             // Ongoing thought threads (cross-cycle thinking)
  | 'goal'               // Objectives (with progress tracking)
  | 'task'               // Actionable items (completable)
  | 'observation'        // Perceptual notes ("I noticed...")
  | 'opinion'            // Formed opinions ("I think...")
  | 'direction-change'   // Strategy/priority shifts ("was X → now Y because Z")
  | 'understanding'      // Deep comprehension ("I now understand...")
  | 'feedback';          // User corrections and behavioral patterns (co-evolution)

/** A single entry in the cognitive index */
export interface IndexEntry {
  /** Unique identifier (nanoid or user-defined) */
  id: string;
  /** What kind of thought this is */
  type: CognitiveType;
  /** The actual content */
  content: string;
  /** References to other entries — forms the cognitive graph */
  refs?: string[];
  /** Classification tags for filtering */
  tags?: string[];
  /** ISO timestamp of creation (or latest update for same-id-last-wins) */
  createdAt: string;
  /** Origin: which file, conversation, or perception produced this */
  source?: string;
  /** Optional status for completable types (task/goal/commitment) */
  status?: 'active' | 'completed' | 'abandoned';
  /** Arbitrary metadata (extensible without schema change) */
  meta?: Record<string, unknown>;
}

/** A line in the JSONL file — IndexEntry serialized */
export type IndexLine = IndexEntry;

/** Query parameters for filtering entries */
export interface IndexQuery {
  /** Filter by cognitive type */
  type?: CognitiveType | CognitiveType[];
  /** Filter by tags (any match) */
  tags?: string[];
  /** Filter by status */
  status?: IndexEntry['status'];
  /** Filter entries that reference this ID */
  referencedBy?: string;
  /** Filter entries that this ID references */
  references?: string;
  /** Limit results */
  limit?: number;
}

/** An edge in the cognitive graph */
export interface GraphEdge {
  from: string;
  to: string;
}

/** Resolved index: all entries after same-id-last-wins */
export type ResolvedIndex = Map<string, IndexEntry>;
