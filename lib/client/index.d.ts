/**
 * Web-half registration point: the Live2D deskpet settings section.
 *
 * The section owns five blocks (model / mode / companion LLM / persona /
 * window). Durable preferences ride the host's `live2d-deskpet` settings
 * namespace through `ctx.settingsScope`; the actions a namespace cannot
 * express (pick a folder, delete a model, probe the LLM endpoint, reveal the
 * model folder) ride the plugin's own Typert Remote namespace.
 *
 * The bundle is emitted as a DSH classic script by `scripts/build-client.mjs`;
 * never hand-edit `lib/client/index.js`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type DeskpetLocaleKey } from './locales.js';
export declare const name = "live2d-deskpet-client";
/**
 * `remote.settings` must be named explicitly, not just `remote`: Cordis resolves
 * a namespaced Remote service only when its own key is declared, and reading an
 * undeclared one throws `cannot get property "remote.settings" without inject`
 * instead of returning undefined. The section writes through that namespace (its
 * only transport that reports a refusal), so omitting the key broke every
 * control in the panel — the click threw before anything was saved.
 */
export declare const inject: string[];
/** Locale namespace this section's copy registers under. */
export declare const DESKPET_LOCALE_NAMESPACE = "settings.live2dDeskpet";
/** Mount the settings section. */
export declare function apply(rawCtx: ClientContext): void;
export type { DeskpetLocaleKey };
//# sourceMappingURL=index.d.ts.map