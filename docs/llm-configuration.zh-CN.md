# 配置独立 LLM（LM Studio）

插件不借用 DSH 的模型配置。

**首选方式：DSH Web GUI → 设置 → Live2D 桌宠 → 陪伴 LLM。**改完立即生效，不需要重启。字段含义与热更新行为见 [设置栏](settings-panel.zh-CN.md)。

## 设置栏里怎么填

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:1234/v1` | 末尾的 `/v1` 可有可无；插件会自动补上 `/chat/completions` |
| `apiKey` | `lm-studio` | 只有需要鉴权的服务才填。**留空 = 不修改已保存的值** |
| `model` | `your-text-model` | 文本模型 |
| `visionModel` | `your-vision-model` | 截图陪伴用；纯文本模型可以留空 |
| `temperature` | `0.8` | 0–2 |

在 LM Studio 中启动 Local Server，并确认其 OpenAI-compatible API 已开启。纯文本模型可以将 `visionModel` 留空，但在截图截图驱动模式下应选择支持图片输入的模型；否则服务端会拒绝图像请求，宠物会保留在本地并在 DSH 日志中记录错误。

填完点**测试连接**：它会向 `baseUrl` 发一次 `/models` 请求，把可用模型列表或具体错误直接显示出来，不发送任何截图或对话。

## 配置文件方式（无 Web GUI 时）

没有 settings provider 时（例如没有 Web GUI、直接起窗口时），插件回落到：

```text
~/.dsh/live2d-deskpet/settings.json
```

编辑其中的 `llm` 字段，然后重启 DSH。**这个文件是可选的**：升级到本版本后，它的内容会在第一次启动时被一次性迁移进 `~/.dsh/settings.yaml` 的 `live2d-deskpet:` 段，之后设置栏才是权威来源。

```json
{
  "mode": "companion",
  "companionIntervalMinutes": 10,
  "screenshotsEnabled": true,
  "llm": {
    "baseUrl": "http://127.0.0.1:1234/v1",
    "apiKey": "lm-studio",
    "model": "your-text-or-vision-model",
    "visionModel": "your-vision-model",
    "temperature": 0.8
  }
}
```

请不要把含 Key 的配置文件提交到 Git。设置栏写入的 Key 以 secret 角色存放在 `~/.dsh/settings.yaml`，读取接口不会回显它的值。

## 模式含义

- `task`：仅由 DSH Agent 状态驱动动作。
- `companion`：按间隔截图、去重后调用独立 LLM。
- `auto`：Windows 下检测标题匹配 DSH/`127.0.0.1:3080` 且系统级置顶的窗口；检测为置顶时进入Agent驱动模式，否则进入截图驱动模式。非 Windows 或缺少可选原生窗口模块时会保留上次成功检测结果，建议手动选择模式。

设置栏会显示**当前实际生效**的模式：选 `auto` 时，它把此刻解析成的结果一并显示出来。

## 人设对 system message 的影响

陪伴 LLM 的 system message 由**当前激活的人设**的 `systemPrompt` 决定；人设未激活或 `systemPrompt` 为空白时，退回内置提示词（要求简短、自然、不侵扰，且不泄露屏幕上的敏感信息）。参见[设置栏 § 人设的数据结构](settings-panel.zh-CN.md#人设的数据结构)。
