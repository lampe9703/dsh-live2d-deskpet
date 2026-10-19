/**
 * 陪伴记忆（v1）的纯函数层：轮次的清洗、序列化、裁剪、注入与去重判断。
 *
 * 定位与分层（0.1.7）：
 *   - 这里只放**纯函数**：拼记忆块、裁剪、JSONL 序列化/解析、相似度判断、
 *     隐私过滤。不 import 任何 node 内置模块——本文件经 pet-section 打进
 *     浏览器客户端 bundle，也供宿主与 Electron 两侧共用，还被 verify 脚本
 *     直接 import 做单测。
 *   - 文件读写（turns.jsonl 的原子追加与清空）在 lib/electron/services/
 *     MemoryStore.js，通过依赖注入交给 CompanionService。
 *
 * 数据形状：turns.jsonl 每行一条
 *   { ts, foreground, reply, screenNote, hash }
 *   - ts         轮次时间（epoch 毫秒）；
 *   - foreground 前台应用名（一句话，不含窗口标题长文）；
 *   - reply      桌宠当轮原话（气泡预算 60 字，这里留 120 字余量）；
 *   - screenNote 屏幕的一句话概括。v1 没有摘要模型可用（不能假设大模型能力），
 *               因此只存确定性可得的一句：前台应用 + 窗口标题，**不存屏幕原文**；
 *   - hash       该轮截屏的感知哈希（64 位 0/1 串），供后续轮次对照画面变化。
 *
 * 隐私红线：所有文本字段写入前都过 {@link redactSensitive} + 长度截断，
 * 疑似密码、证件号、密钥的串一律不落盘。
 */

/** 记忆文件名（放在 ~/.dsh/live2d-deskpet/memory/ 下）。 */
export const MEMORY_FILE = 'turns.jsonl';
/**
 * 文件层面的行数硬上限。
 *
 * 策略裁剪（保留几轮、注入多少字）是读取侧按配置算的；文件多存一些历史，
 * 用户调大 shortTermTurns 时不用从头攒。硬上限只是防止文件无限增长。
 */
export const MEMORY_FILE_MAX_LINES = 200;

/** 保留轮数的默认/上下限（与 config.js 的 memory.shortTermTurns 一致）。 */
export const MEMORY_DEFAULT_TURNS = 8;
export const MEMORY_MIN_TURNS = 1;
export const MEMORY_MAX_TURNS = 30;
/** 历史注入字符预算的默认/上下限（与 config.js 的 memory.maxPromptChars 一致）。 */
export const MEMORY_DEFAULT_PROMPT_CHARS = 1200;
export const MEMORY_MIN_PROMPT_CHARS = 200;
export const MEMORY_MAX_PROMPT_CHARS = 20000;

/** 单字段写入长度上限（字符数，按码点计）。 */
const TURN_FOREGROUND_MAX_CHARS = 80;
const TURN_REPLY_MAX_CHARS = 120;
const TURN_NOTE_MAX_CHARS = 160;
const TURN_HASH_MAX_CHARS = 128;

/** 记忆块（防重复清单）里最多列出最近几轮的原话。 */
const MEMORY_BLOCK_TURNS = 3;
/** 相似度判定阈值：归一化二元组包含度达到该值即视为"高度相似"。 */
const SIMILAR_THRESHOLD = 0.6;
/** 连续片段判据：归一化后共享达到该长度的连续片段即视为复读同一短语。 */
const SIMILAR_RUN_CHARS = 6;

/** 记忆轮数的配置夹取。 */
export function clampMemoryTurns(value) {
    const turns = Math.round(Number(value));
    if (!Number.isFinite(turns))
        return MEMORY_DEFAULT_TURNS;
    return Math.min(MEMORY_MAX_TURNS, Math.max(MEMORY_MIN_TURNS, turns));
}

/** 历史注入字符预算的配置夹取。 */
export function clampMemoryPromptChars(value) {
    const chars = Math.round(Number(value));
    if (!Number.isFinite(chars))
        return MEMORY_DEFAULT_PROMPT_CHARS;
    return Math.min(MEMORY_MAX_PROMPT_CHARS, Math.max(MEMORY_MIN_PROMPT_CHARS, chars));
}

