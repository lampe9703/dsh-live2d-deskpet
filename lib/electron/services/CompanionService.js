import { companionSystemPrompt } from '../../shared/pet-section.js';
import { buildScreenContextPrompt, describeForeground } from '../../shared/screen-context.js';
import { buildHistoryMessages, isTooSimilarReply, trimTurns } from '../../shared/companion-memory.js';
import { nsfwPromptSource, resolveNsfwPrompt } from '../../shared/companion-nsfw.js';
import { hammingDistance, perceptualHash } from './PerceptualHash.js';
import { OpenAiCompatibleClient } from './OpenAiCompatibleClient.js';
/**
 * 陪伴模式的心跳：定时截屏 → 判断画面是否变化 → 把"时间 + 前台应用 + 固定引导语"
 * 和截图一起交给独立 LLM → 回复按气泡分句说出去。
 *
 * 每一步都通过 `deps.status` 回传一个阶段名，宿主写进日志、设置页显示"最近一次
 * 截屏"。这条链路上任何一环静默失败，表现都是"桌宠不说话"，没有观测点就只能靠
 * 猜——所以这里的日志不是调试残留，是功能的一部分。
 *
 * 0.1.7 的两处变化：
 *   - 截屏间隔从分钟改为秒，最小 10 秒（配置层与这里双重夹取）；
 *   - 陪伴记忆（v1）：每轮结束后把“时间 / 前台 / 桌宠原话”交给 deps.memory 落盘，
 *     下一轮读回、裁剪后注入请求（历史只有文本，图只在当前轮），并在 system 里
 *     摆出「最近说过的话」防止重复套话；记忆关闭时相关代码路径都不走，请求形状
 *     与 0.1.6 完全一致。
 *
 * 0.1.8 的一处变化：
 *   - 成人向锚定块：config.nsfw 交给 companionSystemPrompt 的第三参数，
 *     开启时在记忆块之后、说话方式之前注入。日志只报 source 与字数，不报正文。
 */
