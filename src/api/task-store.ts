/**
 * Task Store — append-only JSONL event-sourced store for BoardTask.
 *
 * Each write appends a TaskEvent line to tasks.jsonl.
 * State is reconstructed by replaying events in order.
 * In-memory cache is updated on every write (no full replays after first load).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BoardTask, TaskEvent } from './task-types.js';

/** Input shape for createTask — title required, rest optional */
export interface CreateTaskInput {
  title: string;
  assignee?: string;
  labels?: string[];
  verify?: string;
  messageRef?: string;
}

/** Input shape for updateTask — all fields optional */
export interface UpdateTaskInput {
  title?: string;
  status?: BoardTask['status'];
  assignee?: string;
  labels?: string[];
  verify?: string;
  messageRef?: string;
}

export class TaskStore {
  private readonly filePath: string;
  /** In-memory state: taskId → BoardTask. null means not yet loaded. */
  private cache: Map<string, BoardTask> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async createTask(input: CreateTaskInput, by: string): Promise<BoardTask> {
    const state = this.loadCache();
    const id = this.nextId(state);
    const now = new Date().toISOString();

    const task: BoardTask = {
      id,
      title: input.title,
      status: 'todo',
      createdBy: by,
      createdAt: now,
      updatedAt: now,
      ...(input.assignee !== undefined && { assignee: input.assignee }),
      ...(input.labels !== undefined && { labels: input.labels }),
      ...(input.verify !== undefined && { verify: input.verify }),
      ...(input.messageRef !== undefined && { messageRef: input.messageRef }),
    };

    const event: TaskEvent = {
      taskId: id,
      action: 'create',
      data: task,
      by,
      at: now,
    };

    this.appendEvent(event);
    state.set(id, task);
    return task;
  }

  async updateTask(id: string, input: UpdateTaskInput, by: string): Promise<BoardTask | null> {
    const state = this.loadCache();
    const existing = state.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updated: BoardTask = {
      ...existing,
      ...input,
      updatedAt: now,
    };

    const event: TaskEvent = {
      taskId: id,
      action: 'update',
      data: { ...input, updatedAt: now },
      by,
      at: now,
    };

    this.appendEvent(event);
    state.set(id, updated);
    return updated;
  }

  async deleteTask(id: string, by: string): Promise<void> {
    const state = this.loadCache();
    const now = new Date().toISOString();

    const event: TaskEvent = {
      taskId: id,
      action: 'delete',
      data: {},
      by,
      at: now,
    };

    this.appendEvent(event);
    state.delete(id);
  }

  async getTasks(): Promise<BoardTask[]> {
    const state = this.loadCache();
    return Array.from(state.values());
  }

  async getTask(id: string): Promise<BoardTask | null> {
    const state = this.loadCache();
    return state.get(id) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** Load and return the in-memory cache, replaying from disk if needed. */
  private loadCache(): Map<string, BoardTask> {
    if (this.cache !== null) return this.cache;

    const state = new Map<string, BoardTask>();
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line) as TaskEvent;
        this.applyEvent(state, event);
      }
    } catch {
      // File not found or empty — start with empty state
    }

    this.cache = state;
    return state;
  }

  /** Apply a single event to the in-memory state map. */
  private applyEvent(state: Map<string, BoardTask>, event: TaskEvent): void {
    switch (event.action) {
      case 'create': {
        if (event.data.id && event.data.title && event.data.status) {
          state.set(event.taskId, event.data as BoardTask);
        }
        break;
      }
      case 'update':
      case 'move':
      case 'assign':
      case 'complete':
      case 'abandon': {
        const existing = state.get(event.taskId);
        if (existing) {
          state.set(event.taskId, { ...existing, ...event.data });
        }
        break;
      }
      case 'delete': {
        state.delete(event.taskId);
        break;
      }
    }
  }

  /** Append a TaskEvent as a JSON line. Creates parent directories if needed. */
  private appendEvent(event: TaskEvent): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n');
  }

  /** Generate the next sequential task ID based on current max. */
  private nextId(state: Map<string, BoardTask>): string {
    // Also scan the file for delete events so IDs are never reused
    let max = 0;
    for (const id of state.keys()) {
      const n = this.parseTaskNum(id);
      if (n > max) max = n;
    }
    // Scan all events for highest numeric ID (covers deleted tasks too)
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line) as TaskEvent;
        const n = this.parseTaskNum(event.taskId);
        if (n > max) max = n;
      }
    } catch {
      // File doesn't exist yet
    }
    return `task-${String(max + 1).padStart(3, '0')}`;
  }

  private parseTaskNum(id: string): number {
    const match = id.match(/^task-(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
