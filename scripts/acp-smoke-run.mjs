import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function makeRequestDriver(child) {
  let nextId = 0;
  const pending = new Map();
  let stdoutBuffer = '';

  const notifications = [];

  function handleMessage(message) {
    if (typeof message?.id !== 'undefined' && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      entry.resolve(message);
      return;
    }
    notifications.push(message);
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let lineBreakIndex;

    while ((lineBreakIndex = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, lineBreakIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(lineBreakIndex + 1);

      if (!line.startsWith('{')) continue;

      try {
        handleMessage(JSON.parse(line));
      } catch {
        // Ignore non-JSON lines.
      }
    }
  });

  async function request(method, params, timeoutMs = 300000) {
    const id = nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);

    return await new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolveRequest(message);
        },
      });
    });
  }

  return { request, notifications };
}

async function run(command, args, cwd) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));

    child.on('error', rejectRun);
    child.on('exit', (code) => {
      if (code !== 0) {
        rejectRun(new Error(`${command} ${args.join(' ')} failed: ${stderr.join('')}`));
        return;
      }
      resolveRun({ stdout: stdout.join(''), stderr: stderr.join('') });
    });
  });
}

async function waitForFileContains(path, expectedText, timeoutMs = 45000, intervalMs = 2000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const content = await readFile(path, 'utf8');
      if (content.includes(expectedText)) {
        return { found: true, content };
      }
    } catch {
      // File may not exist yet.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }

  return { found: false, content: '' };
}

async function assertReliabilityArtifacts(projectDir, label) {
  const reliabilityDir = join(projectDir, '.opencode', 'reliability');
  const scoreboardPath = join(reliabilityDir, 'scoreboard.json');

  await stat(scoreboardPath).catch(() => {
    throw new Error(`[${label}] Missing reliability scoreboard at ${scoreboardPath}`);
  });

  const scoreboard = JSON.parse(await readFile(scoreboardPath, 'utf8'));
  const runs = Array.isArray(scoreboard?.runs) ? scoreboard.runs : [];
  if (runs.length === 0) {
    throw new Error(`[${label}] Reliability scoreboard has no runs`);
  }

  const latest = runs[runs.length - 1] || {};
  if (typeof latest.verdict !== 'string' || latest.verdict.length === 0) {
    throw new Error(`[${label}] Latest reliability run is missing verdict`);
  }
  if (!Array.isArray(latest.reasonCodes) || latest.reasonCodes.length === 0) {
    throw new Error(`[${label}] Latest reliability run is missing reason codes`);
  }

  const runsDir = join(reliabilityDir, 'runs');
  const runIds = await readdir(runsDir).catch(() => []);
  if (runIds.length === 0) {
    throw new Error(`[${label}] Reliability run artifacts directory is empty`);
  }

  return {
    scoreboardPath,
    latestVerdict: latest.verdict,
    latestReasonCodes: latest.reasonCodes,
    runCount: runs.length,
  };
}

function collectAssistantTexts(exported) {
  return exported.messages
    .filter((message) => message?.info?.role === 'assistant')
    .map((message) =>
      (message.parts || [])
        .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

function collectMarkerCount(exported) {
  return exported.messages
    .flatMap((message) => message.parts || [])
    .filter((part) => typeof part?.text === 'string' && part.text.includes('CONTINUE_NUDGE_PLUGIN')).length;
}

async function runScenario({
  request,
  projectDir,
  sandboxRoot,
  name,
  triggerSentence,
  shouldExpectNudge,
  allowedModelIDs,
}) {
  const created = await request('session/new', { cwd: projectDir, mcpServers: [] });
  if (created?.error) throw new Error(`[${name}] session/new failed: ${JSON.stringify(created.error)}`);
  const sessionId = created?.result?.sessionId;
  if (!sessionId) throw new Error(`[${name}] session/new did not return a sessionId`);

  const prompt =
    `First, reply with exactly this single sentence and nothing else: ${triggerSentence} ` +
    'Then immediately continue the work in this same session by appending one line `nudge continued` to ACP_OK.txt.';

  const response = await request(
    'session/prompt',
    {
      sessionId,
      prompt: [{ type: 'text', text: prompt }],
    },
    300000,
  );
  if (response?.error) throw new Error(`[${name}] session/prompt failed: ${JSON.stringify(response.error)}`);

  if (response?.result?.stopReason !== 'end_turn') {
    throw new Error(`[${name}] Unexpected stop reason: ${String(response?.result?.stopReason || 'unknown')}`);
  }

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 8000));

  const outputFile = join(projectDir, 'ACP_OK.txt');
  const waitResult = await waitForFileContains(outputFile, 'nudge continued');

  const exportFile = join(sandboxRoot, `session-export-${name}.json`);
  await run('opencode', ['export', sessionId], projectDir).then(({ stdout }) => writeFile(exportFile, stdout));
  const exported = JSON.parse(await readFile(exportFile, 'utf8'));

  const assistantMessages = (exported.messages || []).filter(
    (message) => message?.info?.role === 'assistant',
  );
  const assistantTexts = collectAssistantTexts(exported);
  const markerCount = collectMarkerCount(exported);

  const modelErrors = assistantMessages
    .map((message) => ({
      messageId: message?.info?.id,
      modelID: message?.info?.modelID,
      providerID: message?.info?.providerID,
      errorMessage: message?.info?.error?.data?.message || message?.info?.error?.message || '',
    }))
    .filter((item) => item.errorMessage);

  if (modelErrors.length > 0) {
    throw new Error(
      `[${name}] Assistant returned model errors: ${modelErrors
        .map(
          (item) =>
            `${item.modelID || 'unknown-model'}:${item.errorMessage || 'unknown-error'} (message=${item.messageId || 'unknown'})`,
        )
        .join('; ')}`,
    );
  }

  if (Array.isArray(allowedModelIDs) && allowedModelIDs.length > 0) {
    const unexpectedModel = assistantMessages.find(
      (message) => message?.info?.modelID && !allowedModelIDs.includes(message.info.modelID),
    );
    if (unexpectedModel) {
      throw new Error(
        `[${name}] Unexpected assistant modelID=${unexpectedModel.info.modelID}. Allowed: ${allowedModelIDs.join(', ')}`,
      );
    }
  }

  if (shouldExpectNudge && markerCount < 1) {
    const sample = assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : '<none>';
    throw new Error(`[${name}] No CONTINUE_NUDGE_PLUGIN marker found. Last assistant text: ${sample}`);
  }

  if (!shouldExpectNudge && markerCount > 0) {
    const sample = assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : '<none>';
    throw new Error(`[${name}] Unexpected CONTINUE_NUDGE_PLUGIN marker for non-nudge scenario. Last assistant text: ${sample}`);
  }

  if (!waitResult.found) {
    const lastAssistant = assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : '<none>';
    throw new Error(`[${name}] Assistant did not continue work after prompt. Last assistant text: ${lastAssistant}`);
  }

  await rm(outputFile, { force: true });

  return {
    name,
    sessionId,
    markerCount,
  };
}

