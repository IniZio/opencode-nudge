import config from '../nexus-handoff.json' with { type: 'json' };

import { createNexusHandoffPlugin } from '../../index.js';

export const NexusHandoffPlugin = createNexusHandoffPlugin(config);
export default NexusHandoffPlugin;
