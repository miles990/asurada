/**
 * OODA Loop types — the agent's heartbeat.
 *
 * Perceive → Orient → Decide → Act → repeat.
 * Users bring their own LLM via CycleRunner.
 */

import type { AgentEvent } from '../core/event-bus.js';

// === Cycle Runner ===

/**
 * User-provided LLM integration.
 * Asurada doesn't care if it's Claude, GPT, Gemini, or a local model.
 */
export interface CycleRunner {
  /** Call the LLM with a prompt and system prompt, return the response text */
  run(prompt: string, systemPrompt: string): Promise<string>;
}

// === Cycle Context ===

/** What triggered this cycle */
export interface CycleTrigger {
  type: 'timer' | 'event' | 'manual';
  event?: AgentEvent;
}

/** Context gathered for a cycle */
export interface CycleContext {
  /** Current perception data (plugin name → output) */
  perception: Record<string, string>;
  /** Trigger that started this cycle */
  trigger: CycleTrigger;
  /** Cycle number (monotonically increasing) */
  cycleNumber: number;
  /** Agent name */
  agentName: string;
}

// === Cycle Result ===

/** Parsed action from LLM response */
export interface ParsedAction {
  /** Tag name without namespace prefix (e.g. 'remember', 'chat', 'schedule') */
  tag: string;
  /** Inner content of the tag */
  content: string;
  /** Tag attributes (e.g. { topic: 'tech', url: 'https://...' }) */
  attrs: Record<string, string>;
}

/** Result of one OODA cycle */
export interface CycleResult {
  /** Raw LLM response */
  response: string;
  /** Parsed actions from the response */
  actions: ParsedAction[];
  /** Cycle duration in ms */
  duration: number;
  /** Cycle number */
  cycleNumber: number;
}

// === Loop Options ===

/** Configuration for the OODA loop */
export interface AgentLoopOptions {
  /** User-provided LLM runner (required) */
  runner: CycleRunner;

  /** System prompt — static string or dynamic builder */
  systemPrompt?: string | (() => string);

  /**
   * Build the cycle prompt from context.
   * If not provided, uses a default that includes perception + memory data.
   * Can be async (e.g. to query ContextBuilder).
   */
  buildPrompt?: (context: CycleContext) => string | Promise<string>;

  /**
   * Tag namespace for action parsing (default: agent name or 'agent').
   * e.g. namespace 'kuro' parses <kuro:remember>, <kuro:chat>, etc.
   */
  actionNamespace?: string;

  /**
   * Handle a parsed action.
   * Called for each action in the LLM response.
   */
  onAction?: (action: ParsedAction, context: CycleContext) => Promise<void>;

  /**
   * Event patterns that trigger a cycle (default: ['trigger:*']).
   * When the EventBus emits a matching event, a new cycle starts.
   */
  triggerPatterns?: string[];

  /** Default cycle interval in ms (default: 300000 = 5m) */
  defaultInterval?: number;

  /** Min interval for scheduling in ms (default: 30000 = 30s) */
  minInterval?: number;

  /** Max interval for scheduling in ms (default: 14400000 = 4h) */
  maxInterval?: number;
}
