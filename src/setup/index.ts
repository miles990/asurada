export { detectEnvironment, formatDetection } from './detect.js';
export type { DetectionResult, OsInfo, RuntimeInfo, ToolInfo, ChromeInfo, LlmInfo } from './detect.js';
export { runWizard } from './wizard.js';
export type { WizardResult, WizardLanguage } from './wizard.js';
export { scaffoldMemorySpace } from './scaffold.js';
export type { ScaffoldResult } from './scaffold.js';
export { isFirstRun, markFirstRunDone, gatherFirstRunInfo, formatFirstRunGreeting } from './first-run.js';
export type { FirstRunInfo } from './first-run.js';
