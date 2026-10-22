/**
 * 情绪标签：让陪伴 LLM 在**回复最开头**输出一个隐藏标记，一次调用同时拿到
 * 「气泡文本」和「情绪」。
 *
 * 为什么不是让模型吐 JSON：气泡是流式逐句上屏的，整段 JSON 会毁掉流式体验
 * （必须等 JSON 闭合才能解析）。前缀标记则天然与流式兼容——它出现在第一个
 * token 里，解析完就可以立刻上屏第一句，动作也在同一帧就有情绪可用。
 *
 * 标记格式：`[emo:happy:0.8]`（强度可省略，默认 0.6；中英文括号与冒号都容忍）
 * 解析失败（模型不听话 / 吐了别的东西）一律返回 null，调用方退回关键词兜底。
 */

/** 情绪白名单：模型吐出表外的词就当没给，避免把任意字符串写进引擎。 */
const EMOTIONS = new Set([
    'happy', 'sad', 'angry', 'worried', 'surprised', 'shy', 'tired', 'neutral',
    'excited', 'calm', 'confused', 'proud', 'lonely',
]);

const ALIASES = new Map([
    ['开心', 'happy'], ['高兴', 'happy'], ['兴奋', 'excited'], ['喜悦', 'happy'],
    ['难过', 'sad'], ['伤心', 'sad'], ['失落', 'sad'], ['委屈', 'sad'],
    ['生气', 'angry'], ['愤怒', 'angry'], ['烦', 'angry'],
    ['担心', 'worried'], ['焦虑', 'worried'], ['紧张', 'worried'], ['不安', 'worried'],
    ['惊讶', 'surprised'], ['吃惊', 'surprised'], ['震惊', 'surprised'],
    ['害羞', 'shy'], ['不好意思', 'shy'],
    ['累', 'tired'], ['困', 'tired'], ['疲惫', 'tired'],
    ['平静', 'calm'], ['中性', 'neutral'],
]);

const TAG = /^\s*[[【]\s*emo\s*[:：]\s*([A-Za-z_\u4e00-\u9fa5]{1,12})\s*(?:[:：,，]\s*([0-9]*\.?[0-9]+))?\s*[\]】]\s*/;
/** 还能长成标签的最长前缀；超过这个长度仍没闭合就不再等待。 */
const MAX_PROBE = 40;

/** 把标签里的情绪词归一化；表外返回 null。 */
export function normalizeEmotionWord(word) {
    if (typeof word !== 'string')
        return null;
    const raw = word.trim();
    if (raw === '')
        return null;
    const lower = raw.toLowerCase();
    if (EMOTIONS.has(lower))
        return lower;
    return ALIASES.get(raw) ?? null;
}

/**
 * 前缀标签过滤器。用法：
 *   const filter = createEmotionTagFilter();
 *   const clean = filter.push(tokenChunk);   // 可能返回空串（还在等标签闭合）
 *   const rest = filter.flush();             // 流结束时把剩余文本交出来
 *   filter.emotion;                          // { emotion, intensity } | null
 */
export function createEmotionTagFilter() {
    let buffer = '';
    let settled = false;
    let emotion = null;
    return {
        get emotion() {
            return emotion;
        },
        push(chunk) {
            if (settled)
                return chunk;
            buffer += chunk;
            // 开头不是括号：肯定没有标签，直接放行（避免每句都多等一个 token）
            if (!/^\s*[[【]/.test(buffer)) {
                settled = true;
                const out = buffer;
                buffer = '';
                return out;
            }
            const match = TAG.exec(buffer);
            if (match) {
                settled = true;
                const word = normalizeEmotionWord(match[1]);
                const intensity = match[2] === undefined ? 0.6 : Number(match[2]);
                if (word) {
                    emotion = {
                        emotion: word,
                        intensity: Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.6,
                        confidence: 1,
                        source: 'llm',
                    };
                }
                const out = buffer.slice(match[0].length);
                buffer = '';
                return out;
            }
            // 还没闭合：只要还有可能是标签就继续等，但别无限等
            if (buffer.length >= MAX_PROBE) {
                settled = true;
                const out = buffer;
                buffer = '';
                return out;
            }
            return '';
        },
        flush() {
            if (settled)
                return '';
            settled = true;
            const out = buffer;
            buffer = '';
            return out;
        },
    };
}

/**
 * 追加到 system prompt 尾部的指令。
 *
 * 三条约束都是有原因的：只在开头出现（流式解析要它先到）、只说情绪词不解释
 * （否则标签会混进气泡）、没有情绪就不写（宁可让本地关键词兜底，也不要瞎猜）。
 */
export const EMOTION_TAG_INSTRUCTION = [
    '',
    '【输出格式（必须遵守）】',
    '在每次回复的最开头，先输出一个情绪标记，再写正文。格式严格为：',
    '[emo:情绪:强度]',
    '情绪只能从这个列表里选：happy, sad, angry, worried, surprised, shy, tired, excited, calm, confused, proud, lonely, neutral。',
    '强度是 0 到 1 之间的小数，表示这股情绪的强烈程度。',
    '示例：[emo:happy:0.8]太好了，终于搞定了！',
    '标记只出现在最开头，正文里不要再出现任何标记、括号说明或英文情绪词。',
    '如果确实没有明显情绪，用 [emo:neutral:0.3]。',
].join('\n');
