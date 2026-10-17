import type { Context } from '@deepseek-ai/cordis';
import { Config, type PetConfig } from './config.js';
import type { EffectivePetMode } from './shared/types.js';
export declare const name = "live2d-deskpet";
export declare const inject: string[];
export { Config };
export type { PetConfig };
/** Settings namespace this plugin owns in `$DSH_HOME/settings.yaml`. */
export declare const DESKPET_SETTINGS_NAMESPACE = "live2d-deskpet";
/** Remote namespace the settings page's action channel mounts as. */
export declare const DESKPET_REMOTE_NAMESPACE = "live2dDeskpet";
/**
 * DSH entry. The settings namespace `live2d-deskpet` is the single source of
 * truth: committed sections drive the running host live, and the legacy
 * `~/.dsh/live2d-deskpet/settings.json` is migrated once into the user layer.
 */
export declare function apply(ctx: Context, config: PetConfig): void;
/** Public config shape with the secret removed, as `getState` reports it. */
type PublicPetConfig = Omit<PetConfig, 'llm'> & {
    llm: Omit<PetConfig['llm'], 'apiKey'> & {
        apiKey?: undefined;
    };
};
export type { PublicPetConfig };
export type { EffectivePetMode };
//# sourceMappingURL=index.d.ts.map