async function main() {
  const pluginRepoRoot = resolve(process.cwd());
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'continue-nudge-acp-'));

  const selectedModel = process.env.ACP_MODEL || 'github-copilot/gpt-5.3-codex';
  const selectedModelID = selectedModel.split('/').slice(1).join('/');
  const localPackagePluginSpec =
    process.env.ACP_PLUGIN_SPEC_LOCAL ||
    `file://${join(pluginRepoRoot, 'packages/opencode-continue-nudge/.opencode/plugins/continue-nudge.js')}`;
  const gitPluginSpec =
    process.env.ACP_PLUGIN_SPEC_GIT ||
    'opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git';

  const pluginSpecs = process.env.ACP_PLUGIN_SPEC
    ? [{ label: 'custom', spec: process.env.ACP_PLUGIN_SPEC }]
    : [
        { label: 'local-package', spec: localPackagePluginSpec },
        { label: 'git-install', spec: gitPluginSpec },
      ];

  const scenarios = [
    {
      name: 'explicit-offer',
      triggerSentence: 'If you want, I can also add tests.',
      shouldExpectNudge: true,
    },
    {
      name: 'next-high-value-step',
      triggerSentence: 'Next high-value step: add regression coverage for permission-seeking outputs.',
      shouldExpectNudge: true,
    },
    {
      name: 'next-concrete-step',
      triggerSentence: 'Next concrete step I can do now: add regression coverage for permission-seeking outputs.',
      shouldExpectNudge: true,
    },
    {
      name: 'ill-continue-with',
      triggerSentence: "I'll continue with regression coverage now.",
      shouldExpectNudge: true,
    },
    {
      name: 'hard-stop',
      triggerSentence: 'Cannot proceed because credentials are missing.',
      shouldExpectNudge: false,
    },
  ];

  const suiteResults = [];
  for (let index = 0; index < pluginSpecs.length; index += 1) {
    const target = pluginSpecs[index];
    const suiteName = `${index + 1}-${target.label}`;
    const projectDir = join(sandboxRoot, `project-${suiteName}`);
    const configDir = join(projectDir, '.opencode');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(configDir, 'opencode.json'),
      JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          model: selectedModel,
          plugin: [target.spec],
        },
        null,
        2,
      ),
    );

    const acp = spawn('opencode', ['acp'], { cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const { request } = makeRequestDriver(acp);

    try {
      const init = await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        clientInfo: { name: 'continue-nudge-smoke-test', title: 'Continue Nudge Smoke Test', version: '1.0.0' },
      });
      if (init?.error) {
        throw new Error(`[${target.label}] initialize failed: ${JSON.stringify(init.error)}`);
      }

      const results = [];
      for (const scenario of scenarios) {
        const result = await runScenario({
          request,
          projectDir,
          sandboxRoot,
          name: `${suiteName}-${scenario.name}`,
          allowedModelIDs: [selectedModelID],
          ...scenario,
        });
        results.push(result);
      }

      const artifacts = await assertReliabilityArtifacts(projectDir, target.label);

      suiteResults.push({
        label: target.label,
        pluginSpec: target.spec,
        scenarios: results,
        artifacts,
      });
    } finally {
      acp.kill('SIGTERM');
      await once(acp, 'exit').catch(() => {});
    }
  }

  const summary = suiteResults
    .map((suite) => {
      const markerSummary = suite.scenarios
        .map((scenario) => `${scenario.name}:${scenario.markerCount}`)
        .join(',');
      return `${suite.label}[${markerSummary}] verdict=${suite.artifacts.latestVerdict} reasons=${suite.artifacts.latestReasonCodes.join('+')}`;
    })
    .join(' ');

  console.log(`PASS ${summary}`);
}

main().catch((error) => {
  console.error(`FAIL ${String(error?.message || error)}`);
  process.exitCode = 1;
});
