import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextOptimizer } from './context-optimizer.js';

describe('ContextOptimizer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-opt-test-'));
  });

  it('protected sections always load', () => {
    const opt = new ContextOptimizer({
      stateDir: tmpDir,
      protectedSections: ['soul', 'memory'],
    });
    assert.equal(opt.shouldLoad('soul'), true);
    assert.equal(opt.shouldLoad('memory'), true);
  });

  it('non-demoted sections load by default', () => {
    const opt = new ContextOptimizer({ stateDir: tmpDir });
    assert.equal(opt.shouldLoad('some-section'), true);
  });

  it('demotes section after threshold zero-citation cycles', () => {
    const opt = new ContextOptimizer({
      stateDir: tmpDir,
      protectedSections: [],
      sectionKeywords: { docker: ['container', 'docker'] },
      demotionThreshold: 3,
    });

    // 3 cycles with no docker citation
    for (let i = 0; i < 3; i++) {
      opt.recordCycle({ citedSections: ['other'] });
    }

    assert.deepEqual(opt.getDemotedSections(), ['docker']);
    assert.equal(opt.shouldLoad('docker'), false);
  });

  it('demoted section loads when context hints match keywords', () => {
    const opt = new ContextOptimizer({
      stateDir: tmpDir,
      protectedSections: [],
      sectionKeywords: { docker: ['container', 'docker'] },
      demotionThreshold: 3,
    });

    for (let i = 0; i < 3; i++) {
      opt.recordCycle({ citedSections: [] });
    }

    assert.equal(opt.shouldLoad('docker', ['fix the docker issue']), true);
    assert.equal(opt.shouldLoad('docker', ['unrelated topic']), false);
  });

  it('auto-promotes when demoted section is cited', () => {
    const opt = new ContextOptimizer({
      stateDir: tmpDir,
      protectedSections: [],
      sectionKeywords: { docker: ['docker'] },
      demotionThreshold: 2,
    });

    // Demote
    opt.recordCycle({ citedSections: [] });
    opt.recordCycle({ citedSections: [] });
    assert.deepEqual(opt.getDemotedSections(), ['docker']);

    // Cite it → auto-promote
    opt.recordCycle({ citedSections: ['docker'] });
    assert.deepEqual(opt.getDemotedSections(), []);
    assert.ok(opt.getObservationSections().includes('docker'));
  });

  it('tracks total cycles', () => {
    const opt = new ContextOptimizer({ stateDir: tmpDir });
    assert.equal(opt.totalCycles, 0);
    opt.recordCycle({ citedSections: [] });
    opt.recordCycle({ citedSections: [] });
    assert.equal(opt.totalCycles, 2);
  });

  it('persists and restores state', () => {
    const opt1 = new ContextOptimizer({
      stateDir: tmpDir,
      protectedSections: [],
      sectionKeywords: { x: ['x'] },
      demotionThreshold: 1,
    });
    opt1.recordCycle({ citedSections: [] });
    opt1.save();

    const opt2 = new ContextOptimizer({
      stateDir: tmpDir,
      protectedSections: [],
      sectionKeywords: { x: ['x'] },
      demotionThreshold: 1,
    });
    assert.equal(opt2.totalCycles, 1);
    assert.deepEqual(opt2.getDemotedSections(), ['x']);
  });

  it('does not demote protected sections', () => {
    const opt = new ContextOptimizer({
      stateDir: tmpDir,
      protectedSections: ['soul'],
      sectionKeywords: { soul: ['soul'] },
      demotionThreshold: 1,
    });
    opt.recordCycle({ citedSections: [] });
    assert.deepEqual(opt.getDemotedSections(), []);
  });

  it('observation period ticks down each cycle', () => {
    const opt = new ContextOptimizer({
      stateDir: tmpDir,
      protectedSections: [],
      sectionKeywords: { x: ['x'] },
      demotionThreshold: 1,
      observationCycles: 2,
    });

    // Demote then promote
    opt.recordCycle({ citedSections: [] });
    opt.recordCycle({ citedSections: ['x'] });
    assert.ok(opt.getObservationSections().includes('x'));

    // Tick observation
    opt.recordCycle({ citedSections: [] });
    opt.recordCycle({ citedSections: [] });
    // After 2 observation cycles, x should exit observation (and be demoted again)
    assert.ok(!opt.getObservationSections().includes('x'));
  });
});
