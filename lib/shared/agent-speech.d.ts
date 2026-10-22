/** Agent 生命周期的五个值（`AgentStateResolver` 的归一化结果）→ 中文。 */
export declare const AGENT_STATE_LABELS: Record<string, string>;
/** 三个任务节点（观察器上报的 `kind`）→ 中文。 */
export declare const AGENT_NODE_LABELS: Record<string, string>;
/** 场景提示段（情绪动作引擎开启时使用，含情绪标记要求）。 */
export declare const AGENT_SPEECH_SCENE: string;
/** 同一段，去掉情绪标记要求（引擎关闭时使用）。 */
export declare const AGENT_SPEECH_SCENE_PLAIN: string;
/**
 * 过滤掉"不是任务信息"的 detail（实现词 / 页脚时间 / 过短），
 * 没有可用信息时返回空串。
 */
export declare function sanitizeAgentDetail(detail?: string | null): string;
/** 组装一次节点发言的 user 消息。 */
export declare function buildAgentPrompt(node: {
    state: string;
    kind: string;
    detail?: string;
    task?: string;
    personaName?: string;
}): string;
