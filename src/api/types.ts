/**
 * HTTP API types — server options, message format, status shape.
 */

/** Options for starting the HTTP server */
export interface ServerOptions {
  /** Port to listen on (default: 3000 or PORT env) */
  port?: number;
  /** API key for authentication (optional) */
  apiKey?: string;
  /** CORS origin (default: '*') */
  corsOrigin?: string;
}

/** A message in the agent's inbox/room */
export interface Message {
  id: string;
  from: string;
  text: string;
  replyTo?: string;
  mentions?: string[];
  timestamp: string;
}

/** Agent status shape returned by GET /status */
export interface AgentStatus {
  agent: {
    name: string;
    instanceId: string;
    running: boolean;
    uptime: number;
  };
  loop: {
    running: boolean;
    cycles: number;
  } | null;
  lanes: {
    running: number;
    queued: number;
    completed: number;
  };
  perception: {
    plugins: number;
    lastRun: string | null;
  };
}

/** Health check response */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  version: string;
  perception?: {
    pluginCount: number;
    healthyCount: number;
    unhealthyPlugins: string[];
  };
  loop?: {
    running: boolean;
    cycles: number;
  } | null;
  lanes?: {
    active: number;
    queued: number;
    completed: number;
  };
  memory?: {
    indexEntries: number;
    topicCount: number;
  };
}
