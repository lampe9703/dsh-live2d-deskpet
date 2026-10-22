/** agent 正在跑的两种状态。 */
export declare const BUSY_AGENT_STATES: Set<string>;
/** 尾巴长度：最后一次活跃之后这么久之内仍然算「在用 agent」。 */
export declare const AGENT_ACTIVE_TAIL_MS: number;
/** 现在算不算「在用 agent」：活跃中，或刚活跃过（尾巴内）。 */
export declare function isAgentActive(state: string, lastActiveAt: number, now?: number, tailMs?: number): boolean;
/**
 * 解析当前生效模式；显式选择优先。
 * `auto`：agent 活跃 → task；页面有焦点 → task；页面明确失去焦点 → companion；
 * 从没收到过页面报告（null）才退回窗口探测。
 */
export declare function resolveMode(configured: string, agentActive: boolean, pageFocused?: boolean | null, dshOnTop?: boolean): 'task' | 'companion';