// ── 隐私过滤 ────────────────────────────────────────────────────────────────

/**
 * 疑似敏感串的替换规则。
 *
 * 只做"写入前的保守过滤"：宁可得体地隐藏，也不能把密码、证件号、密钥落到
 * 磁盘上。规则刻意收窄，避免把普通窗口标题（含插件名、URL 片段）误杀：
 *   - 18 位身份证：连续 17 位数字 + 数字/X；
 *   - sk-/rk-/ak-/pk- 前缀的 API Key；
 *   - 32 位以上的连续十六进制/纯字母数字 Base64 段（密钥与摘要的常见形态，
 *     普通英文词与带连字符的名字都到不了这么长的连续段）；
 *   - 「密码：xxx」「password=xxx」这类赋值：保留标签、隐藏值。
 */
const SENSITIVE_PATTERNS = [
    [/\d{17}[\dXx]/gu, '[证件号]'],
    [/\b(?:sk|rk|ak|pk)-[A-Za-z0-9_-]{12,}/gu, '[密钥]'],
    [/\bAKIA[0-9A-Z]{16}\b/gu, '[密钥]'],
    [/\bghp_[A-Za-z0-9]{30,}/gu, '[密钥]'],
    [/\b[A-Fa-f0-9]{32,}\b/gu, '[密钥]'],
    [/\b[A-Za-z0-9+/]{40,}/gu, '[密钥]'],
    [/((?:密码|口令|secret|token|api[_-]?key|access[_-]?key|password|passwd|pwd)\s*[:：=])\s*\S+/giu, '$1[已隐藏]'],
];

/** 把疑似敏感的串替换成占位说明；输入不是字符串时返回空串。 */
export function redactSensitive(text) {
    let value = typeof text === 'string' ? text : '';
    for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
        try {
            value = value.replace(pattern, replacement);
        }
        catch { /* 单条规则失败不影响其余规则 */ }
    }
    return value;
}

/**
 * 清洗一个要落盘的文本字段：脱敏、压平换行、按码点截断。
 * @param limit - 截断长度（字符数）。
 */
export function sanitizeTurnText(text, limit) {
    const value = redactSensitive(String(text ?? '')).replace(/\s*\n\s*/gu, ' ').trim();
    const chars = Array.from(value);
    if (chars.length <= limit)
        return value;
    return chars.slice(0, limit).join('');
}

/**
 * 清洗感知哈希字段。
 *
 * 哈希是内部生成的 64 位 0/1 串，不含任何用户内容——所以**不走脱敏**
 * （0/1 长串会被"18 位数字"的证件号规则误杀）。这里只保留 0/1 并截断，
 * 外部传进来的任何其它字符一律丢弃。
 */
function sanitizeHash(value) {
    return String(value ?? '').replace(/[^01]/gu, '').slice(0, TURN_HASH_MAX_CHARS);
}

/**
 * 把外部输入整形成一条可安全落盘的轮次记录。
 *
 * 未知字段一律丢弃（文件里只出现固定形状）；文本字段先脱敏再截断，
 * 哈希字段只做形状收敛（见 {@link sanitizeHash}）。
 */
export function buildTurn(input) {
    const source = typeof input === 'object' && input !== null ? input : {};
    const ts = Number(source.ts);
    return {
        ts: Number.isFinite(ts) ? Math.round(ts) : Date.now(),
        foreground: sanitizeTurnText(source.foreground, TURN_FOREGROUND_MAX_CHARS),
        reply: sanitizeTurnText(source.reply, TURN_REPLY_MAX_CHARS),
        screenNote: sanitizeTurnText(source.screenNote, TURN_NOTE_MAX_CHARS),
        hash: sanitizeHash(source.hash),
    };
}

// ── JSONL 序列化 / 解析 ─────────────────────────────────────────────────────

