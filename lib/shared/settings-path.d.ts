/**
 * Settings field paths, deliberately free of any dependency.
 *
 * `SettingsScope.set(field, value)` is a TOP-LEVEL scalar setter: it forwards
 * `path: [field]` to the host, so a dotted reference such as `llm.apiKey` is
 * stored as one literal key named `"llm.apiKey"` instead of the nested
 * `llm: { apiKey }`. The schema defines no such field, so the value is never
 * read back — the field looks like it silently refuses to save.
 *
 * Every dotted reference is therefore split into segments before it reaches the
 * scope, and rows written through the old shape are repaired on startup (see
 * `repairFlattenedKeys` in the plugin entry).
 */
/** Split a dotted field reference, or copy a path that is already segmented. */
export declare function parseFieldPath(field: string | readonly string[]): string[];
/**
 * Whether a stored user-layer key is a flattened dotted path rather than a real
 * field name. Schema fields never contain a dot, so this identifies the damage
 * the old `set()` call shape left behind.
 */
export declare function isFlattenedPathKey(key: string): boolean;
/**
 * The stored value a flattened key should move to, when the real field is still
 * empty. Returns `undefined` when the nested field already carries a value, so a
 * repair never overwrites a later, deliberate edit.
 * @param stored - the namespace's stored user layer.
 * @param key - the flattened key found in that layer.
 * @returns the value to write at the nested path, or `undefined` to skip.
 */
export declare function flattenedKeyRepairValue(stored: Record<string, unknown>, key: string): unknown | undefined;
//# sourceMappingURL=settings-path.d.ts.map