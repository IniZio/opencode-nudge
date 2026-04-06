import test from 'node:test';
import assert from 'node:assert/strict';

import { continueNudgeProfile } from '../src/index.js';

test('labels post_nudge_user_correction as strong false positive', () => {
  const labels = continueNudgeProfile.label([
    { role: 'assistant', text: 'Would you like me to keep going?', messageId: 'a1' },
    { role: 'user', text: 'CONTINUE_NUDGE_PLUGIN Continue now', messageId: 'u-plugin' },
    { role: 'user', text: 'Not the right direction. Stop that.', messageId: 'u1' },
  ]);

  assert.equal(labels.reasonCodes.includes('post_nudge_user_correction'), true);
  assert.equal(labels.counts.fp >= 1, true);
});

test('labels post_no_nudge_user_prompt_to_continue as strong false negative', () => {
  const labels = continueNudgeProfile.label([
    { role: 'assistant', text: 'I can also add tests if you want.', messageId: 'a1' },
    { role: 'user', text: 'continue', messageId: 'u1' },
  ]);

  assert.equal(labels.reasonCodes.includes('post_no_nudge_user_prompt_to_continue'), true);
  assert.equal(labels.counts.fn >= 1, true);
});

test('normalize extracts role, text, and id from exported message format', () => {
  const events = continueNudgeProfile.normalize({
    messages: [
      {
        info: { id: 'm1', role: 'assistant' },
        parts: [{ type: 'text', text: 'Would you like me to continue?' }],
      },
    ],
  });

  assert.deepEqual(events, [
    {
      role: 'assistant',
      text: 'Would you like me to continue?',
      messageId: 'm1',
    },
  ]);
});
