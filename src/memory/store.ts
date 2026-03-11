/**
 * MemoryStore — File-based memory storage with topic scoping
 *
 * Stores memories as Markdown files:
 * - Main memory: {memoryDir}/MEMORY.md
 * - Topics: {memoryDir}/topics/{topic}.md
 *
 * Format: `- [YYYY-MM-DD] content` (dated entries)
 */

import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { MemoryConfig, MemoryStoreProvider } from './types.js';

export class MemoryStore implements MemoryStoreProvider {
  private readonly memoryDir: string;
  private readonly topicsDir: string;
  private readonly mainFile: string;

  constructor(config: Pick<MemoryConfig, 'memoryDir' | 'topicsSubdir' | 'mainFile'>) {
    this.memoryDir = config.memoryDir;
    this.topicsDir = path.join(config.memoryDir, config.topicsSubdir ?? 'topics');
    this.mainFile = config.mainFile ?? 'MEMORY.md';

    // Ensure directories exist
    if (!existsSync(this.memoryDir)) mkdirSync(this.memoryDir, { recursive: true });
    if (!existsSync(this.topicsDir)) mkdirSync(this.topicsDir, { recursive: true });
  }

  /** Read main memory file content */
  async read(): Promise<string | null> {
    const filePath = path.join(this.memoryDir, this.mainFile);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /** Append a dated entry to main memory or a specific topic */
  async append(content: string, topic?: string): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const entry = `- [${date}] ${content}\n`;

    if (topic) {
      await this.appendToTopic(topic, entry);
    } else {
      const filePath = path.join(this.memoryDir, this.mainFile);
      await fs.appendFile(filePath, entry, 'utf-8');
    }
  }

  /** List available topic file names (without .md extension) */
  async listTopics(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.topicsDir);
      return files
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace(/\.md$/, ''))
        .sort();
    } catch {
      return [];
    }
  }

  /** Read a topic file's content */
  async readTopic(name: string): Promise<string | null> {
    const filePath = path.join(this.topicsDir, `${name}.md`);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /** Get the full path to the main memory file */
  get mainFilePath(): string {
    return path.join(this.memoryDir, this.mainFile);
  }

  /** Get the full path to a topic file */
  topicFilePath(name: string): string {
    return path.join(this.topicsDir, `${name}.md`);
  }

  /** Get the topics directory path */
  get topicsDirPath(): string {
    return this.topicsDir;
  }

  private async appendToTopic(topic: string, entry: string): Promise<void> {
    const filePath = path.join(this.topicsDir, `${topic}.md`);
    const exists = existsSync(filePath);

    if (!exists) {
      // Create topic file with header
      const header = `# ${topic}\n\n`;
      await fs.writeFile(filePath, header + entry, 'utf-8');
    } else {
      await fs.appendFile(filePath, entry, 'utf-8');
    }
  }
}