/** 把轮次数组序列化成 turns.jsonl 的全文；空数组序列化成空字符串。 */
export function serializeTurns(turns) {
    if (!Array.isArray(turns))
        return '';
    return turns.map(turn => JSON.stringify(buildTurn(turn))).filter(line => line !== '').join('\n') + (turns.length > 0 ? '\n' : '');
}

/**
 * 解析 turns.jsonl 全文。
 *
 * 损坏行（非法 JSON、JSON 但不是对象、缺 reply）逐行跳过；整个文件坏掉时
 * 返回空数组——**读取侧永远把"坏记忆"当"无记忆"，绝不影响陪伴主链路**。
 */
export function parseTurns(text) {
    if (typeof text !== 'string' || text.trim() === '')
        return [];
    const turns = [];
    for (const line of text.split('\n')) {
        const raw = line.trim();
        if (raw === '')
            continue;
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null)
                continue;
            if (typeof parsed.reply !== 'string' || parsed.reply.trim() === '')
                continue;
            turns.push(buildTurn(parsed));
        }
        catch { /* 坏行跳过 */ }
    }
    return turns;
}

// ── 裁剪与注入 ──────────────────────────────────────────────────────────────

/** 一条轮次在注入时的长度成本估算（历史 user 行 + 桌宠原话 + 少量包装）。 */
function turnCost(turn) {
    return String(turn.screenNote ?? '').length + String(turn.reply ?? '').length + 48;
}

/**
 * 按配置裁剪出"这一轮要用的"轮次：先按轮数取最近 N 条，再从最新往前收，
 * 收满字符预算为止；最新一条永远保留（预算再小也至少注入最近一轮）。
 */
export function trimTurns(turns, options = {}) {
    if (!Array.isArray(turns) || turns.length === 0)
        return [];
    const limit = clampMemoryTurns(options.maxTurns);
    const budget = clampMemoryPromptChars(options.maxPromptChars);
    const kept = turns.slice(-limit);
    let spent = 0;
    let start = kept.length - 1;
    for (let index = kept.length - 1; index >= 0; index--) {
        const cost = turnCost(kept[index]);
        if (index < kept.length - 1 && spent + cost > budget)
            break;
        spent += cost;
        start = index;
    }
    return kept.slice(start);
}

/**
 * 拼接进 system 提示词的"记忆块"（v1 只有「最近说过的话」清单）。
 *
 * v1 的定位是**防重复**：把最近几轮原话显式摆出来，并写明不要复述、不要同义
 * 反复。长期画像、情节摘要属于 v2，这里不预留假字段。
 * @returns 空历史时返回空字符串（system 提示词保持与人设 + 说话方式两段式，
 *   与 0.1.6 完全一致）。
 */
export function buildMemoryBlock(turns) {
    const recent = (Array.isArray(turns) ? turns : []).slice(-MEMORY_BLOCK_TURNS).filter(turn => typeof turn?.reply === 'string' && turn.reply.trim() !== '');
    if (recent.length === 0)
        return '';
    const lines = recent.map((turn, index) => `${String(index + 1)}. 「${turn.reply}」`);
    return [
        '【最近说过的话】',
        '下面是你最近几轮说过的话。这一轮禁止重复其中任何一句，也不要换个说法把同样的意思再讲一遍（比如反复提久坐、腿麻、腰酸、喝水、休息）：',
        ...lines,
        '确实没有新话题时，只回一个很短的语气词，也不要重复上面的话。',
    ].join('\n');
}

/** 把 epoch 毫秒格式化成简短本地时间；失败时回退 ISO 字符串。 */
export function formatTurnTime(ts) {
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime()))
        return '';
    try {
        return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
    }
    catch {
        return date.toISOString();
    }
}

/**
 * 把轮次拼成注入 messages 用的历史（user/assistant 交替，只有文本）。
 *
 * - 历史 user 行 = 时间 + 前台 + 一句概括（screenNote 本身就是那句话）；
 * - 历史 assistant 行 = 桌宠当轮原话；
 * - **历史一律不带图片**，只有当前轮（调用方构造）带截图。
 * 空输入返回空数组：注入层拿到空数组时不加任何历史，行为与 0.1.6 一致。
 */
