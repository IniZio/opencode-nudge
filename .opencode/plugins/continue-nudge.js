import {
  createContinueNudgePlugin,
  loadContinueNudgeConfig,
} from '../../src/continue-nudge-plugin.js';

export const ContinueNudgePlugin = async (context) => {
  const options = await loadContinueNudgeConfig(new URL('../continue-nudge.json', import.meta.url));
  return createContinueNudgePlugin(options)(context);
};
