import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findConfigFile, loadConfig, generateConfig, writeConfig } from './loader.js';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asurada-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// =============================================================================
// findConfigFile
// =============================================================================

describe('findConfigFile', () => {
  let tmpDir: string;
  afterEach(() => { if (tmpDir) cleanup(tmpDir); });

  it('finds asurada.yaml in directory', () => {
    tmpDir = mkTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'asurada.yaml'), 'agent:\n  name: test\n');
    const result = findConfigFile(tmpDir);
    assert.ok(result);
    assert.ok(result.endsWith('asurada.yaml'));
  });

  it('finds agent-compose.yaml as fallback', () => {
    tmpDir = mkTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'agent-compose.yaml'), 'agent:\n  name: test\n');
    const result = findConfigFile(tmpDir);
    assert.ok(result);
    assert.ok(result.endsWith('agent-compose.yaml'));
  });

  it('returns null when no config exists', () => {
    tmpDir = mkTmpDir();
    assert.equal(findConfigFile(tmpDir), null);
  });

  it('uses specificFile when provided', () => {
    tmpDir = mkTmpDir();
    const specific = path.join(tmpDir, 'custom.yaml');
    fs.writeFileSync(specific, 'agent:\n  name: custom\n');
    assert.equal(findConfigFile(undefined, specific), specific);
  });
});

// =============================================================================
// loadConfig
// =============================================================================

describe('loadConfig', () => {
  let tmpDir: string;
  afterEach(() => { if (tmpDir) cleanup(tmpDir); });

  it('loads and merges with defaults', () => {
    tmpDir = mkTmpDir();
    const configPath = path.join(tmpDir, 'asurada.yaml');
    fs.writeFileSync(configPath, `
agent:
  name: kuro
  persona: curious explorer
loop:
  runner: claude-cli
`);
    const config = loadConfig(configPath);
    assert.equal(config.agent.name, 'kuro');
    assert.equal(config.agent.persona, 'curious explorer');
    assert.equal(config.loop?.runner, 'claude-cli');
    // Defaults should be applied
    assert.ok(config.memory);
    assert.ok(config.logging);
  });

  it('throws when agent.name is missing', () => {
    tmpDir = mkTmpDir();
    const configPath = path.join(tmpDir, 'asurada.yaml');
    fs.writeFileSync(configPath, 'loop:\n  runner: claude-cli\n');
    assert.throws(() => loadConfig(configPath), /agent\.name is required/);
  });

  it('resolves relative plugin paths against config dir', () => {
    tmpDir = mkTmpDir();
    const configPath = path.join(tmpDir, 'asurada.yaml');
    fs.writeFileSync(configPath, `
agent:
  name: test
perception:
  plugins:
    - name: git-status
      script: plugins/git.sh
      interval: 60
`);
    const config = loadConfig(configPath);
    const pluginScript = config.perception?.plugins?.[0]?.script;
    assert.ok(pluginScript);
    assert.ok(path.isAbsolute(pluginScript));
    assert.ok(pluginScript.includes('plugins/git.sh'));
  });
});

// =============================================================================
// generateConfig / writeConfig
// =============================================================================

describe('generateConfig', () => {
  it('generates valid YAML with agent name', () => {
    const yaml = generateConfig({ name: 'mybot' });
    assert.ok(yaml.includes('mybot'));
    assert.ok(yaml.includes('# Asurada Agent Configuration'));
  });

  it('includes runner when specified', () => {
    const yaml = generateConfig({ name: 'bot', runner: 'anthropic-api' });
    assert.ok(yaml.includes('anthropic-api'));
  });
});

describe('writeConfig', () => {
  let tmpDir: string;
  afterEach(() => { if (tmpDir) cleanup(tmpDir); });

  it('writes asurada.yaml to directory', () => {
    tmpDir = mkTmpDir();
    const filePath = writeConfig(tmpDir, { name: 'written' });
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('written'));
  });
});
