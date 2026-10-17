/**
 * 截屏时随图注入的固定提示词。
 *
 * 定位：这是"用户回合"的上下文提示，不是人设。人设（persona.systemPrompt）走
 * system message，每次切换都会换；本模块的内容是**写死在项目里的常量**，不读
 * 任何配置、不读人设、不受设置页影响，所以换人设时它一个字都不会变。
 *
 * 为什么要固定：
 *   - 屏幕相关性的要求属于"这个功能怎么工作"，不属于"这个角色是谁"；
 *   - 人设卡是用户可编辑的自由文本，把约束塞进去等于让人设作者替我们写产品
 *     规则，换个卡就失效；
 *   - 分开两层之后，出问题能一眼判断是"人设没写好"还是"截屏上下文没注入"。
 *
 * 依赖约束：本文件会被打进 Electron 主进程与浏览器客户端两个沙箱，所以只允许
 * 纯函数，不 import 任何 node 内置模块（同 pet-section.js 的约定）。
 */

/** 前台应用未知时的占位，明确写成"未知"而不是留空——留空会让模型自己编。 */
export const UNKNOWN_FOREGROUND = '未知';

/**
 * 固定引导语。改这里等于改产品行为，改之前先确认：这句话与"某个具体人设"无关。
 */
export const SCREEN_CONTEXT_GUIDE = [
    '【屏幕上下文】',
    '你正在陪用户用电脑，下面是此刻屏幕上的真实情况，以及随本条消息附上的截图。',
    '',
    '【怎么用这份上下文】',
    '1. 先看截图，再决定说什么：优先聊屏幕上具体存在的东西——正在读的文字、界面上的状态、进度、报错、写到一半的内容，而不是"在忙吗""休息一下"这种放之四海皆准的话。',
    '2. 允许自由发挥：接话、吐槽、感慨、提一句具体建议、或者只是陪着看一眼，都可以；但必须和眼前这一屏有关系，让用户能感觉到"你确实看见了"。',
    '3. 看不清楚就不要编：截图模糊、信息不足，或者你只认得出应用名时，就围绕这个应用和它通常的用途说话，不要虚构屏幕上不存在的细节、数字和标题。',
    '4. 不要复述整屏文字，也不要念出密码、密钥、身份证号、聊天对象姓名等敏感信息；提到它们时只给模糊的概括。',
    '5. 不值得开口就不开口：如果这一屏没有任何值得说的，只回一个很短的语气词（例如"嗯……"），不要为了说话而说话。',
].join('\n');

/**
 * 把"当前时间 + 前台应用"整理成一行可读的上下文。
 * @param foreground - `{ app, title }`；缺失字段按"未知"处理。
 */
export function describeForeground(foreground) {
    const app = typeof foreground?.app === 'string' && foreground.app.trim() !== ''
        ? foreground.app.trim()
        : UNKNOWN_FOREGROUND;
    const title = typeof foreground?.title === 'string' ? foreground.title.trim() : '';
    if (title === '' || title === app)
        return `当前前台应用：${app}`;
    return `当前前台应用：${app}（窗口标题：${title}）`;
}

/**
 * 组装随截图一起发出的用户回合文本。
 *
 * 时间与前台应用每次都不同，引导语恒定——两者拼在一起，保证"注入时机与截屏
 * 动作绑定"：只有真正截了屏的那一次调用才会带上它。
 * @param options.now - 已格式化的本地时间字符串。
 * @param options.foreground - {@link describeForeground} 的输入。
 * @param options.extra - 可选的补充行（例如"上一次搭话距今 12 分钟"）。
 */
export function buildScreenContextPrompt(options) {
    const now = typeof options?.now === 'string' && options.now.trim() !== '' ? options.now.trim() : UNKNOWN_FOREGROUND;
    const lines = [
        `当前时间：${now}`,
        describeForeground(options?.foreground),
    ];
    const extra = typeof options?.extra === 'string' ? options.extra.trim() : '';
    if (extra !== '')
        lines.push(extra);
    return `${lines.join('\n')}\n\n${SCREEN_CONTEXT_GUIDE}`;
}
