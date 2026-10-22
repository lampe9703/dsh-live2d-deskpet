import type { PetConfig } from '../../shared/types.js';
export declare class AgentSpeechService {
    #private;
    private readonly deps;
    constructor(deps: {
        say(text: string, emotion?: {
            emotion: string;
            intensity: number;
            confidence?: number;
        }): void;
        log?(message: string): void;
        status?(status: {
            stage: string;
            detail: string;
        }): void;
    });
    configure(config: PetConfig, mode: (() => 'task' | 'companion') | string): void;
    speakForNode(node: {
        state: string;
        kind: string;
        detail?: string;
        task?: string;
    }): Promise<boolean>;
}
