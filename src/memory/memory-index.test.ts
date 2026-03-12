import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemoryIndex } from './memory-index.js';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asurada-idx-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('MemoryIndex', () => {
  let tmpDir: string;

  afterEach(() => { if (tmpDir) cleanup(tmpDir); });

  function createIndex(): MemoryIndex {
    tmpDir = mkTmpDir();
    return new MemoryIndex(path.join(tmpDir, 'index.jsonl'));
  }

  // --- CRUD ---

  it('create + get returns entry', async () => {
    const idx = createIndex();
    const id = await idx.create('remember', 'Asurada is perception-first');
    const entry = await idx.get(id);
    assert.ok(entry);
    assert.equal(entry.type, 'remember');
    assert.equal(entry.content, 'Asurada is perception-first');
    assert.ok(entry.createdAt);
  });

  it('create with options preserves refs/tags/source/status', async () => {
    const idx = createIndex();
    const id = await idx.create('task', 'Ship v1', {
      refs: ['ref-a'],
      tags: ['release'],
      source: 'heartbeat.md',
      status: 'active',
    });
    const entry = await idx.get(id);
    assert.ok(entry);
    assert.deepEqual(entry.refs, ['ref-a']);
    assert.deepEqual(entry.tags, ['release']);
    assert.equal(entry.source, 'heartbeat.md');
    assert.equal(entry.status, 'active');
  });

  it('get returns null for missing id', async () => {
    const idx = createIndex();
    assert.equal(await idx.get('nonexistent'), null);
  });

  it('update overwrites with same-id-last-wins', async () => {
    const idx = createIndex();
    const id = await idx.create('opinion', 'Go is better than Rust');
    await idx.update(id, { content: 'Both Go and Rust have merits' });
    const entry = await idx.get(id);
    assert.ok(entry);
    assert.equal(entry.content, 'Both Go and Rust have merits');
    assert.equal(entry.type, 'opinion'); // preserved
  });

  it('update throws for missing id', async () => {
    const idx = createIndex();
    await assert.rejects(
      () => idx.update('missing', { content: 'nope' }),
      /Entry not found/,
    );
  });

  it('addRef appends ref without duplicates', async () => {
    const idx = createIndex();
    const a = await idx.create('learning', 'Topic A');
    const b = await idx.create('learning', 'Topic B');
    await idx.addRef(a, b);
    await idx.addRef(a, b); // duplicate
    const entry = await idx.get(a);
    assert.deepEqual(entry?.refs, [b]);
  });

  // --- Query ---

  it('query filters by type', async () => {
    const idx = createIndex();
    await idx.create('remember', 'mem1');
    await idx.create('opinion', 'op1');
    await idx.create('remember', 'mem2');
    const results = await idx.query({ type: 'remember' });
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.type === 'remember'));
  });

  it('query filters by multiple types', async () => {
    const idx = createIndex();
    await idx.create('remember', 'mem');
    await idx.create('opinion', 'op');
    await idx.create('task', 'task');
    const results = await idx.query({ type: ['remember', 'opinion'] });
    assert.equal(results.length, 2);
  });

  it('query filters by tags (any match)', async () => {
    const idx = createIndex();
    await idx.create('learning', 'A', { tags: ['ai', 'ml'] });
    await idx.create('learning', 'B', { tags: ['web'] });
    await idx.create('learning', 'C', { tags: ['ai'] });
    const results = await idx.query({ tags: ['ai'] });
    assert.equal(results.length, 2);
  });

  it('query filters by status', async () => {
    const idx = createIndex();
    await idx.create('task', 'T1', { status: 'active' });
    await idx.create('task', 'T2', { status: 'completed' });
    const active = await idx.query({ status: 'active' });
    assert.equal(active.length, 1);
    assert.equal(active[0].content, 'T1');
  });

  it('query with limit', async () => {
    const idx = createIndex();
    for (let i = 0; i < 5; i++) await idx.create('remember', `item-${i}`);
    const results = await idx.query({ limit: 2 });
    assert.equal(results.length, 2);
  });

  it('query references/referencedBy', async () => {
    const idx = createIndex();
    const a = await idx.create('opinion', 'Node is great');
    const b = await idx.create('learning', 'Node perf data', { refs: [a] });

    // entries that reference 'a'
    const refA = await idx.query({ references: a });
    assert.equal(refA.length, 1);
    assert.equal(refA[0].id, b);

    // entries referenced by 'b'
    const refByB = await idx.query({ referencedBy: b });
    assert.equal(refByB.length, 1);
    assert.equal(refByB[0].id, a);
  });

  // --- all / stats ---

  it('all returns resolved entries', async () => {
    const idx = createIndex();
    await idx.create('remember', 'one');
    const id = await idx.create('remember', 'two');
    await idx.update(id, { content: 'two-v2' });
    const all = await idx.all();
    assert.equal(all.length, 2); // same-id-last-wins
  });

  it('stats counts by type', async () => {
    const idx = createIndex();
    await idx.create('remember', 'r1');
    await idx.create('opinion', 'o1');
    await idx.create('remember', 'r2');
    const stats = await idx.stats();
    assert.equal(stats.total, 3);
    assert.equal(stats.remember, 2);
    assert.equal(stats.opinion, 1);
  });

  // --- Graph ---

  it('edges returns valid graph edges', async () => {
    const idx = createIndex();
    const a = await idx.create('learning', 'A');
    const b = await idx.create('learning', 'B', { refs: [a] });
    await idx.create('learning', 'C', { refs: ['nonexistent'] });
    const edges = await idx.edges();
    assert.equal(edges.length, 1);
    assert.equal(edges[0].from, b);
    assert.equal(edges[0].to, a);
  });

  it('neighbors returns both directions', async () => {
    const idx = createIndex();
    const a = await idx.create('learning', 'A');
    const b = await idx.create('learning', 'B', { refs: [a] });
    const c = await idx.create('learning', 'C');
    await idx.addRef(a, c);
    const neighbors = await idx.neighbors(a);
    const ids = neighbors.map(n => n.id).sort();
    assert.deepEqual(ids, [b, c].sort());
  });

  it('neighbors returns empty for unknown id', async () => {
    const idx = createIndex();
    const result = await idx.neighbors('ghost');
    assert.equal(result.length, 0);
  });

  // --- Relevance ---

  it('findRelevant matches content/tags/source', async () => {
    const idx = createIndex();
    await idx.create('learning', 'TypeScript strict mode is essential', { tags: ['typescript'] });
    await idx.create('learning', 'Python GIL limitations', { tags: ['python'] });
    await idx.create('opinion', 'Rust ownership model', { source: 'rust-book.md' });

    const results = await idx.findRelevant('typescript');
    assert.ok(results.length >= 1);
    assert.equal(results[0].tags?.[0], 'typescript');
  });

  it('findRelevant filters by types', async () => {
    const idx = createIndex();
    await idx.create('learning', 'Agent patterns');
    await idx.create('opinion', 'Agent opinions');
    const results = await idx.findRelevant('agent', { types: ['opinion'] });
    assert.equal(results.length, 1);
    assert.equal(results[0].type, 'opinion');
  });

  it('findRelevant returns empty for stop-word-only query', async () => {
    const idx = createIndex();
    await idx.create('remember', 'anything');
    const results = await idx.findRelevant('the and for');
    assert.equal(results.length, 0);
  });

  // --- getRelevantTopics ---

  it('getRelevantTopics extracts topics from tags and refs', async () => {
    const idx = createIndex();
    await idx.create('learning', 'AI agent architecture', {
      tags: ['agent-architecture'],
      refs: ['topic:cognitive-science'],
    });
    const topics = await idx.getRelevantTopics('agent architecture');
    assert.ok(topics.includes('agent-architecture'));
  });

  // --- getDirectionChanges ---

  it('getDirectionChanges returns direction-change entries for topics', async () => {
    const idx = createIndex();
    await idx.create('direction-change', 'was: goal-driven → now: perception-first', {
      tags: ['design-philosophy'],
      refs: ['topic:agent-architecture'],
    });
    await idx.create('remember', 'unrelated memory');
    const changes = await idx.getDirectionChanges(['design-philosophy']);
    assert.equal(changes.length, 1);
    assert.ok(changes[0].content.includes('perception-first'));
  });

  it('getDirectionChanges matches by content mention', async () => {
    const idx = createIndex();
    await idx.create('direction-change', 'Shifted approach in agent-architecture');
    const changes = await idx.getDirectionChanges(['agent-architecture']);
    assert.equal(changes.length, 1);
  });

  // --- Obsidian ---

  it('toWikilinks generates obsidian links', async () => {
    const idx = createIndex();
    const a = await idx.create('learning', 'Linked target content here');
    const b = await idx.create('opinion', 'My opinion', { refs: [a] });
    const links = await idx.toWikilinks(b);
    assert.equal(links.length, 1);
    assert.ok(links[0].startsWith('[['));
    assert.ok(links[0].includes('Linked target content here'));
  });

  it('toMarkdown generates frontmatter + content', async () => {
    const idx = createIndex();
    const id = await idx.create('opinion', 'File=Truth is essential', {
      tags: ['design'],
      source: 'architecture.md',
    });
    const md = await idx.toMarkdown(id);
    assert.ok(md);
    assert.ok(md.includes('type: opinion'));
    assert.ok(md.includes('tags: [design]'));
    assert.ok(md.includes('source: architecture.md'));
    assert.ok(md.includes('File=Truth is essential'));
  });

  it('toMarkdown returns null for missing id', async () => {
    const idx = createIndex();
    assert.equal(await idx.toMarkdown('nope'), null);
  });

  // --- Resilience ---

  it('handles malformed JSONL lines gracefully', async () => {
    tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'index.jsonl');
    fs.writeFileSync(filePath, '{"id":"a","type":"remember","content":"good","createdAt":"2026-01-01"}\nBAD LINE\n{"id":"b","type":"opinion","content":"also good","createdAt":"2026-01-02"}\n');
    const idx = new MemoryIndex(filePath);
    const all = await idx.all();
    assert.equal(all.length, 2); // skips bad line
  });

  it('works with empty file', async () => {
    const idx = createIndex();
    const all = await idx.all();
    assert.equal(all.length, 0);
    const stats = await idx.stats();
    assert.equal(stats.total, 0);
  });
});
