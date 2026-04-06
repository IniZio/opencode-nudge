import config from '../nexus-handoff.json' with { type: 'json' };

import { createNexusHandoffPlugin } from '../../packages/opencode-nexus-handoff/index.js';

export const NexusHandoffPlugin = createNexusHandoffPlugin(config);
export default NexusHandoffPlugin;
