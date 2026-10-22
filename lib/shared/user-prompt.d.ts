/** 截断长度：任务描述最多这么多字。 */
export declare const TASK_TEXT_MAX_CHARS: number;
/** 压平空白 + 截断。 */
export declare function sanitizeTaskText(text?: string | null): string;
/** 从 `session/event` 的 `user/message` 里取出用户这一回合的请求文本。 */
export declare function extractUserPromptText(event?: {
    type?: string;
    data?: unknown;
} | null): string;
