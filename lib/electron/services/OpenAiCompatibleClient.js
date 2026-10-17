import { DEFAULT_COMPANION_SYSTEM_PROMPT } from '../../shared/pet-section.js';
import { SpeechQueue, takeBubbleChunk } from '../../shared/bubble-speech.js';
import { ReasoningFilter } from '../../shared/reasoning.js';
/**
 * Normalize an OpenAI-compatible base URL: trailing slashes dropped, `/v1`
 * appended when the caller omitted it, so both `http://host` and
 * `http://host/v1` address the same endpoint.
 */
export function normalizeLlmBaseUrl(baseUrl) {
    const trimmed = baseUrl.trim().replace(/\/+$/u, '');
    return /\/v\d+$/u.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
export class OpenAiCompatibleClient {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Stream one completion, reporting the reply a bubble at a time.
     *
     * Reasoning never reaches `onSpeech`: a `reasoning_content` delta is routed
     * straight to `onReasoning`, and any inline ` thinking… response` in `content` is
     * filtered out mid-stream by {@link ReasoningFilter}. Thinking stays enabled —
     * it is withheld from the bubble, not switched off.
     * @param prompt - the user turn (screen context and time).
     * @param image - optional screenshot sent as an `image_url` data URL.
     * @param sinks - speech and reasoning callbacks.
     * @param systemPrompt - persona prompt; falls back to the built-in companion text.
     * @returns the visible reply text, with reasoning removed.
     */
    async stream(prompt, image, sinks = {}, systemPrompt) {
        if (!this.config.model)
            throw new Error('请先在 DSH 插件设置中填写独立 LLM 模型名。');
        const content = [{ type: 'text', text: prompt }];
        if (image)
            content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } });
        const endpoint = `${normalizeLlmBaseUrl(this.config.baseUrl)}/chat/completions`;
        // A refused connection throws before any response exists, and the bare
        // `TypeError: fetch failed` names neither the endpoint nor what to check.
        // The companion only logs this message, so it has to be self-explanatory.
        let response;
        try {
            response = await fetch(endpoint, {
                method: 'POST', headers: { 'content-type': 'application/json', ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}) },
                body: JSON.stringify({ model: image ? (this.config.visionModel || this.config.model) : this.config.model, stream: true, temperature: this.config.temperature, messages: [
                        { role: 'system', content: systemPrompt?.trim() || DEFAULT_COMPANION_SYSTEM_PROMPT },
                        { role: 'user', content },
                    ] }),
            });
        }
        catch (error) {
            throw new Error(`无法连接 LLM 端点 ${endpoint}：${error.message}。请确认服务已启动、Base URL 与端口正确。`);
        }
        if (!response.ok || !response.body)
            throw new Error(`LLM 请求失败：HTTP ${String(response.status)} ${response.statusText}`.trim());
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const filter = new ReasoningFilter();
        // Owns the bubble-size bounds, the short-tail merge, and the reply-wide
        // budget. Kept separate from the SSE loop so those rules are testable
        // without a socket.
        const queue = new SpeechQueue();
        const display = (pieces) => {
            for (const piece of pieces)
                sinks.onSpeech?.(piece);
        };
        let reasoning = '';
        let text = '';
        let pending = '';
        // SSE frames are newline-delimited but a read can end mid-frame, so the
        // incomplete tail is carried into the next iteration.
        let carry = '';
        while (true) {
            const next = await reader.read();
            if (next.done)
                break;
            carry += decoder.decode(next.value, { stream: true });
            const lines = carry.split('\n');
            carry = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]')
                    continue;
                try {
                    const delta = JSON.parse(data).choices?.[0]?.delta ?? {};
                    // Shape 1: a dedicated reasoning field, never part of the reply.
                    if (typeof delta.reasoning_content === 'string')
                        reasoning += delta.reasoning_content;
                    if (typeof delta.reasoning === 'string')
                        reasoning += delta.reasoning;
                    const token = delta.content;
                    if (typeof token !== 'string' || token === '')
                        continue;
                    // Shape 2: reasoning inline in the content, filtered as it arrives.
                    const released = filter.push(token);
                    if (released === '')
                        continue;
                    text += released;
                    pending += released;
                    // Speak every complete piece; a run-on still gets broken by the budget.
                    for (;;) {
                        const taken = takeBubbleChunk(pending);
                        if (taken === undefined || taken.chunk === '' || taken.rest === pending)
                            break;
                        pending = taken.rest;
                        display(queue.push(taken.chunk));
                    }
                }
                catch { /* tolerate provider-specific SSE keepalive frames */ }
            }
        }
        const tail = filter.flush();
        text += tail;
        pending += tail;
        // Flush whatever the stream left short of a boundary, then let the queue
        // release the piece it was holding back for a possible merge.
        for (;;) {
            const taken = takeBubbleChunk(pending, true);
            if (taken === undefined || taken.rest === pending)
                break;
            pending = taken.rest;
            display(queue.push(taken.chunk));
        }
        display(queue.flush());
        const visible = text.trim();
        const thought = `${reasoning}${filter.reasoning()}`.trim();
        if (thought)
            sinks.onReasoning?.(thought);
        return visible;
    }
}
