/**
 * 任务节点语音：文案与事件定义。
 *
 * 定位与人设无关：这些是"系统在替桌宠播报状态"，不是角色在说话，所以文案
 * 固定在这里，不读 persona、不读设置文本。换人设不会改变它们。
 *
 * 气泡始终是中文；发声语种由 voice.lang 决定（默认 ja，桥会先中译日再合成）。
 * 因此这里只需要写中文，日语是 TTS 那一层的产物。
 *
 * 依赖约束：会被打进浏览器客户端与宿主两侧，只允许纯函数。
 */

/** 三个任务节点。`start` 默认关闭（每回合都会触发，容易吵）。 */
export const TASK_EVENT_KINDS = ['start', 'confirm', 'done'];

/**
 * 每个节点 2–3 句候选，长度控制在 8–16 字：
 * 气泡单句预算 20–40 字，短句不会被 splitSpeechPieces 二次切分，念起来也干脆。
 */
export const TASK_VOICE_LINES = {
    start: [
        '好，我开始处理了。',
        '收到，这就动手。',
    ],
    confirm: [
        '有个操作需要你确认一下。',
        '这里要你点一下同意才行。',
        '停一下，等你确认。',
    ],
    done: [
        '任务完成啦。',
        '做完啦，你看看。',
        '搞定，随时可以验收。',
    ],
};

/** 是否是我们认识的节点类型。 */
export function isTaskEventKind(value) {
    return typeof value === 'string' && TASK_EVENT_KINDS.includes(value);
}

/**
 * 取一句该节点的文案。
 * @param kind - start / confirm / done
 * @param random - 注入点，便于测试固定结果
 */
export function pickTaskLine(kind, random = Math.random) {
    const lines = TASK_VOICE_LINES[kind];
    if (!Array.isArray(lines) || lines.length === 0)
        return '';
    const index = Math.floor(random() * lines.length);
    return lines[Math.min(index, lines.length - 1)] ?? lines[0];
}

/**
 * 节点对应的 Live2D 状态（渲染器按状态挑动作组）。
 * 确认时停在"思考"，完成时切"庆祝"，开始则回到"工作中"。
 */
export function taskStateFor(kind) {
    if (kind === 'done')
        return 'celebrate';
    if (kind === 'confirm')
        return 'think';
    return 'working';
}
