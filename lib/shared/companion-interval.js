/**
 * 截屏间隔的取值范围与旧字段迁移（0.1.7）。
 *
 * 0.1.6 及以前用的是 companionIntervalMinutes（分钟，1–180，默认 10）；
 * 0.1.7 起改为 companionIntervalSeconds（秒，10–10800，默认 600）。
 *
 * 为什么迁移要一个"标记文件"而不是改完就完：
 *   - 宿主的 settings 服务只允许写 schema 内的 volatile 字段，旧键已不在
 *     schema 里，unset 会被拒（`Config field ... is not volatile`），所以旧键
 *     会永远留在 patch 文档里、且每轮配置解析都会透传进插件 config
 *     （schemastery 对未知键是 merge 透传的，不丢弃）；
 *   - 而新键有 schema 默认值 600，从解析后的 config 里分不清"用户显式填了
 *     600"还是"根本没填"。如果只按"新键 == 默认值就信旧键"，用户日后显式
 *     把间隔改回 600 秒会被旧键再次覆盖；
 *   - 因此用 `~/.dsh/live2d-deskpet/interval-migrated.json` 做一次性标记：
 *     标记存在后旧键永远不参与计算，语义上等于"旧键已清除"。
 *
 * 依赖约束：本文件会被打进 Electron 主进程与浏览器客户端（经 pet-section），
 * 只允许纯函数、不 import 任何 node 内置模块。
 */

/** 陪伴模式截屏间隔的最小值（秒）。 */
export const INTERVAL_MIN_SECONDS = 10;
/** 陪伴模式截屏间隔的最大值（秒，= 180 分钟，与旧字段的上限对齐）。 */
export const INTERVAL_MAX_SECONDS = 10800;
/** 陪伴模式截屏间隔的默认值（秒，= 旧默认 10 分钟）。 */
export const INTERVAL_DEFAULT_SECONDS = 600;
/** 旧字段名（分钟）。仅用于识别与迁移，schema 里已不存在。 */
export const LEGACY_INTERVAL_FIELD = 'companionIntervalMinutes';

/**
 * 把任意输入夹进 [10, 10800] 秒；非有限数回退默认值 600。
 *
 * 设置页写入、宿主投影（sectionToConfig）、Electron 侧兜底共用这一处，
 * 保证三处报出的数字不会分叉。
 */
export function clampIntervalSeconds(value) {
    const seconds = Math.round(Number(value));
    if (!Number.isFinite(seconds))
        return INTERVAL_DEFAULT_SECONDS;
    return Math.min(INTERVAL_MAX_SECONDS, Math.max(INTERVAL_MIN_SECONDS, seconds));
}

/** 旧分钟值换算成秒（同样夹进范围）；输入不是有限数时返回 undefined。 */
export function legacyMinutesToSeconds(minutes) {
    const value = Math.round(Number(minutes));
    if (!Number.isFinite(value))
        return undefined;
    return clampIntervalSeconds(value * 60);
}

/**
 * 解析"当前生效"的截屏间隔（秒）。
 *
 * 优先级：迁移标记存在 → 只看秒字段；否则秒字段**有显式非默认值**时只看秒字段
 * （显式设置永远压过旧键）；只有当秒字段缺失或只剩 schema 默认值时，才按旧
 * 分钟键换算——"默认值不参与转换"指的是：默认值本身不是换算的输入，它只是
 * "这个字段没被显式设置过"的信号。
 *
 * @param seconds - 新字段当前值（可能是 schema 默认值）。
 * @param legacyMinutes - 旧字段原值（schema 外透传；通常为 undefined）。
 * @param markerPresent - 一次性迁移标记是否存在。
 */
export function resolveIntervalSeconds(seconds, legacyMinutes, markerPresent) {
    const current = Number.isFinite(Number(seconds)) ? clampIntervalSeconds(seconds) : undefined;
    if (markerPresent || !Number.isFinite(Number(legacyMinutes)))
        return current ?? INTERVAL_DEFAULT_SECONDS;
    // 旧键存在但秒字段已有显式非默认值：新键赢，旧键从此让位。
    if (current !== undefined && current !== INTERVAL_DEFAULT_SECONDS)
        return current;
    // 秒字段缺失或只有默认值：视为"只有 companionIntervalMinutes"，按它换算。
    return legacyMinutesToSeconds(legacyMinutes) ?? current ?? INTERVAL_DEFAULT_SECONDS;
}

/**
 * 规划一次性迁移动作。
 *
 * @returns 迁移计划；`null` 表示无需任何动作。
 *   - `patch`：需要写回 settings 的字段（把换算结果持久化成新键）；
 *   - `markerOnly`：只需补写迁移标记（秒字段已被显式设置过，旧键从此作废）；
 *   - `seconds`：本轮解析出的生效间隔（供日志）。
 */
export function planIntervalMigration(seconds, legacyMinutes, markerPresent) {
    if (markerPresent || !Number.isFinite(Number(legacyMinutes)))
        return null;
    const resolved = resolveIntervalSeconds(seconds, legacyMinutes, markerPresent);
    const explicit = Number.isFinite(Number(seconds)) && clampIntervalSeconds(seconds) !== INTERVAL_DEFAULT_SECONDS;
    if (explicit)
        return { patch: null, markerOnly: true, seconds: resolved };
    return { patch: { companionIntervalSeconds: resolved }, markerOnly: false, seconds: resolved };
}
