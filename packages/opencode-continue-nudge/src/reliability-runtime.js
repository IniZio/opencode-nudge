import { resolve, sep } from 'node:path';

import {
  classifySoftGate,
  continueNudgeProfile,
  runReliabilitySuite,
  writeRunArtifacts,
} from '../../opencode-plugin-reliability/src/index.js';

const DEFAULT_ARTIFACT_ROOT = '.opencode/reliability';

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

function resolveProjectRoot(rootDir, artifactRoot) {
  const projectRoot = resolve(rootDir || process.cwd());
  const fullArtifactRoot = resolve(projectRoot, artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const suffix = `${sep}.opencode${sep}reliability`;

  if (fullArtifactRoot.endsWith(suffix)) {
    const candidate = fullArtifactRoot.slice(0, -suffix.length);
    return candidate || projectRoot;
  }

  return projectRoot;
}

export function resolveReliabilityRuntimeOptions(input = {}) {
  const options = input && typeof input === 'object' ? input : {};

  return {
    enabled: options.enabled === true,
    mode: options.mode === 'enforce' ? 'enforce' : 'shadow',
    artifactRoot:
      typeof options.artifactRoot === 'string' && options.artifactRoot.trim()
        ? options.artifactRoot
        : DEFAULT_ARTIFACT_ROOT,
    flushOnSessionEnd: options.flushOnSessionEnd !== false,
    strongRegressionThreshold: toPositiveInteger(options.strongRegressionThreshold, 12),
    mildRegressionThreshold: toPositiveInteger(options.mildRegressionThreshold, 1),
  };
}

export function createReliabilityRuntime({
  options = {},
  rootDir = process.cwd(),
  profile = continueNudgeProfile,
  scorer = runReliabilitySuite,
  writer = writeRunArtifacts,
  gate = classifySoftGate,
  now = () => new Date(),
} = {}) {
  const config = resolveReliabilityRuntimeOptions(options);
  const sessionState = new Map();

  function getSessionState(sessionId) {
    const key = sessionId || 'unknown-session';
    let state = sessionState.get(key);
    if (!state) {
      state = {
        lastRunId: null,
        lastScore: Number.NaN,
        policyBlock: false,
      };
      sessionState.set(key, state);
    }
    return state;
  }

  async function evaluateNudgeDecision({ sessionId, shouldNudge, events = [], context = {} }) {
    const desired = Boolean(shouldNudge);
    if (!desired) {
      return { shouldNudge: false, reason: 'nudge_not_requested' };
    }

    if (!config.enabled || config.mode !== 'enforce') {
      return { shouldNudge: desired, reason: 'shadow_or_disabled' };
    }

    const state = getSessionState(sessionId);
    if (state.policyBlock) {
      return { shouldNudge: false, reason: 'policy_blocked_session' };
    }

    try {
      const run = await scorer({
        profile,
        inputs: { messages: events },
        context,
      });

      const actions = run?.policy?.actions || [];
      if (actions.includes('reduce_nudge_aggressiveness')) {
        state.policyBlock = true;
        return { shouldNudge: false, reason: 'reduce_nudge_aggressiveness' };
      }

      return { shouldNudge: desired, reason: 'enforce_allowed' };
    } catch {
      return { shouldNudge: desired, reason: 'enforce_fallback_to_shadow' };
    }
  }

  async function flushSession({ sessionId, events = [], context = {}, runMeta = {} }) {
    if (!config.enabled) {
      return { wroteArtifacts: false, reason: 'disabled' };
    }

    if (!Array.isArray(events) || events.length === 0) {
      return { wroteArtifacts: false, reason: 'no_events' };
    }

    const state = getSessionState(sessionId);

    try {
      const run = await scorer({
        profile,
        inputs: { messages: events },
        context,
      });

      const diff = gate({
        currentScore: Number(run?.score?.total ?? 0),
        baselineScore: Number.isFinite(state.lastScore) ? state.lastScore : Number.NaN,
        acpSmokePassed: context.acpSmokePassed !== false,
        strongRegressionThreshold: config.strongRegressionThreshold,
        mildRegressionThreshold: config.mildRegressionThreshold,
      });

      const createdAt = now().toISOString();
      const safeSessionId = sessionId || 'unknown-session';
      const runId = `${createdAt.replace(/[:.]/g, '-')}-${safeSessionId}`;
      const projectRoot = resolveProjectRoot(rootDir, config.artifactRoot);

      const writeResult = await writer({
        rootDir: projectRoot,
        runId,
        run,
        diff,
        runMeta: {
          profile: 'continue-nudge',
          createdAt,
          baselineRunId: state.lastRunId,
          ...runMeta,
        },
      });

      state.lastRunId = runId;
      state.lastScore = Number(run?.score?.total ?? Number.NaN);
      state.policyBlock = (run?.policy?.actions || []).includes('reduce_nudge_aggressiveness');

      return {
        wroteArtifacts: true,
        verdict: diff?.verdict || 'unknown',
        reasonCodes: diff?.reasonCodes || [],
        runId,
        runDir: writeResult?.runDir || null,
        scoreboardPath: writeResult?.scoreboardPath || null,
      };
    } catch (error) {
      return {
        wroteArtifacts: false,
        reason: 'flush_error',
        error: String(error?.message || error),
      };
    }
  }

  function clearSession(sessionId) {
    if (!sessionId) return;
    sessionState.delete(sessionId);
  }

  return {
    config,
    evaluateNudgeDecision,
    flushSession,
    clearSession,
    _debug: {
      sessionState,
    },
  };
}
