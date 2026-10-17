import { EventEmitter } from 'node:events';
import type { AgentState } from '../shared/types.js';
/** Keeps raw Harness event names isolated from the desktop transport. */
export declare class AgentStateResolver extends EventEmitter {
    #private;
    get state(): AgentState;
    set(next: AgentState): void;
    consume(event: unknown): void;
}
//# sourceMappingURL=AgentStateResolver.d.ts.map