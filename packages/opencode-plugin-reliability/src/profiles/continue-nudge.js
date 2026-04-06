const NUDGE_MARKER = 'CONTINUE_NUDGE_PLUGIN';

const USER_CORRECTION_PATTERN =
  /\b(not (the )?right direction|wrong direction|that is wrong|stop that|stop|do not continue|don't continue|hold off|pause)\b/i;
const USER_CONTINUE_PATTERN = /\b(continue|keep going|go ahead|proceed|carry on)\b/i;
const PERMISSION_PATTERN =
  /\b(would you like me to|do you want me to|should i|shall i|if you want|next high-value step|next logical step|next concrete step)\b/i;

function toText(value) {
  return String(value ?? '').trim();
}

function toEvent(message) {
  return {
    role: message?.role || message?.info?.role || 'unknown',
    text: toText(message?.text),
    messageId: message?.messageId || message?.info?.id || null,
  };
}

function hasNudgeMarker(text) {
  return text.includes(NUDGE_MARKER);
}

function emptyCounts() {
  return {
    tp: 0,
    fp: 0,
    fn: 0,
    ignored: 0,
  };
}

export const continueNudgeProfile = {
  normalize(raw) {
    if (Array.isArray(raw)) {
      return raw.map(toEvent);
    }

    if (Array.isArray(raw?.messages)) {
      return raw.messages.map((message) => {
        if (typeof message?.text === 'string') {
          return toEvent(message);
        }

        const combinedText = (message?.parts || [])
          .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
          .map((part) => part.text)
          .join('\n')
          .trim();

        return toEvent({
          role: message?.info?.role,
          text: combinedText,
          messageId: message?.info?.id,
        });
      });
    }

    return [];
  },

  label(events) {
    const counts = emptyCounts();
    const reasonCodes = [];

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index] || {};
      const text = toText(event.text);
      const next = events[index + 1] || {};
      const nextText = toText(next.text);

      if (hasNudgeMarker(text)) {
        if (next.role === 'user' && USER_CORRECTION_PATTERN.test(nextText)) {
          counts.fp += 1;
          reasonCodes.push('post_nudge_user_correction');
          continue;
        }

        if (next.role === 'assistant' || !next.role) {
          counts.tp += 1;
          continue;
        }
      }

      if (event.role === 'assistant' && PERMISSION_PATTERN.test(text)) {
        if (!hasNudgeMarker(nextText) && next.role === 'user' && USER_CONTINUE_PATTERN.test(nextText)) {
          counts.fn += 1;
          reasonCodes.push('post_no_nudge_user_prompt_to_continue');
          continue;
        }

        counts.ignored += 1;
      }
    }

    return {
      counts,
      reasonCodes,
    };
  },

  score(labels, context = {}) {
    const counts = labels?.counts || emptyCounts();
    const tp = Number(counts.tp || 0);
    const fp = Number(counts.fp || 0);
    const fn = Number(counts.fn || 0);
    const denominator = Math.max(tp + fp + fn, 1);

    const continuationSuccess = Math.round((tp / denominator) * 100);
    const falsePositiveControl = Math.max(0, 100 - fp * 35);
    const missedContinuationControl = Math.max(0, 100 - fn * 35);
    const hardStopRespect = context.hardStopRespected === false ? 50 : 100;
    const acpSmoke = context.acpSmokePassed === false ? 0 : 100;

    const total = Math.round(
      continuationSuccess * 0.35 +
        falsePositiveControl * 0.25 +
        hardStopRespect * 0.15 +
        acpSmoke * 0.15 +
        missedContinuationControl * 0.1,
    );

    return {
      total,
      components: {
        continuationSuccess,
        falsePositiveControl,
        hardStopRespect,
        acpSmoke,
        missedContinuationControl,
      },
    };
  },

  policy({ labels }) {
    const reasonCodes = labels?.reasonCodes || [];
    if (reasonCodes.includes('post_nudge_user_correction')) {
      return {
        actions: ['reduce_nudge_aggressiveness'],
      };
    }
    if (reasonCodes.includes('post_no_nudge_user_prompt_to_continue')) {
      return {
        actions: ['expand_permission_patterns'],
      };
    }

    return {
      actions: ['keep_current_configuration'],
    };
  },
};
