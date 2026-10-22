/**
 * Agent 驱动模式的发言服务：**就着任务节点，让陪伴 LLM 说一句**。
 *
 * 为什么不塞进 `CompanionService.tick()`：那个函数的第一道门就是
 * `if (current !== 'companion') return;`——它的职责是"定时截屏 + 主动搭话"，
 * 把节点播报硬塞进去等于让两条链路共用同一个 busy 闸与同一份记忆，改坏了
 * 截图驱动那条路都看不出来。两条链路在 0.2.1 仍然彼此独立，只在最下游
 * （`deps.say(text, emotion)`）汇合。
 *
 * 复用而不是重写：
 *   - 情绪标记的剥离与上报 → `OpenAiCompatibleClient`（内部用
 *     `shared/emotion-tag.js` 的 `createEmotionTagFilter()`），气泡里不会出现 `[emo:`；
 *   - 流式请求 → `OpenAiCompatibleClient.stream()`，**不传 image**（Agent 模式不截屏）；
 *   - 人设 → `companionSystemPrompt(persona, [], nsfw)`，不注入记忆历史
 *     （Agent 模式不需要"最近说过什么"）。
 *
 * 失败一律降级成固定文案（`pickTaskLine`）+ 固定情绪，气泡照出：节点播报是
 * 提醒用户的功能，不能因为 LLM 没配好就整条链路静默。
 */

import { activePersona, companionSystemPrompt } from '../../shared/pet-section.js';
import { EMOTION_TAG_INSTRUCTION } from '../../shared/emotion-tag.js';
import { AGENT_SPEECH_SCENE, AGENT_SPEECH_SCENE_PLAIN, buildAgentPrompt, sanitizeAgentDetail } from '../../shared/agent-speech.js';
import { sanitizeTaskText } from '../../shared/user-prompt.js';
import { AGENT_SCENE_ANCHOR } from '../../shared/scene-anchor.js';
import { pickTaskLine } from '../../shared/task-voice.js';
import { OpenAiCompatibleClient } from './OpenAiCompatibleClient.js';

/** LLM 不回来时的兜底情绪。与注入层的 STATE_BASELINE 同源，但强度按节点给。 */
const NODE_FALLBACK_EMOTION = {
    start: { emotion: 'calm', intensity: 0.45 },
    confirm: { emotion: 'worried', intensity: 0.50 },
    done: { emotion: 'happy', intensity: 0.80 },
};

/**
 * 一次节点发言的硬超时。
 *
 * 6 秒：节点播报的价值在于"及时"，超过这个长度用户已经自己看到界面变化了，
 * 再补一句只会显得迟钝。超时不是错误——没说过任何一段就直接退回固定文案。
 */
const LLM_TIMEOUT_MS = 6_000;

export class AgentSpeechService {
    deps;
    /** 最近一次 configure 传进来的配置引用（只存，不建任何定时器）。 */
    #config;
    /** 模式来源：函数或字符串。宿主传 `() => effectiveMode()`，auto 才会实时解析。 */
    #mode;
    /** 并发闸：上一句还在流式输出时，新的节点事件直接丢弃。 */
    #busy = false;

    constructor(deps) {
        this.deps = deps;
    }

    /**
     * 只存引用，不建定时器。
     *
     * 与 `CompanionService.configure` 的关键区别：那边要按间隔建 `setInterval`，
     * 这边一次发言一次请求，没有常驻循环——插件禁用后 CPU 立刻回落。
     */
    configure(config, mode) {
        this.#config = config;
        this.#mode = mode;
    }

    /**
     * 就一个任务节点说一句。
     *
     * 调用方（`DesktopPetHost.handleTaskEvent`）已经做过判重、冷却与开关判断，
     * 并且**不能 await 本方法**——页面侧的 POST 不能挂在一次 LLM 请求上。
     *
     * @param node.state - 归一化后的 agent 状态（用于提示词，也是 error 语气的唯一来源）
     * @param node.kind - start / confirm / done
     * @param node.detail - 一行很短的摘要（观察器给的，已裁剪）
     * @returns 是否真的说了（说了才需要写日志；被并发闸丢掉返回 false）
     */
    async speakForNode({ state, kind, detail, task }) {
        const config = this.#config;
        if (!config)
            return false;
        if (typeof kind !== 'string' || kind === '')
            return false;
        // ── 1) 模式闸：只有 Agent 驱动（或 auto 解析成 Agent 驱动）才说话 ──
        const current = typeof this.#mode === 'function' ? this.#mode() : this.#mode;
        if (current !== 'task') {
            this.#log(`Agent 发言跳过：当前模式 ${String(current)}`);
            return false;
        }
        // ── 2) 并发闸：节点事件是离散的，丢了不可惜，叠着说才是事故 ──
        if (this.#busy) {
            this.#log(`Agent 发言丢弃：上一句还在说（${String(kind)}）`);
            return false;
        }
        // 情绪动作引擎关掉时：话照说（LLM 照调），只是不带情绪标记。
        const emotional = config.emotionEngine !== false;
        // ── 3) 信息闸（0.2.6，0.2.8 放宽）：手里没有任何任务信息就别问模型 ──
        //
        // 三个节点的 detail 里，只有 confirm 的弹窗标题是真信息；start 恒为空、
        // done 常常是页脚时间（"刚刚"）或实现词（"agent-settled"）。把噪声当摘要
        // 喂进去，模型手里只剩"某个阶段到了"，只能用人设腔凑一句泛泛的话——
        // 听感就是"与任务毫无关系"。
        //
        // 0.2.8：`task`（用户这一回合的请求）也算有效信息。有了它，start/done 也
        // 能说出贴着任务的话，而不是退成固定台词。
        const summary = sanitizeAgentDetail(detail);
        const taskText = sanitizeTaskText(task);
        if (summary === '' && taskText === '') {
            this.#log(`Agent 发言改用固定文案：${kind} 没有可用摘要（原值 ${JSON.stringify(detail ?? '')}）`);
            return this.#fallback(kind, emotional);
        }
        this.#busy = true;
        let said = false;
        try {
            said = await this.#streamNode({ state, kind, detail: summary, task: taskText, emotional });
        }
        catch (error) {
            // #streamNode 自己已经吞掉请求错误；走到这里说明是意料外的异常，
            // 同样降级，不让节点播报整条静默。
            this.#log(`Agent 发言异常：${error?.message ?? String(error)}`);
        }
        finally {
            this.#busy = false;
        }
        if (!said)
            return this.#fallback(kind, emotional);
        return true;
    }

