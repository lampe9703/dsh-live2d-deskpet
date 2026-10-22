/**
 * 「现在算哪个模式」的判定（0.2.2）。
 *
 * 抽成纯函数是因为它是这次改动的核心规则，必须能被单测直接断言——
 * 它埋在 `main.js` 里的话，只能靠"看代码觉得对"。
 *
 * 依赖约束：纯函数、零依赖（不碰 electron、不碰时间以外的全局）。
 */

/** agent 正在跑的两种状态，与宿主侧 `agentBusy` 同一组。 */
export const BUSY_AGENT_STATES = new Set(['working', 'think']);

/**
 * 尾巴长度：最后一次活跃之后这么久之内，仍然算「在用 agent」。
 *
 * agent 干活是一阵一阵的——工具调用之间、模型出字之间都有几秒空档。只看瞬时
 * 状态的话，截图会从这些缝里钻进来；90 秒足够吃掉正常间隙，又不会让"任务结束
 * 之后很久还当她在忙"。
 */
export const AGENT_ACTIVE_TAIL_MS = 90_000;

/**
 * 现在算不算「在用 agent」：活跃中，或者刚活跃过（尾巴内）。
 * @param state - 归一化后的 agent 状态
 * @param lastActiveAt - 最近一次进入 working/think 的时刻；0 表示从未活跃过
 * @param now - 当前时刻（注入，便于测试）
 * @param tailMs - 尾巴长度
 */
export function isAgentActive(state, lastActiveAt, now = Date.now(), tailMs = AGENT_ACTIVE_TAIL_MS) {
    if (BUSY_AGENT_STATES.has(state))
        return true;
    return lastActiveAt !== 0 && now - lastActiveAt < tailMs;
}

/**
 * 解析当前生效模式。
 *
 * 显式选择永远优先——选什么就是什么，自动判断只负责 `auto`。
 *
 * `auto` 的优先级（0.2.3 起）：
 *   1. agent 在跑（或刚跑过）→ task。这条最可靠，不依赖任何外部探测。
 *   2. 页面报告"我有焦点" → task。用户就在 DSH 页面前面，不该截屏打扰。
 *   3. 页面明确报告"我失去焦点了" → companion。页面自己说的最权威，不再问窗口。
 *   4. 从没收到过页面报告（页面没开 / 老客户端）→ 退回窗口探测。
 *
 * 第 2、3 条是 0.2.3 加的：原来的窗口探测问的是"DSH 窗口有没有被钉在顶层"，
 * 那既不是"是否在前台"（普通前台窗口不是 topmost），在原生模块没编译的机器上
 * 还会永远返回 false——于是 agent 一闲下来就判成截图驱动，边看代码边被搭话。
 *
 * @param configured - 用户在设置里选的模式：auto / task / companion
 * @param agentActive - `isAgentActive()` 的结果
 * @param pageFocused - 页面自报的焦点状态：true / false / null（没收到过）
 * @param dshOnTop - DSH 窗口是否在前台或置顶（`DshModeProbe` 的结果）
 */
export function resolveMode(configured, agentActive, pageFocused = null, dshOnTop = false) {
    if (configured === 'task' || configured === 'companion')
        return configured;
    if (agentActive)
        return 'task';
    if (pageFocused === true)
        return 'task';
    if (pageFocused === false)
        return 'companion';
    return dshOnTop ? 'task' : 'companion';
}
