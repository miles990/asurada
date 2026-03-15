export { AgentLoop } from './agent-loop.js';
export {
  ModelRouter,
  calculateRoutingTemperature,
  buildTriagePrompt,
  parseRoutingDecision,
} from './model-router.js';
export { parseActions, parseDuration, extractCitedSections } from './action-parser.js';
export { buildDefaultSystemPrompt, buildCompactSystemPrompt } from './system-prompt.js';
export {
  ClaudeCliRunner,
  AnthropicApiRunner,
  ProfileRoutedRunner,
  type ClaudeCliOptions,
  type AnthropicApiOptions,
  type ProfileRoutedOptions,
} from './runners/index.js';
export { autoRoute, DEFAULT_ROUTE_MAP, type AutoRouteOptions, type AutoRouteResult, type TaskCategory } from './auto-route.js';
export type {
  AgentLoopOptions,
  CycleRunner,
  CycleContext,
  CycleTrigger,
  CycleResult,
  ParsedAction,
} from './types.js';
export type {
  RoutingDecision,
  ModelRouterOptions,
  RouteLogEvent,
} from './model-router.js';
export { RouteTelemetry } from './route-telemetry.js';
export type { TelemetryEntry, TelemetrySummary } from './route-telemetry.js';
export { StimulusDedup, buildStimulusFingerprint, DEDUP_HINT } from './stimulus-dedup.js';
export type { DedupCheckResult } from './stimulus-dedup.js';
export { FeedbackLoops } from './feedback-loops.js';
export type { FeedbackLoopsOptions, ErrorLogEntry } from './feedback-loops.js';
export { ContextOptimizer } from './context-optimizer.js';
export type { ContextOptimizerOptions, SectionDemotionState } from './context-optimizer.js';
export { HesitationAnalyzer, hesitate } from './hesitation.js';
export type { HesitationOptions, HesitationResult, HesitationSignal, HeldAction, ErrorPattern } from './hesitation.js';
