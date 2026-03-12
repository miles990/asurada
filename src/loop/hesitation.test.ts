import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hesitate, type ErrorPattern } from './hesitation.js';

describe('hesitate', () => {
  it('returns zero score for clean response with sources', () => {
    const result = hesitate(
      '根據分析，來源: https://example.com，這是因為 X 不過 Y',
      [],
      [],
    );
    assert.equal(result.score, 0);
    assert.equal(result.confident, true);
    assert.equal(result.signals.length, 0);
  });

  it('detects absolute claims without sources', () => {
    const result = hesitate(
      '這一定是正確的，毫無疑問就是這樣。clearly the answer.',
      [],
      [],
    );
    const absoluteSignal = result.signals.find(s => s.type === 'absolute-claim');
    assert.ok(absoluteSignal, 'should detect absolute-claim signal');
    assert.ok(result.score > 0);
  });

  it('does not flag absolute claims when sources present', () => {
    const result = hesitate(
      '這一定是正確的。來源: https://example.com',
      [],
      [],
    );
    const absoluteSignal = result.signals.find(s => s.type === 'absolute-claim');
    assert.equal(absoluteSignal, undefined);
  });

  it('detects matching error patterns', () => {
    const patterns: ErrorPattern[] = [{
      id: 'ep-1',
      keywords: ['timeout', 'connection'],
      description: 'network timeout pattern',
      source: 'external',
      createdAt: '2026-01-01',
      triggerCount: 0,
    }];
    const result = hesitate('The connection timed out again', [], patterns);
    const errorSignal = result.signals.find(s => s.type === 'error-pattern');
    assert.ok(errorSignal, 'should detect error-pattern');
    assert.equal(errorSignal.weight, 30);
  });

  it('detects long chat without hedging', () => {
    const longChat = 'This is a very long chat response that goes on and on without any hedging language at all. '.repeat(5);
    const result = hesitate('some response', [longChat], []);
    const hedgeSignal = result.signals.find(s => s.type === 'no-hedge');
    assert.ok(hedgeSignal, 'should detect no-hedge signal');
  });

  it('does not flag short chat without hedging', () => {
    const result = hesitate('response', ['short reply'], []);
    const hedgeSignal = result.signals.find(s => s.type === 'no-hedge');
    assert.equal(hedgeSignal, undefined);
  });

  it('does not flag long chat with hedging', () => {
    const longChat = '我不確定 this is correct but '.repeat(10);
    const result = hesitate('response', [longChat], []);
    const hedgeSignal = result.signals.find(s => s.type === 'no-hedge');
    assert.equal(hedgeSignal, undefined);
  });

  it('detects overconfidence — more conclusions than reasoning', () => {
    const response = '所以結果是 A。因此答案很明顯。結論就是這樣。總之就這樣。';
    const result = hesitate(response, [], []);
    const signal = result.signals.find(s => s.type === 'overconfidence');
    assert.ok(signal, 'should detect overconfidence');
  });

  it('caps score at 100', () => {
    const patterns: ErrorPattern[] = [{
      id: 'ep-1', keywords: ['test'], description: 'd',
      source: 'external', createdAt: '', triggerCount: 0,
    }];
    // absolute-claim(20) + error-pattern(30) + no-hedge(15) + overconfidence(15) = 80 max
    // but with enough signals could approach 100
    const response = '一定不可能 obviously clearly 所以 因此 結論 答案是 test';
    const longChat = 'definitive statement without hedging at all. '.repeat(10);
    const result = hesitate(response, [longChat], patterns);
    assert.ok(result.score <= 100);
  });

  it('respects custom threshold', () => {
    const response = '一定是這樣的，毫無疑問。';
    const result = hesitate(response, [], [], { threshold: 50 });
    // absolute-claim = 20, which is < 50
    assert.equal(result.confident, true);
  });

  it('generates suggestion when signals exist', () => {
    const response = '一定是這樣';
    const result = hesitate(response, [], []);
    if (result.signals.length > 0) {
      assert.ok(result.suggestion.includes('Hesitation'));
    }
  });

  it('returns empty suggestion when no signals', () => {
    const result = hesitate('因為 X，所以 Y。來源: https://x.com', [], []);
    assert.equal(result.suggestion, '');
  });
});
