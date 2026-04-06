import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliPath = 'packages/opencode-plugin-reliability/src/cli.js';

test('cli score command returns JSON with total score', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reliability-cli-'));
  const labelsPath = join(root, 'labels.json');

  await writeFile(
    labelsPath,
    JSON.stringify({ counts: { tp: 3, fp: 1, fn: 0, ignored: 0 } }),
  );

  const result = spawnSync(process.execPath, [cliPath, 'score', '--labels', labelsPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(typeof parsed.total, 'number');
});

test('cli gate command exits non-zero on fail verdict', () => {
  const result = spawnSync(process.execPath, [cliPath, 'gate', '--current', '60', '--baseline', '80'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.verdict, 'fail');
});

test('skill doc references scoreboard and soft gate workflow', async () => {
  const skillPath = '.opencode/skills/opencode-plugin-reliability-loop/SKILL.md';
  const skill = await readFile(skillPath, 'utf8');

  assert.match(skill, /scoreboard\.json/);
  assert.match(skill, /soft gate/i);
  assert.match(skill, /post_nudge_user_correction/);
});
