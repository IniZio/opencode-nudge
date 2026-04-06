import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function readJson(path, fallbackValue) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toJsonl(items) {
  return `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
}

export async function writeRunArtifacts({
  rootDir,
  runId,
  run,
  diff,
  runMeta = {},
}) {
  const baseDir = join(rootDir, '.opencode', 'reliability');
  const runDir = join(baseDir, 'runs', runId);
  const scoreboardPath = join(baseDir, 'scoreboard.json');

  await mkdir(runDir, { recursive: true });

  await writeFile(
    join(runDir, 'run.json'),
    toJson({
      runId,
      profile: runMeta.profile || null,
      createdAt: runMeta.createdAt || new Date().toISOString(),
      baselineRunId: runMeta.baselineRunId || null,
      commitSha: runMeta.commitSha || null,
      thresholds: runMeta.thresholds || null,
      environment: runMeta.environment || null,
    }),
  );

  await writeFile(join(runDir, 'events.jsonl'), toJsonl(run.events || []));
  await writeFile(join(runDir, 'labels.json'), toJson(run.labels || {}));
  await writeFile(join(runDir, 'scores.json'), toJson(run.score || {}));
  await writeFile(join(runDir, 'diff-vs-baseline.json'), toJson(diff || {}));
  await writeFile(
    join(runDir, 'report.md'),
    `# Reliability Report\n\n- Run ID: ${runId}\n- Score: ${run?.score?.total ?? 'n/a'}\n- Gate: ${diff?.verdict ?? 'n/a'}\n- Delta vs baseline: ${diff?.delta ?? 'n/a'}\n`,
  );

  const scoreboard = await readJson(scoreboardPath, {
    runs: [],
    activeBaselineRunId: null,
    bestStableRunId: null,
    recentReasons: [],
  });

  const entry = {
    runId,
    score: run?.score?.total ?? null,
    verdict: diff?.verdict || 'unknown',
    delta: diff?.delta ?? null,
    reasonCodes: diff?.reasonCodes || [],
    createdAt: runMeta.createdAt || new Date().toISOString(),
  };

  scoreboard.runs.push(entry);
  scoreboard.recentReasons = [
    ...new Set([
      ...(scoreboard.recentReasons || []),
      ...entry.reasonCodes,
    ]),
  ].slice(-10);

  if (!scoreboard.activeBaselineRunId && entry.verdict !== 'fail') {
    scoreboard.activeBaselineRunId = runId;
  }

  const bestStable = [...scoreboard.runs]
    .filter((item) => item.verdict === 'pass' || item.verdict === 'warn')
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

  scoreboard.bestStableRunId = bestStable?.runId || scoreboard.bestStableRunId || null;

  await mkdir(dirname(scoreboardPath), { recursive: true });
  await writeFile(scoreboardPath, toJson(scoreboard));

  return {
    runDir,
    scoreboardPath,
  };
}
