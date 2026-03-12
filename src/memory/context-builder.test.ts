import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextBuilder } from './context-builder.js';
import type { MemoryStore } from './store.js';
import type { MemoryIndex } from './memory-index.js';
import type { MemorySearch } from './search.js';
import type { IndexEntry } from './index-types.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    listTopics: async () => ['agent-architecture', 'cognitive-science', 'mushi', 'design-philosophy'],
    readTopic: async (name: string) => `Content of ${name} topic file.`,
    read: async () => 'Main MEMORY.md content',
    append: async () => {},
    writeTopic: async () => {},
    ...overrides,
  } as unknown as MemoryStore;
}

function mockIndex(overrides: Partial<MemoryIndex> = {}): MemoryIndex {
  return {
    getRelevantTopics: async () => [],
    getDirectionChanges: async () => [],
    query: async () => [],
    ...overrides,
  } as unknown as MemoryIndex;
}

function mockSearch(): MemorySearch {
  return {} as unknown as MemorySearch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextBuilder', () => {
  it('loads topics by keyword match', async () => {
    const builder = new ContextBuilder(mockStore(), mockIndex(), mockSearch());
    const result = await builder.build('mushi routing architecture');

    const names = result.sections.map(s => s.name);
    assert.ok(names.includes('mushi'), 'should match mushi');
    assert.ok(names.includes('agent-architecture'), 'should match agent-architecture');
  });

  it('marks keyword-matched topics with source=keyword', async () => {
    const builder = new ContextBuilder(mockStore(), mockIndex(), mockSearch());
    const result = await builder.build('mushi');

    const mushi = result.sections.find(s => s.name === 'mushi');
    assert.ok(mushi);
    assert.equal(mushi.source, 'keyword');
  });

  it('includes index-boosted topics', async () => {
    const index = mockIndex({
      getRelevantTopics: async () => ['design-philosophy', 'cognitive-science'],
    });
    const builder = new ContextBuilder(mockStore(), index, mockSearch());
    const result = await builder.build('something unrelated');

    const names = result.sections.map(s => s.name);
    assert.ok(names.includes('design-philosophy'), 'should include index-boosted topic');
  });

  it('marks boosted topics with source=index-boost', async () => {
    const index = mockIndex({
      getRelevantTopics: async () => ['design-philosophy'],
    });
    const builder = new ContextBuilder(mockStore(), index, mockSearch());
    const result = await builder.build('xyz');

    const dp = result.sections.find(s => s.name === 'design-philosophy');
    assert.ok(dp);
    assert.equal(dp.source, 'index-boost');
  });

  it('respects maxTopics option', async () => {
    const index = mockIndex({
      getRelevantTopics: async () => ['design-philosophy', 'cognitive-science', 'mushi'],
    });
    const builder = new ContextBuilder(mockStore(), index, mockSearch());
    const result = await builder.build('agent architecture design mushi cognitive', { maxTopics: 2 });

    assert.ok(result.sections.length <= 2);
  });

  it('truncates long topic content', async () => {
    const longContent = 'A'.repeat(5000);
    const store = mockStore({
      readTopic: async () => longContent,
    });
    const builder = new ContextBuilder(store, mockIndex(), mockSearch());
    const result = await builder.build('mushi', { maxTopicChars: 100 });

    const section = result.sections[0];
    assert.ok(section);
    assert.ok(section.content.length < 5000);
    assert.ok(section.content.endsWith('...(truncated)'));
  });

  it('includes direction-change entries', async () => {
    const dcEntry: IndexEntry = {
      id: 'dc1',
      type: 'direction-change',
      content: 'Previously thought X, now think Y',
      createdAt: '2026-03-10T00:00:00Z',
      tags: ['mushi'],
    };
    const index = mockIndex({
      getDirectionChanges: async () => [dcEntry],
    });
    const builder = new ContextBuilder(mockStore(), index, mockSearch());
    const result = await builder.build('mushi');

    assert.equal(result.directionChanges.length, 1);
    assert.ok(result.directionChanges[0].formatted.includes('2026-03-10'));
    assert.ok(result.directionChanges[0].formatted.includes('Previously thought X'));
  });

  it('excludes assistant messages from keyword enrichment', async () => {
    const store = mockStore({
      listTopics: async () => ['mushi', 'design-philosophy'],
    });
    const builder = new ContextBuilder(store, mockIndex(), mockSearch());
    const result = await builder.build('hello', {
      conversationHistory: [
        { role: 'user', content: 'tell me about mushi' },
        { role: 'assistant', content: 'design-philosophy is about...' },
      ],
    });

    const names = result.sections.map(s => s.name);
    assert.ok(names.includes('mushi'), 'user message keyword should match');
    // assistant message should NOT contribute to matching
    assert.ok(!names.includes('design-philosophy'), 'assistant message should not contribute keywords');
  });

  it('builds manifest from index entries', async () => {
    const entries: IndexEntry[] = [
      { id: 'e1', type: 'observation', content: 'First entry about testing', createdAt: '2026-03-10T12:00:00Z', tags: ['test'] },
      { id: 'e2', type: 'direction-change', content: 'Changed approach', createdAt: '2026-03-11T12:00:00Z', status: 'active' },
    ];
    const index = mockIndex({
      query: async () => entries,
    });
    const builder = new ContextBuilder(mockStore(), index, mockSearch());
    const result = await builder.build('test');

    assert.ok(result.manifest.includes('observation'));
    assert.ok(result.manifest.includes('2026-03-10'));
    assert.ok(result.manifest.includes('direction-change'));
  });

  it('includes main memory when requested', async () => {
    const builder = new ContextBuilder(mockStore(), mockIndex(), mockSearch());
    const result = await builder.build('test', { includeMainMemory: true });
    assert.equal(result.mainMemory, 'Main MEMORY.md content');
  });

  it('formatForPrompt produces valid XML-like sections', async () => {
    const builder = new ContextBuilder(mockStore(), mockIndex(), mockSearch());
    const result = await builder.build('mushi');
    const formatted = builder.formatForPrompt(result);

    assert.ok(formatted.includes('<topic-memory name="mushi">'));
    assert.ok(formatted.includes('</topic-memory>'));
  });

  it('returns empty result for query with no matching topics', async () => {
    const store = mockStore({
      listTopics: async () => ['agent-architecture'],
    });
    const builder = new ContextBuilder(store, mockIndex(), mockSearch());
    const result = await builder.build('xyznonexistent');

    assert.equal(result.sections.length, 0);
  });

  it('skips null topic content', async () => {
    const store = mockStore({
      readTopic: async () => null as unknown as string,
    });
    const builder = new ContextBuilder(store, mockIndex(), mockSearch());
    const result = await builder.build('mushi');

    assert.equal(result.sections.length, 0);
  });
});
