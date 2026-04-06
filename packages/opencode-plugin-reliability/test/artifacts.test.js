import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeRunArtifacts } from '../src/index.js';

test('writeRunArtifacts creates run files and updates scoreboard', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'opencode-reliability-'));
  const output = await writeRunArtifacts({
    rootDir,
    runId: '2026-04-06T11-22-33-000Z',
    run: {
      events: [{ role: 'assistant', text: 'Would you like me to continue?' }],
      labels: { counts: { tp: 2, fp: 0, fn: 1, ignored: 0 }, reasonCodes: [] },
      score: { total: 81, components: { continuationSuccess: 67 } },
    },
    diff: {
      verdict: 'warn',
      delta: -2,
      reasonCodes: ['GATE_MILD_REGRESSION'],
    },
  });

  assert.equal(output.runDir.includes('2026-04-06T11-22-33-000Z'), true);

  const scoreboardPath = join(rootDir, '.opencode/reliability/scoreboard.json');
  const scoreboard = JSON.parse(await readFile(scoreboardPath, 'utf8'));
  assert.equal(Array.isArray(scoreboard.runs), true);
  assert.equal(scoreboard.runs.length, 1);
  assert.equal(scoreboard.runs[0].verdict, 'warn');
});
