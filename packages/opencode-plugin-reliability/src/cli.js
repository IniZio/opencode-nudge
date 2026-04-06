#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import {
  classifySoftGate,
  compareRuns,
  computeReliabilityScore,
  continueNudgeProfile,
  runReliabilitySuite,
} from './index.js';

function parseFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index >= args.length - 1) return null;
  return args[index + 1];
}

function parseNumberFlag(args, flag, fallback = null) {
  const value = parseFlag(args, flag);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${flag} must be a number`);
  }
  return parsed;
}

function usage() {
  return [
    'Usage: opencode-reliability <command> [options]',
    '',
    'Commands:',
    '  run --input <session-export.json> [--profile continue-nudge]',
    '  score --labels <labels.json>',
    '  gate --current <score> --baseline <score> [--acp true|false]',
    '  report --current <score> --baseline <score>',
  ].join('\n');
}

async function cmdRun(args) {
  const profileName = parseFlag(args, '--profile') || 'continue-nudge';
  if (profileName !== 'continue-nudge') {
    throw new Error(`Unknown profile: ${profileName}`);
  }

  const inputPath = parseFlag(args, '--input');
  if (!inputPath) {
    throw new Error('--input is required');
  }

  const raw = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = await runReliabilitySuite({
    profile: continueNudgeProfile,
    inputs: raw,
    context: { acpSmokePassed: true, hardStopRespected: true },
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function cmdScore(args) {
  const labelsPath = parseFlag(args, '--labels');
  if (!labelsPath) {
    throw new Error('--labels is required');
  }

  const labels = JSON.parse(await readFile(labelsPath, 'utf8'));
  const score = computeReliabilityScore({
    counts: labels?.counts || {},
    acpSmokePassed: true,
    hardStopRespected: true,
  });

  process.stdout.write(`${JSON.stringify(score)}\n`);
}

async function cmdGate(args) {
  const currentScore = parseNumberFlag(args, '--current');
  const baselineScore = parseNumberFlag(args, '--baseline');

  if (currentScore == null) {
    throw new Error('--current is required');
  }
  if (baselineScore == null) {
    throw new Error('--baseline is required');
  }

  const acp = (parseFlag(args, '--acp') || 'true').toLowerCase() !== 'false';
  const result = classifySoftGate({
    currentScore,
    baselineScore,
    acpSmokePassed: acp,
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.verdict === 'fail' ? 1 : 0;
}

async function cmdReport(args) {
  const currentScore = parseNumberFlag(args, '--current');
  const baselineScore = parseNumberFlag(args, '--baseline');

  if (currentScore == null) {
    throw new Error('--current is required');
  }
  if (baselineScore == null) {
    throw new Error('--baseline is required');
  }

  const comparison = compareRuns({
    current: { total: currentScore },
    baseline: { total: baselineScore },
  });

  process.stdout.write(
    `${JSON.stringify({
      summary: `score=${comparison.currentScore} baseline=${comparison.baselineScore} delta=${comparison.delta}`,
      classification: comparison.classification,
    })}\n`,
  );
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'run') {
    await cmdRun(args);
    return;
  }

  if (command === 'score') {
    await cmdScore(args);
    return;
  }

  if (command === 'gate') {
    await cmdGate(args);
    return;
  }

  if (command === 'report') {
    await cmdReport(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