export class CompanionService {
    deps;
    #timer;
    #intervalMs = 0;
    #config;
    #lastHash;
    #busy = false;
    /** 已经为哪一份配置报过 "armed"，避免设置页每次刷新都刷一行日志。 */
    #armedFor = '';
    constructor(deps) {
        this.deps = deps;
        // Optional probe, wired by main.js: when it reports the main
        // agent is busy, companion ticks defer instead of capturing and inferring
        // on the same machine the agent streams through.
        this.deps.agentBusy = this.deps.agentBusy ?? (() => false);
        // 陪伴记忆是可选能力：deps.memory 缺席（或配置里未开启）时整条记忆链路
        // 不走，陪伴照常说话。
    }
    configure(config, mode) {
        this.#config = config;
        // 0.1.7：秒级间隔。配置层已夹到 10–10800，这里再兜一次底：
        // 9 秒夹到 10，非法/缺失回退 600 秒。
        const intervalMs = Math.max(10, Number(config.companionIntervalSeconds) || 600) * 1000;
        // 只在间隔真的变了的时候重建定时器：`configure` 在每次 snapshot 都会调用，
        // 无条件重建等于把倒计时一直按回起点，陪伴永远等不到第一次触发。
        if (!this.#timer || this.#intervalMs !== intervalMs) {
            clearInterval(this.#timer);
            this.#intervalMs = intervalMs;
            this.#timer = setInterval(() => void this.tick(mode), intervalMs);
        }
        const armed = `${String(config.mode)}|${String(config.screenshotsEnabled)}|${String(intervalMs)}`;
        if (this.#armedFor !== armed) {
            this.#armedFor = armed;
            this.#report('armed', `间隔 ${Math.round(intervalMs / 1000)} 秒，截屏 ${config.screenshotsEnabled === true ? '开' : '关'}`);
            // 配置刚变：立刻走一轮，让"改了设置却半天没动静"不再发生。
            void this.tick(mode);
        }
    }
    /** 上报一个阶段，供宿主写日志、设置页显示。 */
    #report(stage, detail = '') {
        try {
            this.deps.status?.({ stage, detail, captured: stage === 'captured' });
        }
        catch { /* 观测点自身绝不能影响陪伴 */ }
    }
    /**
     * 当前生效的记忆配置；未开启（或没注入 memory 依赖）时 `on` 为 false。
     */
    #memoryConfig() {
        const memory = this.#config?.memory ?? {};
        const on = memory.enabled === true && this.deps.memory !== undefined && this.deps.memory !== null;
        // 配置键是 shortTermTurns（config.js / pet-section 投影同名）。
        return { on, maxTurns: memory.shortTermTurns, maxPromptChars: memory.maxPromptChars };
    }
    /**
     * 语音桥是否已就绪（模型进显存）。
     *
     * 这是整条链路的第一道闸，也是"截图尽量靠后"的关键一步：合成模型还在冷启动
     * 时先截一张、再跑一次视觉推理，最后大概率一个字也听不到——截屏与推理全是
     * 白花的。语音关掉时视为就绪：没有声音也照样该出气泡。
     * @returns 可以继续这一轮时为 true。
     */
    async #voiceReady() {
        const voice = this.#config?.voice ?? {};
        if (voice.enabled !== true)
            return true;
        const port = Number(voice.bridgePort) || 9876;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(1_200),
            });
            if (!response.ok)
                return false;
            const body = await response.json();
            return body?.ready === true;
        }
        catch {
            return false;
        }
    }
    async tick(mode) {
        const config = this.#config;
        if (!config)
            return;
        const current = mode();
        if (this.#busy) {
            this.#report('skip', '上一轮还没结束');
            return;
        }
        // 只有陪伴模式才看屏幕：任务模式下用户正在让 agent 干活，抢一次截屏+推理
        // 既无意义又费显卡。
        if (current !== 'companion') {
            this.#report('skip', `当前模式 ${current}`);
            return;
        }
        if (config.screenshotsEnabled !== true) {
            this.#report('skip', '设置里关闭了截屏');
            return;
        }
        // While the main agent streams, its token throughput is the visible metric:
        // a screen capture plus the companion/vision round trip taxes the same
        // machine, so companion chatter waits until the agent goes quiet.
        if (this.deps.agentBusy?.() === true) {
            this.#report('skip', '主 agent 正在输出');
            return;
        }
        this.#busy = true;
        try {
            // ── 第 1 步：语音模型是否已载入显存 ──────────────────────────────
            // 放在截屏之前：模型没热就截屏，等于把一次截屏 + 一次视觉推理白送出去，
            // 而且用户还听不到任何声音。就绪了再往下走，截屏因此排在链路靠后。
            if (await this.#voiceReady() === false) {
                this.#report('skip', '语音模型尚未载入显存');
                return;
            }
            // ── 第 2 步：是否真的该主动说话 ──────────────────────────────────
            // 模式 / 间隔 / 主 agent 是否在输出 / 截屏开关，全部已在上面判过。
            // ── 第 3 步：截屏 ────────────────────────────────────────────────
            this.#report('capture', '开始截屏');
            const capture = await this.deps.takeScreenshot();
            if (!capture) {
                this.#report('capture-failed', '截屏没有返回图像');
                return;
            }
            this.#report('captured', `${Math.round(capture.length / 1024)} KB`);
            const hash = perceptualHash(capture);
            if (this.#lastHash && hammingDistance(hash, this.#lastHash) < 7) {
                this.#report('skip', '画面与上次几乎相同');
                return;
            }
            this.#lastHash = hash;
            const now = new Intl.DateTimeFormat('zh-CN', { timeStyle: 'short', dateStyle: 'medium' }).format(new Date());
            // 前台应用：读不到就写"未知"，提示词里不会留空让模型自己编。
            const foreground = await this.deps.foreground?.();
            // ── 固定提示词注入点 ──────────────────────────────────────────────
            // 与截屏同一次调用、同一个 tick：只有真的截了屏才带上它。内容是
            // screen-context.js 里的常量，与人设无关；人设只影响 system message。
            const prompt = buildScreenContextPrompt({ now, foreground });
            // ── 陪伴记忆：读回 → 裁剪 → 注入 ────────────────────────────────
            // 读失败/文件损坏一律当"无记忆"降级（MemoryStore 与这里都静默），
            // 记忆永远不能成为陪伴说话的前置条件。
            const memory = this.#memoryConfig();
            let turns = [];
            if (memory.on) {
                try {
                    turns = trimTurns(await this.deps.memory.read(), memory);
                }
                catch {
                    turns = [];
                }
            }
            const history = memory.on ? buildHistoryMessages(turns) : [];
            // 相似度闸门只对比最近三轮：再往前与"这轮会不会复读"关系不大，
            // 反而容易把正常话题误判成重复。
            const recentReplies = memory.on ? turns.slice(-3).map(turn => turn.reply).filter(reply => reply !== '') : [];
            if (memory.on) {
                this.#report('infer', `前台=${foreground?.app ?? '未知'}；提示词 ${prompt.length} 字；记忆 ${String(turns.length)} 轮`);
                if (turns.length > 0)
                    this.deps.log?.(`陪伴记忆：注入最近 ${String(turns.length)} 轮历史`);
            }
            else {
                this.#report('infer', `前台=${foreground?.app ?? '未知'}；提示词 ${prompt.length} 字`);
            }
            this.deps.log?.(`陪伴提示词：${prompt.replace(/\s*\n\s*/gu, ' ｜ ')}`);
            // ── 成人向锚定块（0.1.8）：只报来源与字数，绝不打印正文 ──────────
            // 关闭时不记任何东西——默认态的日志噪声应为零，与 0.1.7 一致。
            const nsfwBody = resolveNsfwPrompt(config.nsfw);
            if (nsfwBody !== '') {
                this.deps.log?.(`成人向提示段：${nsfwPromptSource(config.nsfw)}，注入 ${String(nsfwBody.length)} 字`);
            }
            // The active persona's system prompt shapes the reply; a missing persona
            // falls back to the built-in companion text inside the client. 0.1.7 起，
            // 记忆开启时把「最近说过的话」夹进 system（人设与说话方式之间）；
            // 0.1.8 起，nsfw 开启时把锚定块夹在记忆块与说话方式之间。
            //
            // The reply arrives as one bubble piece at a time and each piece replaces
            // the previous one. The whole answer is deliberately NOT said again at the
            // end: doing so put the entire reply in the bubble at once, covering the
            // model and discarding the progressive speech that had just played.
            const reply = await this.#speak(prompt, capture, companionSystemPrompt(config.persona, memory.on ? turns : [], config.nsfw), history, recentReplies);
            // ── 回复结束：把这一轮记下来（下一轮才有历史可注入）─────────────
            // 记录失败静默降级；空回复不值得记（模型没说话或被预算裁光）。
            if (memory.on && reply !== '') {
                try {
                    const written = await this.deps.memory.append({
                        ts: Date.now(),
                        foreground: foreground?.app ?? '',
                        reply,
                        // v1 的"一句概括"：前台应用 + 窗口标题，不含屏幕原文。
                        screenNote: describeForeground(foreground),
                        hash,
                    });
                    if (written)
                        this.deps.log?.(`陪伴记忆：已记录第 ${String(turns.length + 1)} 轮`);
                }
                catch { /* 记忆写入失败不影响陪伴 */ }
            }
            this.#report('done', '本轮完成');
        }
        catch (error) {
            this.#report('error', error.message);
            this.deps.log(error.message);
        }
        finally {
            this.#busy = false;
        }
    }
    /**
     * 走一次流式回复，带防重复闸门：
     *
     * 第一段气泡上屏前先和最近几轮的原话比一次相似度——高度相似就中止这一流
     * （此时还没有任何一段被说出去）并**重采样一次**，重采样会在提示词末尾追加
     * 反重复指令；第二次无论像不像都照常说（"一次为限"，避免在小模型上无限重试
     * 拖垮节奏）。记忆关闭时没有可比历史，闸门自然不触发，行为与 0.1.6 相同。
     *
     * @returns 最终说出去的回复全文（重采样发生时为第二次的回复）。
     */
    async #speak(prompt, capture, systemPrompt, history, recentReplies) {
        const client = new OpenAiCompatibleClient(this.#config.llm);
        const say = piece => this.deps.say(piece);
        const onReasoning = reasoning => this.deps.log(`陪伴 LLM 思考过程（未显示）：${reasoning.slice(0, 500)}`);
        const gate = { checked: false, aborted: false };
        const controller = new AbortController();
        const firstAttempt = await client.stream(prompt, capture, {
            onSpeech: piece => {
                if (gate.aborted)
                    return;
                if (!gate.checked) {
                    gate.checked = true;
                    if (isTooSimilarReply(piece, recentReplies)) {
                        gate.aborted = true;
                        controller.abort();
                        this.#report('resample', '首轮回复与近期高度相似，中止重采样');
                        return;
                    }
                }
                say(piece);
            },
            onReasoning,
        }, systemPrompt, { history, signal: controller.signal }).catch((error) => {
            // 只有闸门引发的中止可以吞掉；真实错误照常上抛，走统一的 error 上报。
            if (gate.aborted)
                return '';
            throw error;
        });
        if (!gate.aborted)
            return firstAttempt;
        this.deps.log?.('陪伴记忆：回复与近期高度重复，重采样一次');
        const retryPrompt = `${prompt}\n\n【重要】你上一句和最近说过的话高度重复。换一个完全不同的角度或话题，不要再提同样的内容。`;
        return await client.stream(retryPrompt, capture, { onSpeech: say, onReasoning }, systemPrompt, { history });
    }
}
