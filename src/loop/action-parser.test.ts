import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseActions, parseDuration } from './action-parser.js';

describe('parseActions', () => {
  it('parses a simple tag with content', () => {
    const response = '<agent:remember>hello world</agent:remember>';
    const actions = parseActions(response, 'agent');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].tag, 'remember');
    assert.equal(actions[0].content, 'hello world');
    assert.deepEqual(actions[0].attrs, {});
  });

  it('parses tag with attributes', () => {
    const response = '<agent:remember topic="tech">some insight</agent:remember>';
    const actions = parseActions(response, 'agent');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].tag, 'remember');
    assert.equal(actions[0].content, 'some insight');
    assert.deepEqual(actions[0].attrs, { topic: 'tech' });
  });

  it('parses multiple attributes', () => {
    const response = '<kuro:show url="https://example.com" title="Test">desc</kuro:show>';
    const actions = parseActions(response, 'kuro');
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].attrs, { url: 'https://example.com', title: 'Test' });
  });

  it('parses self-closing tags', () => {
    const response = '<agent:schedule next="5m" reason="rest" />';
    const actions = parseActions(response, 'agent');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].tag, 'schedule');
    assert.equal(actions[0].content, '');
    assert.deepEqual(actions[0].attrs, { next: '5m', reason: 'rest' });
  });

  it('parses multiple tags in one response', () => {
    const response = `Some text
<agent:remember>insight 1</agent:remember>
middle text
<agent:chat>hello Alex</agent:chat>
<agent:schedule next="10m" />`;
    const actions = parseActions(response, 'agent');
    assert.equal(actions.length, 3);
    assert.equal(actions[0].tag, 'remember');
    assert.equal(actions[1].tag, 'chat');
    assert.equal(actions[2].tag, 'schedule');
  });

  it('handles multiline content', () => {
    const response = `<agent:action>
## Decision
Did something important

Verified: yes
</agent:action>`;
    const actions = parseActions(response, 'agent');
    assert.equal(actions.length, 1);
    assert.ok(actions[0].content.includes('## Decision'));
    assert.ok(actions[0].content.includes('Verified: yes'));
  });

  it('returns empty array for no matches', () => {
    const response = 'no tags here';
    const actions = parseActions(response, 'agent');
    assert.equal(actions.length, 0);
  });

  it('ignores tags with different namespace', () => {
    const response = '<other:remember>ignored</other:remember>';
    const actions = parseActions(response, 'agent');
    assert.equal(actions.length, 0);
  });

  it('handles hyphenated tag names', () => {
    const response = '<agent:goal-progress>50%</agent:goal-progress>';
    const actions = parseActions(response, 'agent');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].tag, 'goal-progress');
    assert.equal(actions[0].content, '50%');
  });

  it('trims content whitespace', () => {
    const response = '<agent:chat>  hello  </agent:chat>';
    const actions = parseActions(response, 'agent');
    assert.equal(actions[0].content, 'hello');
  });
});

describe('parseDuration', () => {
  it('parses seconds', () => {
    assert.equal(parseDuration('30s'), 30_000);
  });

  it('parses minutes', () => {
    assert.equal(parseDuration('5m'), 300_000);
  });

  it('parses hours', () => {
    assert.equal(parseDuration('2h'), 7_200_000);
  });

  it('parses "now" as 30s', () => {
    assert.equal(parseDuration('now'), 30_000);
  });

  it('parses decimal values', () => {
    assert.equal(parseDuration('1.5h'), 5_400_000);
    assert.equal(parseDuration('0.5m'), 30_000);
  });

  it('returns null for invalid input', () => {
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration('abc'), null);
    assert.equal(parseDuration('5'), null);
    assert.equal(parseDuration('5x'), null);
  });
});
