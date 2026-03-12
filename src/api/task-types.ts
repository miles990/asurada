/**
 * Task Board Types — BoardTask and TaskEvent for event-sourced JSONL store.
 */

export interface BoardTask {
  id: string;              // "task-001"
  title: string;
  status: 'todo' | 'doing' | 'done' | 'abandoned';
  assignee?: string;       // "alex" | agent name | null
  createdBy: string;
  createdAt: string;       // ISO timestamp
  updatedAt: string;
  labels?: string[];
  verify?: string;         // optional shell command
  messageRef?: string;     // link to a message ID
}

export interface TaskEvent {
  taskId: string;
  action: 'create' | 'update' | 'move' | 'assign' | 'complete' | 'abandon' | 'delete';
  data: Partial<BoardTask>;
  by: string;
  at: string;              // ISO timestamp
}