    /** 走一次流式回复。返回是否已经上过屏（上过屏就不再补固定文案）。 */
    async #streamNode({ state, kind, detail, task, emotional }) {
        const config = this.#config;
        const llm = config.llm ?? {};
        if (!llm.model || typeof llm.model !== 'string' || llm.model.trim() === '') {
            this.#log('Agent 发言跳过：未配置陪伴 LLM 模型');
            return false;
        }
        const personaName = activePersona(config.persona)?.name ?? '';
        const prompt = buildAgentPrompt({ state, kind, detail, task, personaName });
        // 人设与说话方式沿用陪伴那一套；记忆轮次传空数组——Agent 模式没有"上一轮"。
        // 0.2.4：**不注入【说话方式】段**。那一段的字数预算（30–N 字、每句 20–40 字）
        // 与场景段的「每句 20 字以内、整条 40 字」直接打架，模型会挑前者，于是回复
        // 变成陪伴腔的闲聊。Agent 模式的长度只由场景段说了算。
        // 0.2.5：场景说明不再靠"覆盖人设"，而是作为【场景锚定块】插在人设之后——
        // 人设卡只留性格与语气，陪伴/Agent 的场景规则由宿主按模式各注一份。
        const base = companionSystemPrompt(config.persona, [], config.nsfw, {
            speechStyle: false,
            sceneAnchor: AGENT_SCENE_ANCHOR,
        });
        const scene = emotional ? AGENT_SPEECH_SCENE : AGENT_SPEECH_SCENE_PLAIN;
        // 顺序固定：人设 → 情绪标记约束 → 场景段。场景段必须最后，它才是本轮的任务书。
        const system = emotional
            ? `${base}\n${EMOTION_TAG_INSTRUCTION}\n\n${scene}`
            : `${base}\n\n${scene}`;
        // 每句重置：上一句的情绪绝不能带进这一句的动作里。
        let emotion;
        let said = false;
        const say = (piece) => {
            if (typeof piece !== 'string' || piece === '')
                return;
            said = true;
            this.deps.say?.(piece, emotional ? emotion : undefined);
        };
        const onEmotion = (value) => {
            emotion = value;
            this.#log(`Agent 情绪：${value.emotion}（强度 ${value.intensity.toFixed(2)}）`);
        };
        const onReasoning = (reasoning) => this.#log(`Agent LLM 思考过程（未显示）：${String(reasoning).slice(0, 300)}`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
        try {
            // image 必须为 undefined：Agent 模式不截屏，省显卡也别抢资源。
            await new OpenAiCompatibleClient(llm).stream(prompt, undefined, { onSpeech: say, onEmotion, onReasoning }, system, { signal: controller.signal });
        }
        catch (error) {
            this.#log(`Agent 发言请求失败：${error?.message ?? String(error)}`);
        }
        finally {
            clearTimeout(timer);
        }
        if (!said && controller.signal.aborted)
            this.#log(`Agent 发言超时（${LLM_TIMEOUT_MS / 1000}s），退回固定文案`);
        this.#log(`Agent 发言 ${kind}${detail ? `（${detail}）` : ''}：${said ? 'LLM 已说' : 'LLM 未产出'}`);
        return said;
    }

    /** 固定文案兜底：与 0.2.0 的节点播报同一批句子，额外带一个固定情绪。 */
    #fallback(kind, emotional) {
        const text = pickTaskLine(kind);
        if (text === '')
            return false;
        const fixed = NODE_FALLBACK_EMOTION[kind];
        this.deps.say?.(text, emotional && fixed ? { ...fixed, confidence: 1, source: 'fallback' } : undefined);
        this.#log(`Agent 发言退回固定文案：${kind} → ${text}`);
        return true;
    }

    #log(message) {
        try {
            this.deps.log?.(message);
            this.deps.status?.({ stage: 'agent-speech', detail: message });
        }
        catch { /* 观测点自身绝不能影响发言 */ }
    }
}
