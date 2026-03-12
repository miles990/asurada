import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, generateFrontmatter, setFrontmatter, mergeFrontmatter } from './frontmatter.js';

describe('parseFrontmatter', () => {
  it('returns null for content without frontmatter', () => {
    assert.equal(parseFrontmatter('# Hello\nWorld'), null);
  });

  it('parses simple key-value pairs', () => {
    const content = '---\ntitle: Hello World\nauthor: Kuro\n---\nBody text';
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.equal(result.data.title, 'Hello World');
    assert.equal(result.data.author, 'Kuro');
    assert.equal(result.body, 'Body text');
  });

  it('parses array values in brackets', () => {
    const content = '---\ntags: [ai, agent, typescript]\n---\nBody';
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.deepEqual(result.data.tags, ['ai', 'agent', 'typescript']);
  });

  it('handles empty value after colon', () => {
    const content = '---\ntitle: \n---\nBody';
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.equal(result.data.title, '');
  });

  it('skips lines without colon', () => {
    const content = '---\ntitle: Test\nno colon here\nauthor: Me\n---\nBody';
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.equal(result.data.title, 'Test');
    assert.equal(result.data.author, 'Me');
    assert.equal(Object.keys(result.data).length, 2);
  });

  it('handles wikilink arrays', () => {
    const content = '---\nrelated: [[[Note A]], [[Note B]]]\n---\nBody';
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.deepEqual(result.data.related, ['[[Note A]]', '[[Note B]]']);
  });
});

describe('generateFrontmatter', () => {
  it('generates simple key-value frontmatter', () => {
    const result = generateFrontmatter({ title: 'Test', author: 'Kuro' });
    assert.equal(result, '---\ntitle: Test\nauthor: Kuro\n---');
  });

  it('generates array values', () => {
    const result = generateFrontmatter({ tags: ['a', 'b', 'c'] });
    assert.equal(result, '---\ntags: [a, b, c]\n---');
  });

  it('skips null and undefined values', () => {
    const result = generateFrontmatter({ title: 'Test', skip: undefined, also: null } as any);
    assert.equal(result, '---\ntitle: Test\n---');
  });

  it('skips empty arrays', () => {
    const result = generateFrontmatter({ title: 'Test', tags: [] });
    assert.equal(result, '---\ntitle: Test\n---');
  });

  it('produces empty frontmatter for empty object', () => {
    assert.equal(generateFrontmatter({}), '---\n---');
  });
});

describe('setFrontmatter', () => {
  it('replaces existing frontmatter', () => {
    const content = '---\ntitle: Old\n---\nBody here';
    const result = setFrontmatter(content, { title: 'New' });
    assert.ok(result.startsWith('---\ntitle: New\n---\n'));
    assert.ok(result.includes('Body here'));
  });

  it('inserts frontmatter when none exists', () => {
    const content = '# Hello\nWorld';
    const result = setFrontmatter(content, { title: 'Added' });
    assert.ok(result.startsWith('---\ntitle: Added\n---\n\n'));
    assert.ok(result.includes('# Hello'));
  });
});

describe('mergeFrontmatter', () => {
  it('preserves existing values (does not overwrite)', () => {
    const merged = mergeFrontmatter({ title: 'Original' }, { title: 'New', author: 'Kuro' });
    assert.equal(merged.title, 'Original');
    assert.equal(merged.author, 'Kuro');
  });

  it('deduplicates merged tags', () => {
    const merged = mergeFrontmatter({ tags: ['a', 'b'] }, { tags: ['b', 'c'] });
    assert.deepEqual(merged.tags, ['a', 'b', 'c']);
  });

  it('deduplicates merged related links', () => {
    const merged = mergeFrontmatter(
      { related: ['[[A]]', '[[B]]'] },
      { related: ['[[B]]', '[[C]]'] },
    );
    assert.deepEqual(merged.related, ['[[A]]', '[[B]]', '[[C]]']);
  });

  it('adds new fields not present in existing', () => {
    const merged = mergeFrontmatter({}, { title: 'New', tags: ['x'] });
    assert.equal(merged.title, 'New');
    assert.deepEqual(merged.tags, ['x']);
  });
});
