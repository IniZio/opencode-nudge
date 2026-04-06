import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  classifySoftGate,
  continueNudgeProfile,
  runReliabilitySuite,
  writeRunArtifacts,
} from '../packages/opencode-plugin-reliability/src/index.js';

function parseFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index >= args.length - 1) return null;
  return args[index + 1];
}

async function readOptionalJson(path, fallback) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toEvents(exportPayload) {
  const messages = Array.isArray(exportPayload?.messages) ? exportPayload.messages : [];
  return messages.map((message) => ({
    role: message?.info?.role || 'unknown',
    text: (message?.parts || [])
      .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim(),
    messageId: message?.info?.id || null,
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const exportPath = parseFlag(args, '--export');

  if (!exportPath) {
    process.stderr.write('--export is required\n');
    process.exit(1);
  }

  const resolvedExportPath = resolve(exportPath);
  const rootDir = resolve(parseFlag(args, '--root') || process.cwd());

  const payload = JSON.parse(await readFile(resolvedExportPath, 'utf8'));
  const events = toEvents(payload);

  const run = await runReliabilitySuite({
    profile: continueNudgeProfile,
    inputs: { messages: events },
    context: {
      acpSmokePassed: true,
      hardStopRespected: true,
    },
  });

  const scoreboardPath = resolve(rootDir, '.opencode/reliability/scoreboard.json');
  const scoreboard = await readOptionalJson(scoreboardPath, { activeBaselineRunId: null, runs: [] });
  const baseline =
    scoreboard.activeBaselineRunId && Array.isArray(scoreboard.runs)
      ? scoreboard.runs.find((runEntry) => runEntry.runId === scoreboard.activeBaselineRunId)
      : null;

  const gate = classifySoftGate({
    currentScore: run.score.total,
    baselineScore: baseline?.score,
    acpSmokePassed: true,
  });

  const runId = new Date().toISOString().replace(/[:.]/g, '-');

  const output = await writeRunArtifacts({
    rootDir,
    runId,
    run,
    diff: gate,
    runMeta: {
      profile: 'continue-nudge',
      baselineRunId: scoreboard.activeBaselineRunId || null,
      createdAt: new Date().toISOString(),
    },
  });

  const summary = {
    runId,
    score: run.score.total,
    verdict: gate.verdict,
    reasonCodes: gate.reasonCodes,
    artifactDir: output.runDir,
    scoreboardPath: output.scoreboardPath,
  };

  const latestPath = resolve(rootDir, '.opencode/reliability/latest-run.json');
  await writeFile(latestPath, `${JSON.stringify(summary, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = gate.verdict === 'fail' ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exit(1);
});