export function buildHistoryMessages(turns) {
    const messages = [];
    for (const turn of Array.isArray(turns) ? turns : []) {
        if (typeof turn?.reply !== 'string' || turn.reply.trim() === '')
            continue;
        const time = formatTurnTime(turn.ts);
        const note = String(turn.screenNote ?? '').trim();
        const head = time !== '' ? `${time}，${note}` : note;
        messages.push({ role: 'user', content: head === '' ? '（屏幕概况缺失）' : head });
        messages.push({ role: 'assistant', content: turn.reply });
    }
    return messages;
}

// ── 相似度（防重复的"重采样一次"闸门）──────────────────────────────────────

/** 相似度比较用的归一化：小写、去掉空白与标点符号。 */
function normalizeForSimilarity(text) {
    return String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 归一化文本的二元组集合；单字文本退化为自身。 */
function bigrams(text) {
    const set = new Set();
    if (text.length === 1)
        set.add(text);
    for (let index = 0; index + 1 < text.length; index++)
        set.add(text.slice(index, index + 2));
    return set;
}

/**
 * 两条归一化文本的最长公共连续片段长度（O(n·m) DP；文本都截在 120 字内，开销可忽略）。
 *
 * 用途：套话复读常常不是整句重复，而是**同一个核心短语再包装**（「腿都要麻了吧」
 * 换个前后缀再说一遍）。二元组包含度对这类片段占比低时会漏报，连续片段是最直接的
 * 证据：两条 30–60 字的短回复共享 ≥6 字连续片段，基本就是在复读同一句话。
 */
function longestCommonRun(a, b) {
    if (a === '' || b === '')
        return 0;
    let best = 0;
    let previous = new Uint16Array(b.length + 1);
    let current = new Uint16Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : 0;
            if (current[j] > best)
                best = current[j];
        }
        const swap = previous;
        previous = current;
        current = swap;
    }
    return best;
}

/**
 * 两条回复的相似度（0–1）。
 *
 * 用「二元组包含度」而不是并集 Jaccard：套话复读常常是"旧话的片段再包装"，
 * 包含度（交集 / 较小一方）对这类高度包含的重复更敏感，对两条都长但话题
 * 不同的回复则不会误报。
 */
export function replySimilarity(a, b) {
    const first = normalizeForSimilarity(a);
    const second = normalizeForSimilarity(b);
    if (first === '' || second === '')
        return 0;
    if (first === second)
        return 1;
    const setA = bigrams(first);
    const setB = bigrams(second);
    if (setA.size === 0 || setB.size === 0)
        return 0;
    let common = 0;
    for (const gram of setA)
        if (setB.has(gram))
            common++;
    return common / Math.min(setA.size, setB.size);
}

/**
 * 一条候选回复是否与近期说过的任何一条"高度相似"。
 *
 * 两个信号任一命中即算：
 *   1. 二元组包含度 ≥ 0.6（整句级别的复读）；
 *   2. 归一化后共享 ≥ 6 字的连续片段（核心短语复读，如「腿都要麻了吧」换个
 *      前后缀再说一遍）。
 *
 * 供 CompanionService 的首段闸门使用：命中则中止本轮流式输出并重采样一次。
 * 候选或历史为空时返回 false（没有可比对象时不拦截）。
 */
export function isTooSimilarReply(candidate, previousReplies) {
    const target = typeof candidate === 'string' ? candidate : '';
    if (target.trim() === '')
        return false;
    const normalized = normalizeForSimilarity(target);
    for (const previous of Array.isArray(previousReplies) ? previousReplies : []) {
        if (typeof previous !== 'string' || previous.trim() === '')
            continue;
        if (replySimilarity(target, previous) >= SIMILAR_THRESHOLD)
            return true;
        if (longestCommonRun(normalized, normalizeForSimilarity(previous)) >= SIMILAR_RUN_CHARS)
            return true;
    }
    return false;
}
