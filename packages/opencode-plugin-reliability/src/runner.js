import { computeReliabilityScore } from './score/reliability-score.js';

function ensureProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('profile is required');
  }
  if (typeof profile.normalize !== 'function') {
    throw new Error('profile.normalize is required');
  }
  if (typeof profile.label !== 'function') {
    throw new Error('profile.label is required');
  }
  if (typeof profile.score !== 'function') {
    throw new Error('profile.score is required');
  }
}

export async function runReliabilitySuite({ profile, inputs, context = {} }) {
  ensureProfile(profile);

  const events = await profile.normalize(inputs, context);
  const labels = await profile.label(events, context);
  const profileScore = await profile.score(labels, context);
  const score =
    profileScore && typeof profileScore.total === 'number'
      ? profileScore
      : computeReliabilityScore({
          counts: labels?.counts || {},
          acpSmokePassed: Boolean(context.acpSmokePassed),
          hardStopRespected: context.hardStopRespected !== false,
        });

  const policy =
    typeof profile.policy === 'function' ? await profile.policy({ events, labels, score }, context) : null;

  return {
    events,
    labels,
    score,
    policy,
  };
}

export function createReliabilityRunner({ profile, defaultContext = {} }) {
  ensureProfile(profile);
  return {
    async run(inputs, context = {}) {
      return runReliabilitySuite({
        profile,
        inputs,
        context: { ...defaultContext, ...context },
      });
    },
  };
}

export function compareRuns({ current, baseline, thresholds = {} }) {
  const currentScore = Number(current?.total ?? 0);
  const baselineScore = Number(baseline?.total ?? 0);
  const delta = currentScore - baselineScore;

  const strongRegression = Number(thresholds.strongRegression ?? 12);
  const mildRegression = Number(thresholds.mildRegression ?? 1);

  let classification = 'improved_or_equal';
  if (delta <= -strongRegression) {
    classification = 'strong_regression';
  } else if (delta <= -mildRegression) {
    classification = 'mild_regression';
  }

  return {
    baselineScore,
    currentScore,
    delta,
    classification,
  };
}
