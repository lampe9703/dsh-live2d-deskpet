import type { PetConfig } from '../../shared/types.js';
export declare class CompanionService {
    #private;
    private readonly deps;
    constructor(deps: {
        takeScreenshot(): Promise<Buffer | undefined>;
        say(text: string): void;
        log(message: string): void;
    });
    configure(config: PetConfig, mode: () => 'task' | 'companion'): void;
    private tick;
}
//# sourceMappingURL=CompanionService.d.ts.map