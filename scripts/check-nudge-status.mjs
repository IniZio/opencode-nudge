import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} failed\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function exportSessionToFile(sessionId, outputPath, cwd = process.cwd()) {
  if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }

  return run('bash', ['-lc', `opencode export ${sessionId} > ${outputPath}`], cwd);
}

function extractText(parts = []) {
  return parts
    .filter((part) => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function getLatestSessionId(sessionListOutput) {
  const line = sessionListOutput
    .split('\n')
    .map((item) => item.trim())
    .find((item) => /^ses_[A-Za-z0-9]+/.test(item));

  if (!line) return null;
  return line.split(/\s+/)[0];
}

async function main() {
  const requestedSessionId = process.argv[2];

  let sessionId = requestedSessionId;
  if (!sessionId) {
    const listed = await run('opencode', ['session', 'list']);
    sessionId = getLatestSessionId(listed.stdout);
  }

  if (!sessionId) {
    throw new Error('No session id provided and no sessions found via `opencode session list`.');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'opencode-nudge-check-'));
  const exportPath = join(tempDir, 'session-export.json');
  await exportSessionToFile(sessionId, exportPath);

  let data;
  try {
    data = JSON.parse(await readFile(exportPath, 'utf8'));
  } catch (error) {
    const raw = await readFile(exportPath, 'utf8').catch(() => '');
    throw new Error(
      `Failed to parse session export JSON. Try passing an explicit recent session id. parse=${String(
        error?.message || error,
      )} size=${raw.length}`,
    );
  }
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  const markerMessages = [];
  const assistantPermissionLike = [];
  const assistantFinals = [];

  for (const message of messages) {
    const role = message?.info?.role;
    const text = extractText(message?.parts || []);
    if (!text) continue;

    if (role === 'user' && text.includes('CONTINUE_NUDGE_PLUGIN')) {
      markerMessages.push({ id: message?.info?.id, text });
      continue;
    }

    if (role === 'assistant') {
      assistantFinals.push({ id: message?.info?.id, text });
      if (
        /\b(if you want,?\s*(next\s+)?i(?:'|\u2019)?ll|if you want,?\s*(next\s+)?i will|next\s+i can|next\s+high[-\s]?value\s+step:?|would you like me to|should i|natural next steps:?|next logical step:?)/i.test(
          text,
        )
      ) {
        assistantPermissionLike.push({ id: message?.info?.id, text });
      }
    }
  }

  const debugConfig = await run('opencode', ['debug', 'config', '--print-logs', '--log-level', 'INFO']);
  const debugCombined = `${debugConfig.stdout}\n${debugConfig.stderr}`;
  const pluginLoadMentions =
    (debugCombined.match(/opencode-continue-nudge|continue-nudge\.js/gi) || []).length;

  const payload = {
    sessionId: data?.info?.id || sessionId,
    totalMessages: messages.length,
    pluginLikelyLoaded: pluginLoadMentions > 0,
    pluginLoadMentions,
    nudgeMarkers: markerMessages.length,
    permissionLikeAssistantMessages: assistantPermissionLike.length,
    looksWorking: pluginLoadMentions > 0 && markerMessages.length > 0,
    verdict:
      pluginLoadMentions > 0 && markerMessages.length > 0
        ? 'working'
        : pluginLoadMentions > 0
          ? 'not_observed_in_this_session'
          : 'misconfigured_or_not_loaded',
    lastAssistant: assistantFinals.length ? assistantFinals[assistantFinals.length - 1].text : null,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
