/**
 * Workspace Observer — file system perception for Asurada agents.
 *
 * Provides structured snapshots of the working directory:
 * - File tree (depth-limited, filtered)
 * - Git status (branch, dirty, untracked)
 * - Recently modified files
 *
 * Generalized from mini-agent's workspace.ts — no framework coupling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// === Types ===

export interface WorkspaceSnapshot {
  cwd: string;
  files: string[];
  git: {
    branch: string;
    dirty: string[];
    untracked: string[];
  } | null;
  recentlyModified: Array<{ file: string; mtime: string }>;
}

export interface WorkspaceOptions {
  /** Directories to exclude (default: node_modules, .git, dist, etc.) */
  excludeDirs?: string[];
  /** Max directory depth (default: 2) */
  maxDepth?: number;
  /** Max files to list (default: 30) */
  maxFiles?: number;
  /** Max recently modified files (default: 5) */
  recentLimit?: number;
}

// === Defaults ===

const DEFAULT_EXCLUDED = new Set([
  'node_modules', '.git', 'dist', '.DS_Store', '.cache',
  'coverage', '.turbo', '.next', '.nuxt',
]);

// === Implementation ===

function listFiles(
  dir: string,
  excludes: Set<string>,
  maxDepth: number,
  maxFiles: number,
  depth = 0,
  prefix = '',
): string[] {
  if (depth > maxDepth) return [];

  const results: string[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (excludes.has(entry.name)) continue;
    if (entry.name.startsWith('.') && depth === 0 && entry.name !== '.env') continue;

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push(`${relativePath}/`);
      if (results.length < maxFiles) {
        results.push(...listFiles(
          path.join(dir, entry.name), excludes, maxDepth, maxFiles, depth + 1, relativePath,
        ));
      }
    } else {
      results.push(relativePath);
    }

    if (results.length >= maxFiles) break;
  }

  return results;
}

function getGitStatus(cwd: string): WorkspaceSnapshot['git'] {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd, encoding: 'utf-8', timeout: 3000,
    });

    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd, encoding: 'utf-8', timeout: 3000,
    }).trim();

    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd, encoding: 'utf-8', timeout: 3000,
    }).trim();

    const dirty: string[] = [];
    const untracked: string[] = [];

    if (status) {
      for (const line of status.split('\n')) {
        const code = line.slice(0, 2);
        const file = line.slice(3);
        if (code === '??') {
          untracked.push(file);
        } else {
          dirty.push(file);
        }
      }
    }

    return { branch, dirty, untracked };
  } catch {
    return null;
  }
}

function getRecentlyModified(
  dir: string,
  excludes: Set<string>,
  limit: number,
): Array<{ file: string; mtime: string }> {
  const allFiles: Array<{ file: string; mtime: Date }> = [];

  function walk(d: string, prefix = ''): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (excludes.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(d, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else {
        try {
          const stat = fs.statSync(fullPath);
          allFiles.push({ file: relativePath, mtime: stat.mtime });
        } catch { /* skip */ }
      }
    }
  }

  walk(dir);

  return allFiles
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, limit)
    .map(f => ({
      file: f.file,
      mtime: f.mtime.toISOString().replace('T', ' ').slice(0, 19),
    }));
}

/** Take a snapshot of the workspace */
export function getWorkspaceSnapshot(cwd?: string, options?: WorkspaceOptions): WorkspaceSnapshot {
  const dir = cwd ?? process.cwd();
  const excludes = options?.excludeDirs
    ? new Set(options.excludeDirs)
    : DEFAULT_EXCLUDED;
  const maxDepth = options?.maxDepth ?? 2;
  const maxFiles = options?.maxFiles ?? 30;
  const recentLimit = options?.recentLimit ?? 5;

  return {
    cwd: dir,
    files: listFiles(dir, excludes, maxDepth, maxFiles),
    git: getGitStatus(dir),
    recentlyModified: getRecentlyModified(dir, excludes, recentLimit),
  };
}

/** Format a workspace snapshot as text for agent context */
export function formatWorkspaceContext(snapshot: WorkspaceSnapshot): string {
  const lines: string[] = [];

  lines.push(`Working directory: ${snapshot.cwd}`);

  if (snapshot.git) {
    lines.push(`Git branch: ${snapshot.git.branch}`);
    if (snapshot.git.dirty.length > 0) {
      lines.push(`Modified: ${snapshot.git.dirty.join(', ')}`);
    }
    if (snapshot.git.untracked.length > 0) {
      lines.push(`Untracked: ${snapshot.git.untracked.join(', ')}`);
    }
  }

  if (snapshot.recentlyModified.length > 0) {
    lines.push('Recently modified:');
    for (const f of snapshot.recentlyModified) {
      lines.push(`  ${f.mtime} ${f.file}`);
    }
  }

  if (snapshot.files.length > 0) {
    lines.push(`Files (${snapshot.files.length}):`);
    for (const f of snapshot.files) {
      lines.push(`  ${f}`);
    }
  }

  return lines.join('\n');
}
