import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const SYSTEM_REMINDER_MARKER = 'CONTINUE_NUDGE_SYSTEM_REMINDER';
export const CONTINUATION_NUDGE_MARKER = 'CONTINUE_NUDGE_PLUGIN';
export const DEFAULT_CONFIG_PATH = '.opencode/continue-nudge.json';
export const DEFAULT_PRESET = 'balanced';

const BASE_PERMISSION_SEEKING_PATTERNS = [
  /\bwould you like me to\b/i,
  /\bwould you prefer\b/i,
  /\bdo you want me to\b/i,
  /\bdo you prefer\b/i,
  /\bshould i\b/i,
  /\bshall i\b/i,
  /\blet me know if you(?:'d| would)? like me to\b/i,
  /\bif you(?:'d| would)? like,? i can\b/i,
  /\bi can (?:also|continue|go ahead and)\b/i,
  /\bhappy to (?:continue|help with|do)\b/i,
  /\bwant me to (?:continue|proceed|go ahead)\b/i,
  /\bwant me to\b/i,
  /\bif you want,? i can\b/i,
  /\bif you want,?\s*(?:next\s+)?i(?:'|\u2019)?ll\b/i,
  /\bif you want,?\s*(?:next\s+)?i will\b/i,
  /\bnatural next steps:?\b/i,
  /\bwhat would you like me to\b/i,
  /\bis there any (?:additional|other|specific|particular) (?:constraint|requirement|preference)\b/i,
  /\bany (?:additional|other) constraint\b/i,
  /\bbefore (?:proceeding|continuing|implementing|starting), i(?:'| would like to)? (?:need|want) to\b/i,
  /\bi(?:'| would like to)? (?:need|want) to (?:know|clarify|confirm)\b/i,
];

const CONSERVATIVE_PERMISSION_SEEKING_PATTERNS = [
  /\bwould you like me to\b/i,
  /\bdo you want me to\b/i,
  /\bshould i (?:continue|proceed|go ahead|keep going)\b/i,
  /\bshall i\b/i,
];

const AGGRESSIVE_PERMISSION_SEEKING_PATTERNS = [
  ...BASE_PERMISSION_SEEKING_PATTERNS,
  /\bi can take care of(?: that| this)?\b/i,
  /\bi can update(?: that| this)?\b/i,
  /\bi can patch(?: that| this)?\b/i,
];

const HARD_STOP_PATTERNS = [
  /\b(wait for (?:your|further) instructions)\b/i,
  /\bneed (?:your|more) input\b/i,
  /\bneed approval\b/i,
  /\bmissing credentials\b/i,
  /\bcannot proceed\b/i,
  /\bcan't proceed\b/i,
  /\bam blocked\b/i,
  /\bblocked on\b/i,
];

const USER_OPT_OUT_PATTERNS = [
  /\bask me before\b/i,
  /\bwait for my approval\b/i,
  /\bdo not continue\b/i,
  /\bonly plan\b/i,
  /\bplan only\b/i,
  /\bhold off\b/i,
  /\bpause after\b/i,
];

export const PRESET_OPTIONS = {
  conservative: {
    maxNudgesPerSession: 1,
    permissionSeekingPatterns: CONSERVATIVE_PERMISSION_SEEKING_PATTERNS,
    hardStopPatterns: HARD_STOP_PATTERNS,
    userOptOutPatterns: USER_OPT_OUT_PATTERNS,
  },
  balanced: {
    maxNudgesPerSession: 2,
    permissionSeekingPatterns: BASE_PERMISSION_SEEKING_PATTERNS,
    hardStopPatterns: HARD_STOP_PATTERNS,
    userOptOutPatterns: USER_OPT_OUT_PATTERNS,
  },
  aggressive: {
    maxNudgesPerSession: 3,
    permissionSeekingPatterns: AGGRESSIVE_PERMISSION_SEEKING_PATTERNS,
    hardStopPatterns: HARD_STOP_PATTERNS,
    userOptOutPatterns: USER_OPT_OUT_PATTERNS,
  },
};

const DEFAULT_OPTIONS = {
  preset: DEFAULT_PRESET,
  maxNudgesPerSession: null,
  permissionSeekingPatterns: null,
  hardStopPatterns: null,
  userOptOutPatterns: null,
};

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTextFromParts(parts = []) {
  return normalizeText(
    parts
      .flatMap((part) => {
        if (!part || typeof part !== 'object') return [];
        if (typeof part.text === 'string') return [part.text];
        if (typeof part.content === 'string') return [part.content];
        if (Array.isArray(part.text)) {
          return part.text.filter((item) => typeof item === 'string');
        }
        return [];
      })
      .join('\n'),
  );
}

export function fingerprintText(text) {
  return normalizeText(text).toLowerCase().slice(0, 400);
}

export function compilePattern(value) {
  if (value instanceof RegExp) return value;
  if (typeof value === 'string') return new RegExp(value, 'i');
  if (value && typeof value === 'object' && typeof value.source === 'string') {
    return new RegExp(value.source, value.flags || 'i');
  }
  throw new TypeError(`Unsupported pattern definition: ${JSON.stringify(value)}`);
}

export function compilePatternList(values, fallbackPatterns) {
  if (!Array.isArray(values)) return fallbackPatterns;
  if (values.length === 0) return [];
  return values.map(compilePattern);
}

function testPattern(pattern, text) {
  if (pattern && typeof pattern === 'object') {
    pattern.lastIndex = 0;
  }
  return pattern.test(text);
}

export function resolveContinueNudgeOptions(options = {}) {
  const preset = options.preset || DEFAULT_PRESET;
  const presetOptions = PRESET_OPTIONS[preset];

  if (!presetOptions) {
    throw new Error(`Unknown continue-nudge preset: ${preset}`);
  }

  const hasCustomMaxNudges = Object.prototype.hasOwnProperty.call(options, 'maxNudgesPerSession');
  const maxNudgesPerSession = hasCustomMaxNudges
    ? options.maxNudgesPerSession
    : presetOptions.maxNudgesPerSession;

  const normalizedMaxNudges = maxNudgesPerSession == null ? Number.POSITIVE_INFINITY : maxNudgesPerSession;

  return {
    preset,
    maxNudgesPerSession: normalizedMaxNudges,
    permissionSeekingPatterns: compilePatternList(
      options.permissionSeekingPatterns,
      presetOptions.permissionSeekingPatterns,
    ),
    hardStopPatterns: compilePatternList(options.hardStopPatterns, presetOptions.hardStopPatterns),
    userOptOutPatterns: compilePatternList(options.userOptOutPatterns, presetOptions.userOptOutPatterns),
  };
}

export async function loadContinueNudgeConfig(configPath = DEFAULT_CONFIG_PATH) {
  try {
    const resolvedPath = configPath instanceof URL ? fileURLToPath(configPath) : configPath;
    const raw = await readFile(resolvedPath, 'utf8');
    return resolveContinueNudgeOptions(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return resolveContinueNudgeOptions();
    }
    throw error;
  }
}

export function shouldNudge({
  assistantText,
  latestUserText = '',
  nudgeCount = 0,
  hasSeenMessage = false,
  maxNudgesPerSession = PRESET_OPTIONS[DEFAULT_PRESET].maxNudgesPerSession,
  permissionSeekingPatterns = PRESET_OPTIONS[DEFAULT_PRESET].permissionSeekingPatterns,
  hardStopPatterns = PRESET_OPTIONS[DEFAULT_PRESET].hardStopPatterns,
  userOptOutPatterns = PRESET_OPTIONS[DEFAULT_PRESET].userOptOutPatterns,
}) {
  const normalizedAssistant = normalizeText(assistantText);
  const normalizedUser = normalizeText(latestUserText);

  if (!normalizedAssistant) return false;
  if (nudgeCount >= maxNudgesPerSession) return false;
  if (hasSeenMessage) return false;
  if (userOptOutPatterns.some((pattern) => testPattern(pattern, normalizedUser))) return false;
  if (hardStopPatterns.some((pattern) => testPattern(pattern, normalizedAssistant))) return false;

  return permissionSeekingPatterns.some((pattern) => testPattern(pattern, normalizedAssistant));
}

export function buildSystemReminder() {
  return `${SYSTEM_REMINDER_MARKER}\nYou are running with a continue-nudge safety net. Default to continuing with the next obvious step instead of ending with "permission-seeking" language. Do not stop to ask for approval unless the user explicitly asked you to pause, wait, or ask first, or unless you are genuinely blocked by missing information, permissions, or credentials.`;
}

export function buildContinuationPrompt() {
  return `${CONTINUATION_NUDGE_MARKER}\nContinue working now instead of stopping at an offer or permission check. Pick the next obvious concrete step from your last response and execute it. Only stop after the work is actually complete or you are blocked by a real external constraint.`;
}

export function buildQuestionAutoAnswer() {
  return `${CONTINUATION_NUDGE_MARKER}\nChoose the next obvious option yourself and continue the work without asking me to pick, unless I explicitly told you to decide or you are blocked by a real external constraint.`;
}

function findLastByRole(messages, role) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.info?.role === role) {
      return message;
    }
  }
  return null;
}

async function log(client, level, message, extra = {}) {
  if (!client?.app?.log) return;
  await client.app.log({
    body: {
      service: 'continue-nudge-plugin',
      level,
      message,
      extra,
    },
  });
}

export function createContinueNudgeRuntime(client, options = {}) {
  const config = resolveContinueNudgeOptions(options);
  const sessionsWithErrors = new Set();
  const nudgesBySession = new Map();
  const nudgedFingerprintsBySession = new Map();
  const nudgesInFlightBySession = new Set();
  const answeredQuestionsBySession = new Map();
  const primedSessions = new Set();
  const lastMessageBySession = new Map();

  function getSessionIdFromProperties(properties) {
    return properties?.info?.id ?? properties?.sessionID ?? null;
  }

  function clearSessionCaches(sessionId) {
    if (!sessionId) return;
    sessionsWithErrors.delete(sessionId);
    nudgesBySession.delete(sessionId);
    nudgedFingerprintsBySession.delete(sessionId);
    nudgesInFlightBySession.delete(sessionId);
    answeredQuestionsBySession.delete(sessionId);
    lastMessageBySession.delete(sessionId);
  }

  function clearSessionState(sessionId) {
    if (!sessionId) return;
    clearSessionCaches(sessionId);
    primedSessions.delete(sessionId);
  }

  async function primeSession(sessionId) {
    if (!sessionId || primedSessions.has(sessionId)) return;

    await client.session.prompt({
      path: { id: sessionId },
      body: {
        noReply: true,
        parts: [{ type: 'text', text: buildSystemReminder() }],
      },
    });

    primedSessions.add(sessionId);
    await log(client, 'info', 'Injected continue reminder', { sessionId, preset: config.preset });
  }

  async function nudgeSession(sessionId) {
    if (!sessionId || sessionsWithErrors.has(sessionId) || nudgesInFlightBySession.has(sessionId)) {
      return false;
    }

    nudgesInFlightBySession.add(sessionId);

    try {
      const { data: messages = [] } = await client.session.messages({
        path: { id: sessionId },
      });

      const lastAssistantMessage = findLastByRole(messages, 'assistant');
      if (!lastAssistantMessage) return false;

      const latestUserMessage = findLastByRole(messages, 'user');
      const assistantText = extractTextFromParts(lastAssistantMessage.parts);
      const latestUserText = extractTextFromParts(latestUserMessage?.parts);
      const messageFingerprint = lastAssistantMessage.info?.id || fingerprintText(assistantText);
      const sessionNudgeCount = nudgesBySession.get(sessionId) || 0;
      const seenFingerprints = nudgedFingerprintsBySession.get(sessionId) || new Set();

      if (
        !shouldNudge({
          assistantText,
          latestUserText,
          nudgeCount: sessionNudgeCount,
          hasSeenMessage: seenFingerprints.has(messageFingerprint),
          maxNudgesPerSession: config.maxNudgesPerSession,
          permissionSeekingPatterns: config.permissionSeekingPatterns,
          hardStopPatterns: config.hardStopPatterns,
          userOptOutPatterns: config.userOptOutPatterns,
        })
      ) {
        return false;
      }

      const updatedNudgeCount = sessionNudgeCount + 1;
      seenFingerprints.add(messageFingerprint);
      nudgedFingerprintsBySession.set(sessionId, seenFingerprints);
      nudgesBySession.set(sessionId, updatedNudgeCount);

      await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: buildContinuationPrompt() }],
        },
      });

      await log(client, 'info', 'Sent continuation nudge', {
        sessionId,
        nudgeCount: updatedNudgeCount,
        messageFingerprint,
        preset: config.preset,
      });
      return true;
    } catch (error) {
      await log(client, 'warn', 'Failed to send continuation nudge', {
        sessionId,
        error: String(error?.message || error),
      });
      return false;
    } finally {
      nudgesInFlightBySession.delete(sessionId);
    }
  }

  async function answerQuestion(request) {
    const sessionId = request?.sessionID;
    const requestId = request?.id;
    const questions = Array.isArray(request?.questions) ? request.questions : [];

    if (!sessionId || !requestId || questions.length === 0 || sessionsWithErrors.has(sessionId)) {
      return false;
    }

    const { data: messages = [] } = await client.session.messages({
      path: { id: sessionId },
    });

    const latestUserMessage = findLastByRole(messages, 'user');
    const latestUserText = extractTextFromParts(latestUserMessage?.parts);
    const sessionQuestionIds = answeredQuestionsBySession.get(sessionId) || new Set();

    if (sessionQuestionIds.has(requestId)) return false;

    const questionText = normalizeText(questions.map((question) => question?.question || '').join('\n'));
    const shouldAnswer = shouldNudge({
      assistantText: questionText,
      latestUserText,
      hasSeenMessage: false,
      nudgeCount: 0,
      maxNudgesPerSession: Number.POSITIVE_INFINITY,
      permissionSeekingPatterns: config.permissionSeekingPatterns,
      hardStopPatterns: config.hardStopPatterns,
      userOptOutPatterns: config.userOptOutPatterns,
    });

    if (!shouldAnswer) return false;

    const allAllowCustom = questions.every((question) => question?.custom !== false);

    if (allAllowCustom) {
      await client.question.reply({
        requestID: requestId,
        answers: questions.map(() => [buildQuestionAutoAnswer()]),
      });
      await log(client, 'info', 'Auto-answered continuation question', {
        sessionId,
        requestId,
      });
    } else {
      await client.question.reject({
        requestID: requestId,
      });
      await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: buildContinuationPrompt() }],
        },
      });
      await log(client, 'info', 'Rejected continuation question and sent nudge', {
        sessionId,
        requestId,
      });
    }

    sessionQuestionIds.add(requestId);
    answeredQuestionsBySession.set(sessionId, sessionQuestionIds);
    return true;
  }

  return {
    async event({ event }) {
      if (!event?.type) return;

      if (event.type === 'session.error') {
        const sessionId = getSessionIdFromProperties(event.properties);
        if (sessionId) sessionsWithErrors.add(sessionId);
        return;
      }

      if (event.type === 'session.updated') {
        const sessionId = getSessionIdFromProperties(event.properties);
        if (sessionId) {
          sessionsWithErrors.delete(sessionId);
          await nudgeSession(sessionId);
        }
        return;
      }

    if (event.type === 'session.deleted') {
      const sessionId = getSessionIdFromProperties(event.properties);
      if (!sessionId) return;
      clearSessionState(sessionId);
      return;
    }

    if (event.type === 'session.created') {
      const sessionId = getSessionIdFromProperties(event.properties);
      if (sessionId && sessionsWithErrors.has(sessionId)) {
        clearSessionState(sessionId);
      }
      await primeSession(sessionId);
      return;
    }

      if (event.type === 'session.idle' || event.type === 'session.completed') {
        const sessionId = getSessionIdFromProperties(event.properties);
        await nudgeSession(sessionId);
        return;
      }

      if (event.type === 'question.asked') {
        await answerQuestion(event.properties);
      }
    },
    _debug: {
      config,
      sessionsWithErrors,
      nudgesBySession,
      nudgedFingerprintsBySession,
      nudgesInFlightBySession,
      answeredQuestionsBySession,
      primedSessions,
      lastMessageBySession,
      primeSession,
      nudgeSession,
      answerQuestion,
    },
  };
}

export function createContinueNudgePlugin(options = {}) {
  return async ({ client }) => createContinueNudgeRuntime(client, options);
}

export const ContinueNudgePlugin = createContinueNudgePlugin();
