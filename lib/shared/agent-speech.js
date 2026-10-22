/**
 * Agent 模式（Agent驱动）的发言素材：状态中文表、场景提示段、user 消息组装。
 *
 * 与 `task-voice.js` 的分工：那个文件是**没有 LLM 时**的固定文案（系统替桌宠播报），
 * 这个文件是**有 LLM 时**交给模型的话术脚手架——同一批节点，两种来源，下游都走
 * `deps.say(text, emotion)`，所以气泡、TTS、情绪动作的观感完全一致。
 *
 * 依赖约束：纯函数、只依赖同目录的纯模块（`user-prompt.js` 的截断工具）。
 */

import { sanitizeTaskText } from './user-prompt.js';

/** Agent 生命周期的五个值（`AgentStateResolver` 的归一化结果）。 */
export const AGENT_STATE_LABELS = {
    idle: '空闲',
    think: '正在思考',
    working: '正在干活',
    celebrate: '刚完成',
    error: '出错了',
};

/** 三个任务节点（观察器上报的 `kind`）。 */
export const AGENT_NODE_LABELS = {
    start: '刚开始处理',
    confirm: '需要用户确认',
    done: '任务已完成',
};

/**
 * 场景段：告诉模型「你看不到屏幕，只知道到了哪个阶段」，并给出每个阶段的反应。
 *
 * 这段是**原文**，改动前先想清楚：它同时约束了长度（20/40 字）、不许复述细节、
 * 不许出现「状态/节点/事件/观察器」这些实现词——三者缺一个，气泡里就会冒出
 * 「检测到任务节点事件」这种机器口吻。
 *
 * 0.2.4：开头补了两行**作用域覆盖**。原因是实测（用真实人设复现 system）发现
 * 光靠末尾这段压不住人设——一个 1468 字的人设里「屏幕」出现 7 次、「搭话」3 次，
 * 还明确写着「不能替他做任何事」「不要提醒他」「不要讲道理」，而任务节点恰恰
 * 要求她提醒。于是模型选择了人设，回一句「会好好陪着我」。
 *
 * 0.2.5：这两行**移进了 `scene-anchor.js` 的 `AGENT_SCENE_ANCHOR`**，并补点名了
 * 「会好好陪着你」与「夸他帅」两个真实句式。场景段只留阶段反应与长度约束。
 */
export const AGENT_SPEECH_SCENE = [
    '【当前场景：Agent 驱动】',
    '你现在不在看屏幕，而是在看着 DSH 里正在跑的任务。你知道它到了哪个阶段、他要你做什么（一句话），以及一行很短的摘要；具体内容你看不到，所以不要复述、不要编造细节，也不要提"状态""节点""事件""观察器"这些词。',
    '',
    '你要做的事：针对这个阶段，用你自己的口气说一句到两句话。不同阶段该有的反应：',
    '- 刚开始处理：应一声就好，别打扰他，语气是"我在旁边看着"。',
    '- 需要用户确认：提醒他一下，可以稍微催，但别念操作步骤。',
    '- 任务已完成：替他高兴，可以邀功、可以讨赏、可以说一句"你看看"——顺口带一句这次做的是什么，别只说"好厉害"。',
    '- 出错（状态是 error）：别责怪他，先把气氛放软，可以提议歇一下。',
    '',
    '长度硬约束：每句 20 字以内，整条不超过 40 字。只写说出口的话，不要括号、不要动作描写、不要旁白。',
    '',
    '仍然遵守输出格式：回复最开头必须先输出情绪标记 [emo:情绪:强度]，再写正文。',
].join('\n');

/**
 * 同一段，去掉最后那句情绪标记要求。
 *
 * 「情绪动作引擎」关掉时 system 里不会追加 `EMOTION_TAG_INSTRUCTION`，
 * 此时还要求模型吐 `[emo:]` 就会让标记原样进气泡——所以场景段也得跟着换一版。
 */
export const AGENT_SPEECH_SCENE_PLAIN = AGENT_SPEECH_SCENE.replace(
    '\n\n仍然遵守输出格式：回复最开头必须先输出情绪标记 [emo:情绪:强度]，再写正文。',
    '',
);

/**
 * 判断一条 `detail` 到底有没有"任务信息"，没有就返回空串。
 *
 * 为什么需要这一步：三个节点的 `detail` 来源完全不同，其中两个**基本没有信息**：
 *   - `start`：页面观察器固定发空串（`postTaskEvent("start", "")`）；
 *   - `done`：页脚文本，而默认布局下页脚里只有一个图标和一句时间（"刚刚"/"3 秒前"），
 *     另一条来路是宿主 settle 时发的实现词 `agent-settled`；
 *   - `confirm`：弹窗标题或按钮文案——**唯一真有信息的一条**。
 *
 * 把这些东西原样写进「任务摘要：」，模型拿到的就是"刚刚"或"agent-settled"，
 * 于是只能用人设腔凑一句泛泛的话（实测："大叔在忙吗～恋恋就在旁边呢～"），
 * 听感就是"与任务毫无关系"。所以：**没有真信息就不要给模型**，让它退回固定文案。
 *
 * 判据刻意保守——宁可少说一句，也不要把噪声当摘要：
 *   1. 纯 ASCII 标识符（`agent-settled`、`tool_result`）——实现词，不是人话；
 *   2. 相对时间 / 时间戳（"刚刚""3 秒前""12:03"）——页脚指标，不是任务；
 *   3. 去空白后不足 2 个字符。
 */
export function sanitizeAgentDetail(detail) {
    const text = typeof detail === 'string' ? detail.trim() : '';
    if (text.length < 2)
        return '';
    if (/^[A-Za-z0-9._:/-]+$/u.test(text))
        return '';
    if (/^(?:刚刚|刚才|now|just now)$/iu.test(text))
        return '';
    if (/^(?:约|大约)?\s*\d+\s*(?:秒|分钟|小时|天|s|m|h)\s*(?:前|ago)$/iu.test(text))
        return '';
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/u.test(text))
        return '';
    return text;
}

/**
 * 组装这一句的 user 消息。
 *
 * 两路信息，来源完全不同：
 *   - `task`：用户这一回合的请求（`session/event` 的 `user/message`，已截断到 60 字）。
 *     这是"她在说什么"的锚点——没有它，模型只能靠阶段瞎猜。
 *   - `detail`：节点自带的摘要，先过 `sanitizeAgentDetail()`（页脚时间、实现词一律当没有）。
 *
 * 两者都没有时**不该调用本函数**（`AgentSpeechService` 的信息闸会直接退固定文案）：
 * 空摘要喂进去只会换来一句放哪儿都成立的废话。
 *
 * `personaName` 目前不写进消息：人设名已经在 system 的人设段里，重复一遍只会
 * 让模型开始在气泡里自称。参数保留，方便以后需要时不用改签名。
 */
export function buildAgentPrompt({ state, kind, detail, task, personaName }) {
    const stateLabel = AGENT_STATE_LABELS[state] ?? state;
    const nodeLabel = AGENT_NODE_LABELS[kind] ?? kind;
    const summary = sanitizeAgentDetail(detail);
    const taskText = sanitizeTaskText(task);
    const lines = [
        `当前状态：${stateLabel}（${state}）`,
        `任务节点：${nodeLabel}（${kind}）`,
    ];
    if (taskText !== '')
        lines.push(`这次要做的事：${taskText}`);
    if (summary !== '')
        lines.push(`任务摘要：${summary}`);
    lines.push('', '请按上面的场景说明，说一句到两句话。');
    return lines.join('\n');
}
