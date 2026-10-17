# 导入 Live2D 模型

插件使用 Cubism 4 的 `pixi-live2d-display/cubism4` 渲染器，输入必须是一个完整 Live2D 模型文件夹，而不仅是 `.moc3` 文件。

## 目录格式

一个最小可用目录通常如下：

```text
MyCharacter/
  MyCharacter.model3.json
  MyCharacter.moc3
  textures/
    texture_00.png
  motions/                 # 可选，但推荐
  expressions/             # 可选
```

`model3.json` 内的路径必须仍相对于它自身所在目录有效。请保留原有目录层级、纹理、物理设置和动作文件。一个导入文件夹只能包含一个 `.model3.json`；将多个角色拆成不同文件夹后分别导入。

## 导入方式

**首选：DSH Web GUI → 设置 → Live2D 桌宠 → 模型 → 导入模型。**它会打开 DSH 原生的目录选择器，选中文件夹后：

1. 校验该文件夹只含一个 `.model3.json`（含多个会被拒绝并说明原因）；
2. 把整个文件夹**复制**到下面的用户模型目录（复制而非引用，原目录移动或改名后仍可加载）；
3. 自动重新扫描并立即出现在模型列表里，点「使用」即可切换，不需要重启 DSH 或宠物窗口。

删除同组的**删除模型**只删用户模型目录里的那份副本，不会碰你原来的文件夹。若删掉的正是当前模型，会自动回退到第一个可用模型。

## 手动导入

把整个 `MyCharacter` 文件夹复制到：

```text
~/.dsh/live2d-deskpet/models/MyCharacter/
```

重启 DSH，设置栏的模型列表即可看到它。插件启动时递归扫描该目录，所以也支持按作者/作品建立子文件夹。记住的模型若已从磁盘移除，会回退到第一个可用模型。

## 运行时导入 API

宿主的 `ModelRegistry.importFolder(path)` / `remove(id)` 由设置栏通过 Typert Remote 命名空间 `live2dDeskpet` 的 `importModel` / `removeModel` 调用。两个方法都做了路径逃逸防护：只能操作用户模型目录之内的路径。

## 动作映射

各模型的 Motion Group 名称不同，渲染器优先尝试常见的 `Idle`、`TapBody`、`FlickHead`。找不到时仅保留参数过渡/视线跟随，不会报错。若你的模型使用自定义动作组，可在 `src/electron/renderer.ts` 的 `applyState()` 中按模型名称增加映射后重新构建。

请自行确认模型、纹理和 Cubism SDK 的授权条款；本插件不附带任何第三方 Live2D 模型。

## Cubism 4 运行核

`pixi-live2d-display` 只负责驱动渲染，运行核要另行提供。把 `live2dcubismcore.min.js` 放到下列任一位置，或在设置栏的「模型」分组里填写 `Cubism 运行核路径`（文件或目录均可）：

```text
~/.dsh/live2d-deskpet/live2dcubismcore.min.js
<模型目录>/live2dcubismcore.min.js
```

运行核必须保留 `csmGetDrawableRenderOrders`：Cubism SDK 5-r.5 自带的 Core 6.0.1 已移除该 C API，而插件使用的 Cubism 4 framework 仍会调用它，加载后第一帧即报 `Cannot read properties of undefined (reading '0')`。官方 CDN 的 Core 5.1.0 可直接使用：

```text
https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js
```

填好路径后设置栏会显示运行核是否已就位；如果桌宠窗口先于运行核启动，运行核就位时窗口会自己重载，不需要重启。

渲染页面通过宿主提供的 HTTP 源读取模型资源，所以模型文件名可以用中文；但请确保 `model3.json` 内的相对路径与实际文件完全一致——从压缩包解压后常见的替换字符（`�`）文件名会让加载请求 404。
