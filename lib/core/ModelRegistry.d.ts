import type { ModelInfo } from '../shared/types.js';
export declare class ModelRegistry {
    readonly root: string;
    constructor(root: string);
    scan(): Promise<ModelInfo[]>;
    importFolder(source: string): Promise<ModelInfo>;
    /**
     * Delete one model's folder. The folder must resolve inside the registry
     * root, so a malformed id can never aim the deletion elsewhere.
     * @param id - the model id `scan()` reported.
     * @throws when no model with that id exists or its folder escapes the root.
     */
    remove(id: string): Promise<void>;
    /**
     * The model's first texture as named by its `.model3.json`, when the file
     * lists one. Informational: consumers decide how to surface it.
     */
    thumbnailOf(model: ModelInfo): Promise<string | undefined>;
    private walk;
    private findModelFiles;
    private info;
}
//# sourceMappingURL=ModelRegistry.d.ts.map