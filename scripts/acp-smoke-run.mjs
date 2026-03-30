import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  const projectDir = join(sandboxRoot, 'project');
  const configDir = join(projectDir, '.opencode');

  await mkdir(configDir, { recursive: true });

  const selectedModel = process.env.ACP_MODEL || 'opencode/gpt-5.1-codex-mini';
  const selectedModelID = selectedModel.split('/').slice(1).join('/');
  const pluginSpec =
    process.env.ACP_PLUGIN_SPEC ||
    `file://${join(pluginRepoRoot, '.opencode/plugins/continue-nudge.js')}`;

  await writeFile(
    join(configDir, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        model: selectedModel,
        plugin: [pluginSpec],
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
    if (init?.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);

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
    ];

    const results = [];
    for (const scenario of scenarios) {
      const result = await runScenario({
        request,
        projectDir,
        sandboxRoot,
        allowedModelIDs: [selectedModelID],
        ...scenario,
      });
      results.push(result);
    }

    const summary = results
      .map((result) => `${result.name}:session=${result.sessionId}:markers=${result.markerCount}`)
      .join(' ');
    console.log(`PASS ${summary}`);
  } finally {
    acp.kill('SIGTERM');
    await once(acp, 'exit').catch(() => {});
  }
}

main().catch((error) => {
  console.error(`FAIL ${String(error?.message || error)}`);
  process.exitCode = 1;
});
