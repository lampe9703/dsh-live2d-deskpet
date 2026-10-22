/**
 * 从 DSH 的 `session/event` 里抠出「用户这一回合让他做什么」。
 *
 * 为什么需要它：任务节点播报一直缺的正是这一条。`start` 的 detail 恒为空、
 * `done` 的 detail 是页脚时间，模型手里只有"某个阶段到了"，只能用人设腔凑一句
 * 泛泛的话。把用户的原话（截短）给它，它才能说出"那个颜色的事我看着呢"。
 *
 * 载荷结构（从 DSH 的 `app.asar` 核实）：
 *   session.append("user/message", message)  ← message 来自 createUserMessage()
 *   message = { id, content: ContentBlock[], source: { kind: "user" } }
 *   ContentBlock = { type: "text", text } | { type: "image" } | { type: "resource_link" }
 *
 * 只取 `type === "text"` 的块；图片/附件不带文字，跳过。
 *
 * 依赖约束：纯函数、零 import（会被打进浏览器 bundle 与主进程两侧）。
 */

/** 截断长度：够说清"在做什么"，又不会把长提示词整段塞进陪伴的提示词里。 */
export const TASK_TEXT_MAX_CHARS = 60;

/** 压平空白 + 截断。 */
export function sanitizeTaskText(text) {
    const flat = String(text ?? '').replace(/\s+/gu, ' ').trim();
    if (flat === '')
        return '';
    return flat.length > TASK_TEXT_MAX_CHARS ? `${flat.slice(0, TASK_TEXT_MAX_CHARS)}…` : flat;
}

/**
 * @param event - `session/event` 的第二个参数（`{ type, data }`）
 * @returns 用户这一回合的请求文本（已压平、截断）；不是用户消息时返回空串
 */
export function extractUserPromptText(event) {
    if (!event || event.type !== 'user/message')
        return '';
    const data = event.data;
    if (!data || typeof data !== 'object')
        return '';
    // 同一会话里还有 runtime-context / agent-instructions 这类"系统塞进去的用户消息"，
    // 它们不是用户打的字。只排除**明确不是 user** 的 kind，缺字段时按用户消息处理
    // （DSH 改结构时不至于整条失效）。
    const kind = data.source?.kind;
    if (typeof kind === 'string' && kind !== 'user')
        return '';
    const content = data.content;
    const parts = [];
    if (typeof content === 'string') {
        parts.push(content);
    }
    else if (Array.isArray(content)) {
        for (const block of content) {
            if (typeof block === 'string') {
                parts.push(block);
            }
            else if (block && typeof block === 'object' && typeof block.text === 'string') {
                // 没写 type 的块也收（结构演进时的兜底），写了就必须是 text。
                if (block.type === undefined || block.type === 'text')
                    parts.push(block.text);
            }
        }
    }
    return sanitizeTaskText(parts.join(' '));
}
