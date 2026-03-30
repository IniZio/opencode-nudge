import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function main() {
  const pluginRepoRoot = resolve(process.cwd());
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'continue-nudge-acp-'));
  const projectDir = join(sandboxRoot, 'project');
  const configDir = join(projectDir, '.opencode');

  await mkdir(configDir, { recursive: true });

  await writeFile(
    join(configDir, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        model: 'openai/gpt-5.1-codex-mini',
        plugin: [`file://${join(pluginRepoRoot, '.opencode/plugins/continue-nudge.js')}`],
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

    const created = await request('session/new', { cwd: projectDir, mcpServers: [] });
    if (created?.error) throw new Error(`session/new failed: ${JSON.stringify(created.error)}`);
    const sessionId = created?.result?.sessionId;
    if (!sessionId) throw new Error('session/new did not return a sessionId');

    const prompt =
      'First, reply with exactly this single sentence and nothing else: If you want, I can also add tests. ' +
      'Then immediately continue the work in this same session by appending one line `nudge continued` to ACP_OK.txt.';

    const response = await request(
      'session/prompt',
      {
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      },
      300000,
    );
    if (response?.error) throw new Error(`session/prompt failed: ${JSON.stringify(response.error)}`);

    if (response?.result?.stopReason !== 'end_turn') {
      throw new Error(`Unexpected stop reason: ${String(response?.result?.stopReason || 'unknown')}`);
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 8000));

    const exportFile = join(sandboxRoot, 'session-export.json');
    await run('opencode', ['export', sessionId], projectDir).then(({ stdout }) => writeFile(exportFile, stdout));
    const exported = JSON.parse(await readFile(exportFile, 'utf8'));

    const assistantTexts = exported.messages
      .filter((message) => message?.info?.role === 'assistant')
      .map((message) =>
        (message.parts || [])
          .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
          .map((part) => part.text)
          .join('\n')
          .trim(),
      )
      .filter(Boolean);

    const markerCount = exported.messages
      .flatMap((message) => message.parts || [])
      .filter((part) => typeof part?.text === 'string' && part.text.includes('CONTINUE_NUDGE_PLUGIN')).length;

    const waitResult = await waitForFileContains(join(projectDir, 'ACP_OK.txt'), 'nudge continued');
    const continued = waitResult.found;

    if (markerCount < 1) {
      const sample = assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : '<none>';
      throw new Error(`No CONTINUE_NUDGE_PLUGIN marker found in exported session. Last assistant text: ${sample}`);
    }
    if (!continued) {
      const lastAssistant = assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : '<none>';
      throw new Error(`Assistant did not continue work after nudge. Last assistant text: ${lastAssistant}`);
    }

    console.log(`PASS session=${sessionId} markers=${markerCount} file=${join(projectDir, 'ACP_OK.txt')}`);
  } finally {
    acp.kill('SIGTERM');
    await once(acp, 'exit').catch(() => {});
  }
}

main().catch((error) => {
  console.error(`FAIL ${String(error?.message || error)}`);
  process.exitCode = 1;
});
