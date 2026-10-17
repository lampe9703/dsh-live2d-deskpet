import { companionSystemPrompt } from '../../shared/pet-section.js';
import { buildScreenContextPrompt } from '../../shared/screen-context.js';
import { hammingDistance, perceptualHash } from './PerceptualHash.js';
import { OpenAiCompatibleClient } from './OpenAiCompatibleClient.js';
/**
 * 陪伴模式的心跳：定时截屏 → 判断画面是否变化 → 把"时间 + 前台应用 + 固定引导语"
 * 和截图一起交给独立 LLM → 回复按气泡分句说出去。
 *
 * 每一步都通过 `deps.status` 回传一个阶段名，宿主写进日志、设置页显示"最近一次
 * 截屏"。这条链路上任何一环静默失败，表现都是"桌宠不说话"，没有观测点就只能靠
 * 猜——所以这里的日志不是调试残留，是功能的一部分。
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
    }
    configure(config, mode) {
        this.#config = config;
        const intervalMs = Math.max(1, Number(config.companionIntervalMinutes) || 10) * 60_000;
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
            this.#report('armed', `间隔 ${Math.round(intervalMs / 60_000)} 分钟，截屏 ${config.screenshotsEnabled === true ? '开' : '关'}`);
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
            this.#report('infer', `前台=${foreground?.app ?? '未知'}；提示词 ${prompt.length} 字`);
            this.deps.log?.(`陪伴提示词：${prompt.replace(/\s*\n\s*/gu, ' ｜ ')}`);
            // The active persona's system prompt shapes the reply; a missing persona
            // falls back to the built-in companion text inside the client.
            //
            // The reply arrives as one bubble piece at a time and each piece replaces
            // the previous one. The whole answer is deliberately NOT said again at the
            // end: doing so put the entire reply in the bubble at once, covering the
            // model and discarding the progressive speech that had just played.
            await new OpenAiCompatibleClient(config.llm).stream(prompt, capture, {
                onSpeech: piece => this.deps.say(piece),
                // Thinking stays on; it simply is not spoken. Logged so it can be
                // inspected without ever reaching the bubble.
                onReasoning: reasoning => this.deps.log(`陪伴 LLM 思考过程（未显示）：${reasoning.slice(0, 500)}`),
            }, companionSystemPrompt(config.persona));
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
}
