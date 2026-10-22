window.__ModuleLoader__.load({
	id: "dsh-live2d-deskpet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		"use strict";
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name2 in all)
		    __defProp(target, name2, { get: all[name2], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// src/client/index.ts
		var index_exports = {};
		__export(index_exports, {
		  DESKPET_LOCALE_NAMESPACE: () => DESKPET_LOCALE_NAMESPACE,
		  apply: () => apply,
		  inject: () => inject,
		  name: () => name
		});
		module.exports = __toCommonJS(index_exports);

		// src/shared/deskpet-invocations.ts
		var DESKPET_REMOTE_PARAMETERS = {
		  getState: [],
		  setConfig: [{ name: "patch", typeSymbol: "DeskpetConfigPatch" }],
		  importModel: [],
		  removeModel: [{ name: "id", typeSymbol: "ModelId" }],
		  testLlm: [
		    { name: "baseUrl", typeSymbol: "BaseUrl" },
		    { name: "apiKey", typeSymbol: "ApiKey", optional: true },
		    { name: "model", typeSymbol: "ModelName", optional: true }
		  ],
		  openModelsFolder: [],
		  // 0.1.7：一键清空陪伴记忆（turns.jsonl），无参数。
		  clearCompanionMemory: []
		};
		var DESKPET_REMOTE_METHODS = Object.keys(DESKPET_REMOTE_PARAMETERS);
		function deskpetRemoteParameters(method) {
		  return DESKPET_REMOTE_PARAMETERS[method] ?? [];
		}

		// src/client/task-observer.ts
		// ── 页面内任务节点观察器 ──────────────────────────────────────────────
		// 桌宠窗口是独立的 Electron 进程，看不到 DSH 的 DOM；而这段客户端代码就跑在
		// DSH 页面里，能看见。所以这里只做一件事：把"某个任务节点发生了"通过固定
		// 端口的 POST 告诉宿主，宿主再转给桌宠窗口播报（中文气泡 + 日语语音）。
		//
		// 三个节点与各自的锚点（0.2.7 全部对照 app.asar 核实过）：
		//   done    [data-turn-tail]       回合结束页脚（TurnTailNodeView 的根）
		//   confirm [data-approval-key]    审批面板（ApprovalPanel 的根），不是 dialog
		//   start   —                      不在这里：由宿主按 agent 状态翻转派发
		//
		// 这里的启发式只负责"我看到了"，判重与冷却全部在宿主。
		var TASK_CHANNEL_PORT = 9879;
		/** 宿主实际监听的端口（配置项，挂载后从 runtime 里读回来）。 */
		var taskChannelPort = TASK_CHANNEL_PORT;
		var TASK_VERIFY_MS = 400;
		var TASK_BULK_MS = 600;
		var TASK_BULK_THRESHOLD = 3;
		var TASK_WARMUP_MS = 3000;

		function postTaskEvent(kind, detail) {
		  try {
		    // text/plain 属于 CORS 简单请求：不触发预检，页面跨端口也能直接发。
		    void fetch("http://127.0.0.1:" + taskChannelPort + "/task-event", {
		      method: "POST",
		      headers: { "Content-Type": "text/plain;charset=UTF-8" },
		      body: JSON.stringify({ kind: kind, detail: String(detail || "").slice(0, 120) }),
		      keepalive: true
		    }).catch(function () {});
		  } catch (e) { /* 通道不通不影响页面 */ }
		}

		/**
		 * 装上观察器，返回拆除函数。
		 *
		 * 任何异常都在这里吞掉：桌面版 web-boot 把客户端 entry 的失败当成致命错误，
		 * 会摘掉全部第三方插件并重启进安全模式——一个可选的语音功能不值得这个代价。
		 */
		function installTaskObserver() {
		  if (typeof document === "undefined" || !document.body) return function () {};
		  var seenTurns = new WeakSet();
		  var seenTurnIds = {};
		  var seenTurnCount = 0;
		  var lastConfirmKey = "";
		  var lastConfirmAt = 0;
		  var pendingDone = 0;
		  var warmupUntil = Date.now() + TASK_WARMUP_MS;
		  /** 每个页脚"等文本补齐"的次数：见 scheduleDoneCheck。 */
		  var doneRetry = new WeakMap();

		  function turnKeyOf(el) {
		    try {
		      var id = el.getAttribute("data-turn-tail");
		      if (id !== null && id !== "") return "id:" + id;
		    } catch (e) { /* ignore */ }
		    return "";
		  }
		  function isSeenTurn(el) {
		    var key = turnKeyOf(el);
		    if (key !== "" && seenTurnIds[key] === true) return true;
		    return seenTurns.has(el);
		  }
		  function markTurn(el) {
		    var key = turnKeyOf(el);
		    if (key !== "") {
		      // 翻历史会不停产生新 id，给个上限避免无限增长
		      if (seenTurnCount > 500) {
		        seenTurnIds = {};
		        seenTurnCount = 0;
		      }
		      if (seenTurnIds[key] !== true) {
		        seenTurnIds[key] = true;
		        seenTurnCount += 1;
		      }
		    }
		    seenTurns.add(el);
		  }
		  /**
		   * 审批面板：DSH 的权限确认**不是** `dialog` / `role="dialog"`，而是
		   * `div.ApprovalPanel.root[data-approval-key]`（0.2.7 从 app.asar 里核实的
		   * 真实结构）。旧实现找 dialog，永远找不到——所以弹选择框时 confirm 这条
		   * 根本不触发，只能被别的事件顶上（实测被 start 顶成了"了解，我开始动手了"）。
		   *
		   * 结构（approval-panel 组件）：
		   *   div[data-approval-key][aria-busy]        ← 根，aria-busy 为 true 表示已答
		   *     div.card > div.strip（等待提示）
		   *              > div.body > div.headline     ← 人话标题，含 toolName
		   *                         > div.command      ← 可选，具体命令
		   *              > div.actionRow > button（拒绝） + button（允许一次）
		   */
		  function findApproval(node) {
		    var panel = null;
		    try {
		      if (node.matches && node.matches("[data-approval-key]")) panel = node;
		      else if (node.closest) panel = node.closest("[data-approval-key]");
		      if (!panel && node.querySelector) panel = node.querySelector("[data-approval-key]");
		    } catch (e) { /* ignore */ }
		    if (!panel) return null;
		    // 已经点过（或键盘答过）：面板还挂在树上但 aria-busy=true，不该再播。
		    try {
		      if (panel.getAttribute("aria-busy") === "true") return null;
		    } catch (e) { /* ignore */ }
		    var headline = "";
		    var command = "";
		    try {
		      var head = panel.querySelector('[class*="headline" i]');
		      if (head) headline = (head.textContent || "").trim();
		      var cmd = panel.querySelector('[class*="command" i]');
		      if (cmd) command = (cmd.textContent || "").trim();
		    } catch (e) { /* ignore */ }
		    // detail 用标题（含工具名）优先，退到命令；都空就给空串，交给宿主用固定文案。
		    var detail = (headline || command).slice(0, 60);
		    var key = "";
		    try { key = panel.getAttribute("data-approval-key") || ""; } catch (e) { /* ignore */ }
		    return { panel: panel, key: key || detail, detail: detail };
		  }
		  function findTurnTail(node) {
		    try {
		      if (node.matches && node.matches("[data-turn-tail]")) return node;
		      if (node.closest) {
		        var up = node.closest("[data-turn-tail]");
		        if (up) return up;
		      }
		      if (node.querySelector) return node.querySelector("[data-turn-tail]");
		    } catch (e) { /* ignore */ }
		    return null;
		  }
		  /**
		   * 确认播报：延迟 400ms 再看面板还在不在。
		   * 面板关闭动画、React 重渲染都会留下"看起来还在"的节点，等一拍就能滤掉；
		   * 同时再看一次 aria-busy——这 400ms 里用户可能已经点掉了。
		   */
		  function announceConfirm(info) {
		    var panel = info.panel;
		    setTimeout(function () {
		      var alive = false;
		      try {
		        alive = document.contains(panel) && panel.getAttribute("aria-busy") !== "true";
		      } catch (e) { /* ignore */ }
		      if (!alive) return;
		      var now = Date.now();
		      if (info.key === lastConfirmKey && now - lastConfirmAt < 8000) return;
		      lastConfirmKey = info.key;
		      lastConfirmAt = now;
		      postTaskEvent("confirm", info.detail);
		    }, TASK_VERIFY_MS);
		  }
		  /**
		   * 回合结束：等 0.6s 再数一次"没见过的页脚"。
		   * 一次冒出 3 个以上 = 切会话/翻历史的重建，不是"刚完成了一个任务"。
		   */
		  function scheduleDoneCheck() {
		    if (pendingDone) clearTimeout(pendingDone);
		    pendingDone = setTimeout(function () {
		      pendingDone = 0;
		      if (Date.now() < warmupUntil) return;
		      if (!baselined) {
		        baselined = true;
		        try {
		          Array.prototype.forEach.call(document.querySelectorAll("[data-turn-tail]"), markTurn);
		        } catch (e) { /* ignore */ }
		        return;
		      }
		      var fresh = [];
		      try {
		        Array.prototype.forEach.call(document.querySelectorAll("[data-turn-tail]"), function (el) {
		          if (!isSeenTurn(el)) fresh.push(el);
		        });
		      } catch (e) { /* ignore */ }
		      if (fresh.length === 0) return;
		      if (fresh.length >= TASK_BULK_THRESHOLD) {
		        fresh.forEach(markTurn);
		        return;
		      }
		      var last = fresh[fresh.length - 1];
		      var text = "";
		      try { text = (last.textContent || "").trim(); } catch (e) { /* ignore */ }
		      // 页脚先插节点、后填指标文本，所以空文本要再等一拍。但**只能等一次**：
		      // 默认布局下页脚里只有图标和一句时间，`textContent` 可能一直是空——旧
		      // 实现在这里直接 return，于是"任务完成"这一条在 Agent 模式下永远不播。
		      // 现在的做法是：给一次补文本的机会，仍然为空就照播（detail 留空）。
		      if (text === "") {
		        var tries = (doneRetry.get(last) || 0) + 1;
		        doneRetry.set(last, tries);
		        if (tries < 2) {
		          scheduleDoneCheck();
		          return;
		        }
		      }
		      fresh.forEach(markTurn);
		      postTaskEvent("done", text.slice(0, 60));
		    }, TASK_BULK_MS);
		  }
		  // 第一次检查只做基线：把"安装时页面上已有的页脚"全部记为看过。那是历史
		  // 记录，不是刚完成的任务。旧实现没有这一步，页面里本来就有 1–2 个回合时，
		  // 第一次 DOM 变动会把它们当成新回合白播一次。
		  var baselined = false;

		  var observer = new MutationObserver(function (records) {		    if (Date.now() < warmupUntil) return;
		    var sawTurn = false;
		    for (var i = 0; i < records.length; i += 1) {
		      var record = records[i];
		      if (record.type === "attributes") {
		        // 0.2.7：这里原本在 `[data-streaming]` 出现时发 start。查 app.asar 后
		        // 发现那个属性挂在**推理行（ReasoningRow）的摘要**上（`running || void 0`），
		        // 不是一个回合的开始——一回合里推理行可能反复出现，于是 start 会被
		        // 重复播报，正好赶在审批弹窗弹出的时候（用户实测："弹选择框，她回
		        // 了解，我开始动手了"）。
		        // start 现在改由宿主按 agent 状态翻转（闲 → 忙）派发，页面不再参与。
		        continue;
		      }
		      if (record.type === "characterData") {
		        // 页脚指标文本后填：文本落进来时再看一眼是不是还没播过
		        try {
		          var parent = record.target && record.target.parentElement;
		          var owner = parent ? findTurnTail(parent) : null;
		          if (owner && !isSeenTurn(owner)) sawTurn = true;
		        } catch (e) { /* ignore */ }
		        continue;
		      }
		      var added = record.addedNodes;
		      for (var j = 0; j < added.length; j += 1) {
		        var node = added[j];
		        if (!node || node.nodeType !== 1) continue;
		        var confirm = findApproval(node);
		        if (confirm) announceConfirm(confirm);
		        var tail = findTurnTail(node);
		        if (tail && !isSeenTurn(tail)) sawTurn = true;
		      }
		    }
		    if (sawTurn) scheduleDoneCheck();
		  });
		  observer.observe(document.body, {
		    childList: true,
		    subtree: true,
		    characterData: true
		  });
		  return function () {
		    try { observer.disconnect(); } catch (e) { /* ignore */ }
		    if (pendingDone) clearTimeout(pendingDone);
		  };
		}

		// src/client/page-focus.ts
		// ── 页面焦点上报 ────────────────────────────────────────────────
		// 桌宠要回答一个问题：用户此刻是不是就在 DSH 页面前面？答案决定自动模式
		// 落在 Agent驱动（不截屏）还是截图驱动（看屏幕）。
		//
		// 为什么由页面自己报：Electron 那边原来靠 node-window-manager 读"DSH 窗口
		// 有没有被钉在顶层"，那既不是"是否在前台"（普通前台窗口不是 topmost），
		// 在原生模块没编译的机器上还会永远返回 false——于是 agent 一闲下来就判成
		// 截图驱动，人坐在 DSH 里看代码却被搭话。页面自己知道答案：
		// document.hasFocus() 就是"这个页面现在有没有键盘焦点"，零成本、零依赖。
		function installPageFocusReporter() {
		  if (typeof document === "undefined" || typeof window === "undefined") return function () {};
		  var last = null;
		  var heartbeat = 0;
		  function post(focused) {
		    try {
		      // text/plain 属于 CORS 简单请求：不触发预检，跨端口也能直接发。
		      void fetch("http://127.0.0.1:" + taskChannelPort + "/page-focus", {
		        method: "POST",
		        headers: { "Content-Type": "text/plain;charset=UTF-8" },
		        body: JSON.stringify({ focused: focused === true }),
		        keepalive: true
		      }).catch(function () {});
		    } catch (e) { /* 通道不通不影响页面 */ }
		  }
		  /** force=true 时即使没变化也发一次：宿主重启后不必等下一次 focus/blur。 */
		  function sync(force) {
		    var focused = false;
		    try { focused = document.hasFocus() === true && document.visibilityState !== "hidden"; } catch (e) { /* ignore */ }
		    if (!force && focused === last) return;
		    last = focused;
		    post(focused);
		  }
		  function onChange() { sync(false); }
		  window.addEventListener("focus", onChange);
		  window.addEventListener("blur", onChange);
		  document.addEventListener("visibilitychange", onChange);
		  sync(false);
		  // 30 秒一次心跳：只多一个 loopback POST，换来"宿主重启后自动恢复"。
		  heartbeat = setInterval(function () { sync(true); }, 30000);
		  return function () {
		    try {
		      window.removeEventListener("focus", onChange);
		      window.removeEventListener("blur", onChange);
		      document.removeEventListener("visibilitychange", onChange);
		      if (heartbeat) clearInterval(heartbeat);
		    } catch (e) { /* ignore */ }
		  };
		}

		// src/client/deskpet-remote.ts
		var DESKPET_REMOTE_NAMESPACE = "live2dDeskpet";
		var DESKPET_SETTINGS_NAMESPACE = "live2d-deskpet";
		// 0.2.x 客户端契约（对照 dsh-cosplay，两条都踩过坑）：
		//   - 参数 codec 必须是 strict 且带 create 工厂（dsh-api-gateway 的
		//     requireStrictInputs 对每个参数断言 mode === "strict"），create 只作校验
		//     令牌、永不被调用，故 () => ({}) 即可；
		//   - result 用 src-json（宿主侧 strict 会被 typert-registry 拒绝，两边必须一致）。
		var strictCodec = (typeSymbol) => ({ mode: "strict", typeSymbol, create: () => ({}) });
		var resultCodec = (typeSymbol) => ({ mode: "src-json", typeSymbol });
		var DESKPET_RESULT_SYMBOLS = { setConfig: "DeskpetWriteResult" };
		function deskpetInvocationDescriptors() {
		  const invocation = (method, resultSymbol = "DeskpetRuntimeResult") => ({
		    id: `dsh-live2d-deskpet#${DESKPET_REMOTE_NAMESPACE}/${method}`,
		    service: DESKPET_REMOTE_NAMESPACE,
		    namespace: DESKPET_REMOTE_NAMESPACE,
		    method,
		    invocation: { kind: "direct" },
		    parameters: deskpetRemoteParameters(method).map((parameter) => ({
		      name: parameter.name,
		      wire: parameter.name,
		      source: "json",
		      codec: strictCodec(parameter.typeSymbol),
		      // A missing wire field is only allowed where the host declares `T | undefined`.
		      ...parameter.optional === true ? { acceptsUndefined: true } : {}
		    })),
		    result: resultCodec(DESKPET_RESULT_SYMBOLS[method] ?? resultSymbol)
		  });
		  return DESKPET_REMOTE_METHODS.map((method) => invocation(method));
		}
		var DESKPET_REMOTE = {
		  package: "dsh-live2d-deskpet",
		  descriptors: deskpetInvocationDescriptors()
		};

		// src/shared/settings-path.ts
		function parseFieldPath(field) {
		  if (typeof field !== "string") return [...field];
		  return field.split(".").filter((segment) => segment !== "");
		}

		// src/shared/bubble-speech.ts
		var BUBBLE_MIN_CHARS = 20;
		var BUBBLE_MAX_CHARS = 40;
		var REPLY_MIN_CHARS = 30;
		var REPLY_MAX_CHARS = 60;

		// src/shared/pet-section.ts
		var COMPANION_SPEECH_STYLE = `\u3010\u8BF4\u8BDD\u65B9\u5F0F\u3011\u50CF\u771F\u4EBA\u95F2\u804A\u90A3\u6837\u65AD\u53E5\uFF1A\u6BCF\u6B21\u56DE\u5E94\u7528\u4E2D\u6587\u8BF4 ${String(REPLY_MIN_CHARS)} \u5230 ${String(REPLY_MAX_CHARS)} \u4E2A\u5B57\uFF0C\u62C6\u6210\u4E24\u4E09\u53E5\uFF0C\u6BCF\u53E5 ${String(BUBBLE_MIN_CHARS)} \u5230 ${String(BUBBLE_MAX_CHARS)} \u4E2A\u5B57\uFF1B\u4E0D\u8981\u8F93\u51FA\u957F\u6BB5\u843D\uFF0C\u4E5F\u4E0D\u8981\u7F57\u5217\u6761\u76EE\u3002`;
		var COSPLAY_EXTENSION_KEY = "dshCosplay";
		var DESKPET_EXTENSION_KEY = "dsh-live2d-deskpet";
		var PROMPT_SOURCE_FIELDS = [
		  "description",
		  "personality",
		  "style",
		  "rules",
		  "behavior",
		  "scenario",
		  "mes_example"
		];
		function textField(source, key) {
		  const value = source[key];
		  return typeof value === "string" && value.trim() ? value : void 0;
		}
		function objectField(source, key) {
		  const value = source[key];
		  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function composeSystemPrompt(source) {
		  const parts = [];
		  const explicit = textField(source, "system_prompt");
		  if (explicit) parts.push(explicit);
		  for (const field of PROMPT_SOURCE_FIELDS) {
		    const value = textField(source, field);
		    if (value === void 0) continue;
		    if (parts.some((part) => part.includes(value))) continue;
		    parts.push(value);
		  }
		  return parts.join("\n");
		}
		function isCosplayRole(value) {
		  if (typeof value !== "object" || value === null) return false;
		  const role = value;
		  return typeof role.id === "string" && role.id !== "" && typeof role.name === "string" && role.name !== "";
		}
		function personaFromCosplayRole(role) {
		  if (!isCosplayRole(role)) throw new Error("\u8FD9\u4E0D\u662F\u4E00\u6761 dsh-cosplay \u89D2\u8272\u5361\u3002");
		  const source = role;
		  return {
		    id: source.id,
		    name: source.name.trim(),
		    emoji: typeof source.emoji === "string" ? source.emoji : "",
		    systemPrompt: composeSystemPrompt(source),
		    greeting: typeof source.first_mes === "string" ? source.first_mes : "",
		    description: textField(source, "creator_notes") ?? textField(source, "description") ?? "",
		    tags: Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === "string") : []
		  };
		}
		function toV2Card(persona) {
		  const data = { name: persona.name };
		  if (persona.systemPrompt) data.system_prompt = persona.systemPrompt;
		  if (persona.greeting) data.first_mes = persona.greeting;
		  if (persona.description) data.description = persona.description;
		  if (persona.tags?.length) data.tags = [...persona.tags];
		  const shared = { id: persona.id, ...persona.emoji ? { emoji: persona.emoji } : {} };
		  data.extensions = {
		    [DESKPET_EXTENSION_KEY]: {
		      ...shared,
		      name: persona.name,
		      systemPrompt: persona.systemPrompt,
		      greeting: persona.greeting,
		      description: persona.description,
		      tags: [...persona.tags ?? []]
		    },
		    [COSPLAY_EXTENSION_KEY]: shared
		  };
		  return { spec: "chara_card_v2", spec_version: "2.0", data };
		}
		function personaFromOwnExtension(block, fallbackName) {
		  if (typeof block.id !== "string" || block.id === "") return void 0;
		  if (typeof block.systemPrompt !== "string") return void 0;
		  return {
		    id: block.id,
		    name: typeof block.name === "string" && block.name.trim() ? block.name.trim() : fallbackName,
		    emoji: typeof block.emoji === "string" ? block.emoji : "",
		    systemPrompt: block.systemPrompt,
		    greeting: typeof block.greeting === "string" ? block.greeting : "",
		    description: typeof block.description === "string" ? block.description : "",
		    tags: Array.isArray(block.tags) ? block.tags.filter((tag) => typeof tag === "string") : []
		  };
		}
		function fromV2Card(card) {
		  const data = typeof card === "object" && card !== null ? card.data ?? card : {};
		  if (typeof data !== "object" || data === null) throw new Error("\u5BFC\u5165\u7684\u89D2\u8272\u5361\u4E0D\u662F\u6709\u6548\u7684 JSON \u5BF9\u8C61\u3002");
		  const name2 = typeof data.name === "string" ? data.name.trim() : "";
		  if (!name2) throw new Error("\u5BFC\u5165\u7684\u89D2\u8272\u5361\u7F3A\u5C11 name \u5B57\u6BB5\u3002");
		  const extensions = objectField(data, "extensions");
		  const cosplay = objectField(extensions, COSPLAY_EXTENSION_KEY);
		  const own = objectField(extensions, DESKPET_EXTENSION_KEY);
		  const restored = personaFromOwnExtension(own, name2);
		  if (restored !== void 0) return restored;
		  const identity = typeof own.id === "string" && own.id !== "" ? own : cosplay;
		  const persona = {
		    id: typeof identity.id === "string" && identity.id ? identity.id : newPersonaId(),
		    name: name2,
		    systemPrompt: composeSystemPrompt({ ...cosplay, ...data }),
		    emoji: typeof identity.emoji === "string" ? identity.emoji : "",
		    greeting: typeof data.first_mes === "string" ? data.first_mes : "",
		    description: textField(data, "creator_notes") ?? textField(data, "description") ?? "",
		    tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === "string") : []
		  };
		  return persona;
		}
		function newPersonaId() {
		  return `persona-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		}

		// src/client/section-store.ts
		var COSPLAY_NAMESPACE = "cosplay";
		function cosplayRolesFrom(value) {
		  const roles = value?.roles;
		  if (!Array.isArray(roles)) return [];
		  const mapped = [];
		  for (const role of roles) {
		    if (!isCosplayRole(role)) continue;
		    try {
		      mapped.push(personaFromCosplayRole(role));
		    } catch {
		    }
		  }
		  return mapped;
		}
		function describeSettingsFailure(error) {
		  const suffix = `\uFF08${error.code}\uFF09`;
		  if (error.code === "settings/rejected" && error.message.includes("writer lock")) {
		    return `\u8BBE\u7F6E\u5199\u5165\u88AB\u5360\u7528\u8D85\u65F6\uFF1A\u53E6\u4E00\u4E2A DSH \u8FDB\u7A0B\u6301\u6709 settings.yaml \u7684\u5199\u9501\u3002\u5173\u95ED\u591A\u4F59\u7684 DSH \u5B9E\u4F8B\u540E\u91CD\u8BD5\uFF1B\u82E5\u8BE5\u6587\u4EF6\u662F\u4E0A\u6B21\u5F02\u5E38\u9000\u51FA\u7559\u4E0B\u7684\uFF0C\u5220\u9664 ${"settings.yaml.lock"} \u5373\u53EF\u3002${suffix}`;
		  }
		  if (error.code === "settings/conflict") {
		    return `\u8BBE\u7F6E\u5DF2\u88AB\u5176\u5B83\u9875\u9762\u4FEE\u6539\uFF0C\u8BF7\u91CD\u8BD5\u3002${suffix}`;
		  }
		  return `\u8BBE\u7F6E\u5199\u5165\u5931\u8D25\uFF1A${error.message}${suffix}`;
		}
		var INITIAL = {
		  status: "loading",
		  section: {},
		  remote: void 0,
		  cosplay: [],
		  error: null,
		  write: "idle",
		  message: null
		};
		function createSnapshotStore(initial) {
		  let snapshot = initial;
		  const listeners = /* @__PURE__ */ new Set();
		  return {
		    getSnapshot: () => snapshot,
		    set(next) {
		      snapshot = next;
		      for (const listener of [...listeners]) listener();
		    },
		    subscribe(listener) {
		      listeners.add(listener);
		      return () => {
		        listeners.delete(listener);
		      };
		    }
		  };
		}
				var DeskpetController = class {
		  constructor(ctx) {
		    this.ctx = ctx;
		  }
		  store = createSnapshotStore(INITIAL);
		  remote;
		  /** 0.2：设置值在本插件 Remote 的 config 里（宿主行内 Config）。
		   * 合法访问口只有两个：$mount 后 attachRemote 塞进来的实例，以及
		   * `ctx.reflect.get('remote.<ns>')`；直接读 `ctx.remote.<ns>` 未声明会抛
		   * `without inject`，必须避免。 */
		  get remoteApi() {
		    if (this.remote) return this.remote;
		    try { return this.ctx.reflect.get(`remote.${DESKPET_REMOTE_NAMESPACE}`); } catch { return void 0; }
		  }
		  /** Bind the Remote namespace the host mounted; called once after `$mount`. */
		  attachRemote(api) {
		    this.remote = api;
		  }
		  set(patch) {
		    this.store.set({ ...this.store.getSnapshot(), ...patch });
		  }
		  /**
		   * Subscribe to the settings namespace, then read the Remote state once.
		   * A namespace the client cannot see settles the store as `unavailable` and
		   * the section renders its own unavailable copy.
		   */
		  load() {
		    const refresh = async () => {
		      const api = this.remoteApi;
		      if (!api) { this.set({ status: "unavailable", error: null }); return; }
		      try {
		        const response = await api.getState();
		        if (!response.ok || !response.value) {
		          this.set({ status: "unavailable", error: response.error?.message ?? null });
		          return;
		        }
		        const config = response.value.config ?? {};
		        const current = this.store.getSnapshot();
		        const sectionChanged = JSON.stringify(config) !== JSON.stringify(current.section);
		        if (sectionChanged || current.status !== "ready") this.set({ status: "ready", section: config, error: null });
		      } catch {
		        /* 轮询失败保持上一次的值 */
		      }
		    };
		    void refresh();
		    const timer = setInterval(() => void refresh(), 2500);
		    const disposeCosplay = this.observeCosplay();
		    void this.refreshRemote();
		    // 运行态也要跟着变：桥的 ready/错误、密钥掩码、最近一次截屏都是宿主
		    // 实时观测到的事实。原来只在挂载时读一次，于是桥早已就绪，设置页还停在
		    // 启动那一刻的"语音桥无响应"上——误报会一直挂到用户刷新整页。
		    const remoteTimer = setInterval(() => void this.refreshRemote(), 5e3);
		    return () => {
		      clearInterval(timer);
		      clearInterval(remoteTimer);
		      disposeCosplay();
		    };
		  }
		  /**
		   * Mirror dsh-cosplay's role library, when that plugin is installed.
		   *
		   * Reusing its namespace keeps one role library for both plugins: a card a user
		   * already wrote for cosplay is offered here directly, with no export/import
		   * round trip. This only ever READS the namespace — cosplay owns its document.
		   */
		  /** dsh-cosplay 的角色库走它自己的 Remote（0.2 无 namespace 通道）。 */
		  observeCosplay() {
		    let disposed = false;
		    let api;
		    try { api = this.ctx.remote?.cosplay; } catch { api = void 0; }
		    const read = async () => {
		      if (disposed || !api) return;
		      try {
		        const response = await api.getState();
		        if (response.ok && response.value) {
		          this.set({ cosplay: cosplayRolesFrom(valueOfCosplayState(response.value)) });
		        }
		      } catch { /* cosplay 未就绪：保持现状 */ }
		    };
		    void read();
		    const timer = setInterval(() => void read(), 4000);
		    return () => { disposed = true; clearInterval(timer); };
		  }
		  /** No-op kept for shape compatibility. */
		  cosplayScope() {
		    return void 0;
		  }
		  /** Re-read the Remote half (models, runtime facts). */
		  async refreshRemote() {
		    const api = this.remote;
		    if (!api) {
		      this.set({ remote: void 0, error: "\u684C\u5BA0 Remote \u901A\u9053\u672A\u6302\u8F7D\u3002" });
		      return;
		    }
		    try {
		      const response = await api.getState();
		      if (!response.ok || !response.value) {
		        this.set({ error: response.error?.message ?? "\u8BFB\u53D6\u684C\u5BA0\u8FD0\u884C\u6001\u5931\u8D25\u3002" });
		        return;
		      }
		      // 轮询每 5s 一次，快照没变就不写 store：否则整页每 5s 重渲染一次，
		      // 输入框虽然不会被清空，滚动位置和焦点却会被打断。整份比对而不是只比
		      // runtime——模型列表变化时 runtime 是不动的。
		      const previous = this.store.getSnapshot().remote;
		      const port = Number(response.value && response.value.runtime ? response.value.runtime.taskChannelPort : 0);
		      if (Number.isFinite(port) && port > 0) taskChannelPort = port;
		      const unchanged = previous !== void 0 && JSON.stringify(previous) === JSON.stringify(response.value);
		      if (unchanged) {
		        if (this.store.getSnapshot().status !== "ready") this.set({ status: "ready", error: null });
		        return;
		      }
		      this.set({ remote: response.value, status: "ready", error: null });
		    } catch (error) {
		      this.set({ error: error.message });
		    }
		  }
		  /** Write one durable field, reporting the outcome beside the control. */
		  async write(field, value) {
		    return this.commit([{ op: "set", path: parseFieldPath(field), value }]);
		  }
		  /** Fold a list of {op,path,value} ops into one nested patch object (set only). */
		  opsToPatch(ops) {
		    const patch = {};
		    for (const op of ops) {
		      if (op.op !== "set") continue;
		      let cursor = patch;
		      const segments = Array.isArray(op.path) ? op.path : [op.path];
		      for (let depth = 0; depth < segments.length - 1; depth++) {
		        const seg = segments[depth];
		        if (typeof cursor[seg] !== "object" || cursor[seg] === null || Array.isArray(cursor[seg])) cursor[seg] = {};
		        cursor = cursor[seg];
		      }
		      cursor[segments[segments.length - 1]] = op.value;
		    }
		    return patch;
		  }
		  /** Clear one durable field: set it to an empty default (write path is merge-only in 0.2). */
		  async clear(field) {
		    const reset = { "llm.apiKey": "", "voice.translateApiKey": "" };
		    const key = String(field);
		    return this.commit([{ op: "set", path: parseFieldPath(field), value: key in reset ? reset[key] : "" }]);
		  }
		  /** Atomically write several durable fields (persona edits, window geometry). */
		  async mutate(ops) {
		    const onlySet = ops.filter((op) => op.op !== "unset");
		    return this.commit(onlySet.map((op) => op.op === "unset" ? { op: "unset", path: parseFieldPath(op.path) } : { op: "set", path: parseFieldPath(op.path), value: op.value }));
		  }
		  /**
		   * Send path ops to the host, then fold the answer into the shared mirror.
		   *
		   * This deliberately does NOT go through `SettingsScope.mutate`: that method
		   * swallows every host rejection (`if (!response.ok) { await recover(); return }`),
		   * so a refused write resolves as success and the surface reports "saved" for
		   * an edit that never landed. Talking to the namespace's own transport returns
		   * the error, and `acceptView` keeps the mirror — and so the panel — in step
		   * without a second wire read.
		   *
		   * The write is sent WITHOUT a revision fence on purpose. The fence is what the
		   * panel used to trip over: the deskpet host rewrites window geometry whenever
		   * the window is resized or moved, which bumps the namespace revision, so a
		   * click carrying the revision the panel last saw was rejected as a conflict
		   * and silently dropped. `mutate` applies its ops to the section as stored at
		   * the front of the host queue and only touches the named paths, so writing
		   * unconditionally cannot lose a concurrent edit to a different field.
		   */
		  /**
		   * 0.2 写路径：把 ops 折叠成嵌套 patch，交给宿主 Remote 的 setConfig。
		   * 清除字段只能用"设空值"表达（合并写入没有 unset 语义），与设置页
		   * 把 secret 留空 = 保持原值的约定一致。
		   */
		  async commit(ops) {
		    this.set({ write: "saving", message: null });
		    if (ops.length === 0) return { ok: true };
		    const api = this.remoteApi;
		    if (!api) {
		      const message = "桌宠 Remote 通道未挂载。";
		      this.set({ write: "failed", message });
		      return { ok: false, message };
		    }
		    try {
		      const response = await api.setConfig(this.opsToPatch(ops));
		      if (!response.ok) {
		        const message = response.error?.message ?? "设置写入失败。";
		        this.set({ write: "failed", message });
		        return { ok: false, message };
		      }
		      this.set({ write: "saved", message: null });
		      void this.refreshRemote();
		      return { ok: true };
		    } catch (error) {
		      const message = error.message;
		      this.set({ write: "failed", message });
		      return { ok: false, message };
		    }
		  }
		  /**
		   * The host transport for this namespace, structurally typed to avoid a value
		   * import. Reading it is defensive on purpose: Cordis throws
		   * `cannot get property "remote.settings" without inject` when the namespace
		   * key is not declared, and that throw used to escape the caller before any
		   * write was attempted — every control in the panel died on click. A missing
		   * transport now degrades to the scope path instead of breaking the section.
		   */
		  writeTransport() {
		    try {
		      const remote = this.ctx.remote;
		      return remote?.settings;
		    } catch {
		      return void 0;
		    }
		  }

		  /** Import a model folder through the host's native picker. */
		  async importModel() {
		    const api = this.remote;
		    if (!api) return "\u684C\u5BA0 Remote \u901A\u9053\u672A\u6302\u8F7D\u3002";
		    try {
		      const response = await api.importModel();
		      if (!response.ok || !response.value) return response.error?.message ?? "\u5BFC\u5165\u5931\u8D25\u3002";
		      if (response.value.cancelled) return null;
		      if (response.value.error) return response.value.error;
		      await this.refreshRemote();
		      return null;
		    } catch (error) {
		      return error.message;
		    }
		  }
		  /** Delete one model folder through the host. */
		  async removeModel(id) {
		    const api = this.remote;
		    if (!api) return "\u684C\u5BA0 Remote \u901A\u9053\u672A\u6302\u8F7D\u3002";
		    try {
		      const response = await api.removeModel(id);
		      if (!response.ok || !response.value) return response.error?.message ?? "\u5220\u9664\u5931\u8D25\u3002";
		      await this.refreshRemote();
		      return response.value.error ?? null;
		    } catch (error) {
		      return error.message;
		    }
		  }
		  /** Probe the companion endpoint through the host (host-side fetch, no CORS). */
		  async testLlm(baseUrl, apiKey, model) {
		    const api = this.remote;
		    if (!api) return { ok: false, message: "\u684C\u5BA0 Remote \u901A\u9053\u672A\u6302\u8F7D\u3002", models: [] };
		    try {
		      const response = await api.testLlm(baseUrl, apiKey || void 0, model || void 0);
		      if (!response.ok || !response.value) return { ok: false, message: response.error?.message ?? "\u6D4B\u8BD5\u5931\u8D25\u3002", models: [] };
		      return response.value;
		    } catch (error) {
		      return { ok: false, message: error.message, models: [] };
		    }
		  }
		  /** Reveal the model folder in the OS file manager. */
		  async openModelsFolder() {
		    const api = this.remote;
		    if (!api) return "\u684C\u5BA0 Remote \u901A\u9053\u672A\u6302\u8F7D\u3002";
		    try {
		      const response = await api.openModelsFolder();
		      return response.value?.error ?? null;
		    } catch (error) {
		      return error.message;
		    }
		  }
		  /** 0.1.7：一键清空陪伴记忆（宿主侧原子清空 turns.jsonl）。 */
		  async clearCompanionMemory() {
		    const api = this.remote;
		    if (!api) return "\u684C\u5BA0 Remote \u901A\u9053\u672A\u6302\u8F7D\u3002";
		    try {
		      const response = await api.clearCompanionMemory();
		      if (!response.ok) return response.error?.message ?? "\u6E05\u7A7A\u5931\u8D25\u3002";
		      await this.refreshRemote();
		      return response.value?.error ?? null;
		    } catch (error) {
		      return error.message;
		    }
		  }
		  /** The personas list, defended against a section that carries none yet. */
		  personas() {
		    const list = this.store.getSnapshot().section.persona?.personas;
		    return Array.isArray(list) ? list : [];
		  }
		  /**
		   * Append one persona and activate it if nothing is active yet.
		   *
		   * Both import paths (a v2 card file and a role taken from dsh-cosplay) land
		   * here, so "an id that already exists gets a fresh one" is decided once and
		   * cannot drift between them.
		   */
		  async addPersona(persona) {
		    const existing = this.personas();
		    const duplicate = existing.some((candidate) => candidate.id === persona.id);
		    const added = { ...persona, id: duplicate ? newPersonaId() : persona.id };
		    const next = [...existing, added];
		    const activeId = String(this.store.getSnapshot().section.persona?.activeId ?? "");
		    return this.mutate([
		      { op: "set", path: ["persona", "personas"], value: next },
		      { op: "set", path: ["persona", "activeId"], value: activeId || added.id }
		    ]);
		  }
		  /** Name shown for the Remote namespace, for diagnostics copy. */
		  get remoteNamespace() {
		    return DESKPET_REMOTE_NAMESPACE;
		  }
		};

		// src/client/section/DeskpetSection.ts
		var import_react7 = require("react");

		// src/client/ui.ts
		var styles = {
		  page: { display: "flex", flexDirection: "column", gap: "16px", padding: "4px 0", maxWidth: "760px" },
		  card: {
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))",
		    borderRadius: "12px",
		    padding: "14px 16px",
		    display: "flex",
		    flexDirection: "column",
		    gap: "10px"
		  },
		  row: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
		  column: { display: "flex", flexDirection: "column", gap: "6px" },
		  title: { fontSize: "15px", fontWeight: 600 },
		  hint: { fontSize: "13px", opacity: 0.72, lineHeight: "1.6" },
		  label: { fontSize: "12px", opacity: 0.6, minWidth: "76px" },
		  mono: { fontSize: "12px", opacity: 0.72, fontFamily: "ui-monospace, Menlo, Consolas, monospace", wordBreak: "break-all" },
		  switchTrack: { display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer" },
		  switchBox: {
		    width: "38px",
		    height: "22px",
		    borderRadius: "11px",
		    position: "relative",
		    transition: "background .18s ease",
		    background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.35))"
		  },
		  switchKnob: {
		    width: "16px",
		    height: "16px",
		    borderRadius: "50%",
		    background: "#fff",
		    position: "absolute",
		    top: "3px",
		    left: "3px",
		    transition: "left .18s cubic-bezier(.4,0,.2,1)"
		  },
		  button: {
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))",
		    background: "transparent",
		    color: "inherit",
		    borderRadius: "8px",
		    padding: "4px 10px",
		    fontSize: "13px",
		    cursor: "pointer",
		    fontFamily: "inherit"
		  },
		  buttonPrimary: {
		    border: "none",
		    background: "var(--dsw-specific-accent, #4d6bfe)",
		    color: "#fff",
		    borderRadius: "8px",
		    padding: "5px 12px",
		    fontSize: "13px",
		    cursor: "pointer",
		    fontFamily: "inherit"
		  },
		  buttonDanger: {
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))",
		    background: "transparent",
		    color: "#ff7b72",
		    borderRadius: "8px",
		    padding: "4px 10px",
		    fontSize: "13px",
		    cursor: "pointer",
		    fontFamily: "inherit"
		  },
		  input: {
		    background: "transparent",
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))",
		    borderRadius: "8px",
		    padding: "5px 8px",
		    color: "inherit",
		    fontSize: "13px",
		    fontFamily: "inherit",
		    flex: 1,
		    minWidth: "160px"
		  },
		  inputSmall: {
		    background: "transparent",
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))",
		    borderRadius: "8px",
		    padding: "5px 8px",
		    color: "inherit",
		    fontSize: "13px",
		    fontFamily: "inherit",
		    width: "88px"
		  },
		  select: {
		    background: "var(--dsw-alias-bg-base, #1b1d23)",
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))",
		    borderRadius: "8px",
		    padding: "5px 8px",
		    color: "inherit",
		    fontSize: "13px",
		    fontFamily: "inherit",
		    flex: 1,
		    minWidth: "160px"
		  },
		  textarea: {
		    background: "transparent",
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))",
		    borderRadius: "8px",
		    padding: "5px 8px",
		    color: "inherit",
		    fontSize: "13px",
		    fontFamily: "inherit",
		    width: "100%",
		    minHeight: "56px",
		    resize: "vertical",
		    overflowY: "auto",
		    lineHeight: "1.5",
		    boxSizing: "border-box"
		  },
		  badge: {
		    fontSize: "12px",
		    padding: "1px 8px",
		    borderRadius: "99px",
		    background: "var(--dsw-specific-accent, #4d6bfe)",
		    color: "#fff"
		  },
		  badgeMuted: {
		    fontSize: "12px",
		    padding: "1px 8px",
		    borderRadius: "99px",
		    background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.35))",
		    color: "inherit"
		  },
		  ok: { fontSize: "13px", color: "#3fb950" },
		  fail: { fontSize: "13px", color: "#ff7b72" },
		  thumb: {
		    width: "48px",
		    height: "48px",
		    objectFit: "cover",
		    borderRadius: "8px",
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))"
		  },
		  segment: {
		    display: "inline-flex",
		    gap: "0",
		    border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))",
		    borderRadius: "8px",
		    overflow: "hidden"
		  },
		  segmentItem: {
		    border: "none",
		    background: "transparent",
		    color: "inherit",
		    padding: "5px 12px",
		    fontSize: "13px",
		    cursor: "pointer",
		    fontFamily: "inherit"
		  },
		  segmentItemActive: {
		    background: "var(--dsw-specific-accent, #4d6bfe)",
		    color: "#fff"
		  }
		};
		var SECTION_ROOT_CLASS = "deskpet-section";
		var SWITCH_CLASS = "deskpet-switch";
		var SWITCH_KNOB_CLASS = "deskpet-switch-knob";
		var SECTION_CSS = `
		.${SECTION_ROOT_CLASS} button {
		  transition: transform .12s ease, opacity .15s ease, filter .15s ease, background .15s ease;
		}
		.${SECTION_ROOT_CLASS} button:hover:not(:disabled) { filter: brightness(1.12); }
		.${SECTION_ROOT_CLASS} button:active:not(:disabled) { transform: scale(.955) translateY(1px); filter: brightness(.94); }
		.${SECTION_ROOT_CLASS} button:disabled { opacity: .5; cursor: default; }
		.${SECTION_ROOT_CLASS} input, .${SECTION_ROOT_CLASS} textarea, .${SECTION_ROOT_CLASS} select {
		  transition: border-color .15s ease, box-shadow .15s ease;
		}
		.${SECTION_ROOT_CLASS} input:focus, .${SECTION_ROOT_CLASS} textarea:focus, .${SECTION_ROOT_CLASS} select:focus {
		  outline: none;
		  border-color: var(--dsw-specific-accent, #4d6bfe);
		  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-specific-accent, #4d6bfe) 28%, transparent);
		}
		.${SECTION_ROOT_CLASS} .${SWITCH_CLASS} { transition: filter .15s ease; }
		.${SECTION_ROOT_CLASS} .${SWITCH_CLASS}:hover { filter: brightness(1.12); }
		.${SECTION_ROOT_CLASS} .${SWITCH_CLASS}:active:not(.locked) .${SWITCH_KNOB_CLASS} { width: 19px; border-radius: 8px; }
		.${SECTION_ROOT_CLASS} .${SWITCH_KNOB_CLASS} {
		  transition: left .18s cubic-bezier(.4,0,.2,1), width .12s ease, border-radius .12s ease;
		}
		@media (prefers-reduced-motion: reduce) {
		  .${SECTION_ROOT_CLASS} button, .${SECTION_ROOT_CLASS} .${SWITCH_CLASS},
		  .${SECTION_ROOT_CLASS} .${SWITCH_KNOB_CLASS} { transition: none; }
		}
		`;

		// src/client/section/ModelBlock.ts
		var import_react2 = require("react");

		// src/client/section/primitives.ts
		var import_react = require("react");
		function Card(props) {
		  return (0, import_react.createElement)(
		    "div",
		    { style: styles.card },
		    (0, import_react.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react.createElement)("div", { style: styles.title }, props.title),
		      props.actions
		    ),
		    props.children
		  );
		}
		function Field(props) {
		  return (0, import_react.createElement)(
		    "div",
		    { style: styles.column },
		    (0, import_react.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react.createElement)("span", { style: styles.label }, props.label),
		      props.children
		    ),
		    props.hint ? (0, import_react.createElement)("div", { style: styles.hint }, props.hint) : null
		  );
		}
		function Switch(props) {
		  return (0, import_react.createElement)(
		    "label",
		    {
		      className: SWITCH_CLASS,
		      style: { ...styles.switchTrack, ...props.disabled ? { opacity: 0.5, cursor: "default" } : {} }
		    },
		    (0, import_react.createElement)(
		      "span",
		      {
		        style: {
		          ...styles.switchBox,
		          background: props.checked ? "var(--dsw-specific-accent, #4d6bfe)" : styles.switchBox.background
		        },
		        onClick: () => {
		          if (!props.disabled) props.onToggle();
		        }
		      },
		      (0, import_react.createElement)("span", {
		        className: SWITCH_KNOB_CLASS,
		        style: { ...styles.switchKnob, left: props.checked ? "19px" : "3px" }
		      })
		    ),
		    props.label ? (0, import_react.createElement)("span", null, props.label) : null
		  );
		}
		function Segmented(props) {
		  return (0, import_react.createElement)(
		    "div",
		    { style: styles.segment },
		    props.options.map((option) => (0, import_react.createElement)(
		      "button",
		      {
		        key: option.value,
		        style: {
		          ...styles.segmentItem,
		          ...option.value === props.value ? styles.segmentItemActive : {}
		        },
		        onClick: () => props.onChange(option.value)
		      },
		      option.label
		    ))
		  );
		}
		function TextInput(props) {
		  return (0, import_react.createElement)("input", {
		    style: props.style ?? styles.input,
		    type: props.type ?? "text",
		    value: props.value,
		    placeholder: props.placeholder,
		    onChange: (event) => props.onChange(event.target.value)
		  });
		}
		function TextArea(props) {
		  return (0, import_react.createElement)("textarea", {
		    style: props.minHeight ? { ...styles.textarea, minHeight: props.minHeight } : styles.textarea,
		    value: props.value,
		    placeholder: props.placeholder,
		    onChange: (event) => props.onChange(event.target.value)
		  });
		}
		function Fact(props) {
		  return (0, import_react.createElement)(
		    "div",
		    { style: styles.row },
		    (0, import_react.createElement)("span", { style: styles.label }, props.label),
		    (0, import_react.createElement)("span", { style: props.mono ? styles.mono : styles.hint }, props.value)
		  );
		}
		function Status(props) {
		  const style = props.tone === "ok" ? styles.ok : props.tone === "fail" ? styles.fail : styles.hint;
		  return (0, import_react.createElement)("div", { style }, props.children);
		}

		// src/client/section/ModelBlock.ts
		function ModelBlock(props) {
		  const { controller, section, remote, t } = props;
		  const models = remote?.models ?? [];
		  const [busy, setBusy] = (0, import_react2.useState)(false);
		  const [error, setError] = (0, import_react2.useState)(null);
		  const importModel = (0, import_react2.useCallback)(async () => {
		    setBusy(true);
		    setError(null);
		    const failure = await controller.importModel();
		    setBusy(false);
		    if (failure) setError(failure);
		  }, [controller]);
		  const removeModel = (0, import_react2.useCallback)(async (model) => {
		    if (!window.confirm(t("modelRemoveConfirm").replace("{name}", model.name))) return;
		    setError(null);
		    const failure = await controller.removeModel(model.id);
		    if (failure) setError(failure);
		  }, [controller, t]);
		  const cubismReady = remote?.runtime?.cubismCore === true;
		  return (0, import_react2.createElement)(
		    Card,
		    {
		      title: t("modelTitle"),
		      actions: (0, import_react2.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react2.createElement)("button", { style: styles.buttonPrimary, onClick: importModel, disabled: busy }, busy ? t("modelImporting") : t("modelImport")),
		        (0, import_react2.createElement)("button", { style: styles.button, onClick: () => void controller.openModelsFolder() }, t("modelOpenFolder"))
		      )
		    },
		    models.length === 0 ? (0, import_react2.createElement)("div", { style: styles.hint }, t("modelEmpty")) : (0, import_react2.createElement)(Field, {
		      label: t("modelSelect"),
		      hint: t("modelFolderHint"),
		      children: (0, import_react2.createElement)(
		        "select",
		        {
		          style: styles.select,
		          value: section.modelId ?? "",
		          onChange: (event) => void controller.write("modelId", event.target.value)
		        },
		        (0, import_react2.createElement)("option", { value: "" }, t("modelNone")),
		        models.map((model) => (0, import_react2.createElement)("option", { key: model.id, value: model.id }, model.name))
		      )
		    }),
		    models.length > 0 ? (0, import_react2.createElement)(
		      "div",
		      { style: styles.column },
		      models.map((model) => (0, import_react2.createElement)(
		        "div",
		        { key: model.id, style: styles.row },
		        (0, import_react2.createElement)("span", { style: { ...styles.hint, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, model.name),
		        model.id === section.modelId ? (0, import_react2.createElement)("span", { style: styles.badge }, "\u2713") : null,
		        (0, import_react2.createElement)("button", { style: styles.button, onClick: () => void controller.write("modelId", model.id) }, t("modelUse")),
		        (0, import_react2.createElement)("button", { style: styles.buttonDanger, onClick: () => void removeModel(model) }, t("modelRemove"))
		      ))
		    ) : null,
		    (0, import_react2.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react2.createElement)("span", { style: cubismReady ? styles.badge : styles.badgeMuted }, cubismReady ? t("cubismReady") : t("cubismMissing"))
		    ),
		    (0, import_react2.createElement)(Field, {
		      label: t("cubismPath"),
		      hint: t("cubismPathHint"),
		      children: (0, import_react2.createElement)("input", {
		        style: styles.input,
		        value: section.cubismCorePath ?? "",
		        onChange: (event) => void controller.write("cubismCorePath", event.target.value)
		      })
		    }),
		    remote?.runtime?.modelsRoot ? (0, import_react2.createElement)(Fact, { label: "models", value: remote.runtime.modelsRoot, mono: true }) : null,
		    error ? (0, import_react2.createElement)(Status, { tone: "fail" }, error) : null
		  );
		}

		// src/client/section/ModeBlock.ts
		var import_react3 = require("react");
		function ModeBlock(props) {
		  const { controller, section, remote, t } = props;
		  const mode = section.mode ?? "auto";
		  const effective = remote?.runtime?.effectiveMode;
		  /** 陪伴截屏的最近状态，由宿主转存自 Electron 侧上报。 */
		  const companionStatus = remote?.runtime?.companion ?? null;
		  /** 任务节点语音开关（页面内观察器 → 宿主 → 桌宠窗口）。 */
		  const taskVoice = section.taskVoice ?? {};
		  return (0, import_react3.createElement)(
		    Card,
		    { title: t("modeTitle") },
		    (0, import_react3.createElement)(Field, {
		      label: t("modeTitle"),
		      children: (0, import_react3.createElement)(Segmented, {
		        value: mode,
		        options: [
		          { value: "auto", label: t("modeAuto") },
		          { value: "task", label: t("modeTask") },
		          { value: "companion", label: t("modeCompanion") }
		        ],
		        onChange: (value) => void controller.write("mode", value)
		      })
		    }),
		    mode === "auto" && effective ? (0, import_react3.createElement)(Status, { tone: "hint" }, t("modeEffective").replace("{mode}", effective === "task" ? t("modeTask") : t("modeCompanion"))) : null,
		    (0, import_react3.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react3.createElement)(Switch, {
		        checked: section.alwaysOnTop !== false,
		        onToggle: () => void controller.write("alwaysOnTop", !(section.alwaysOnTop !== false))
		      }),
		      (0, import_react3.createElement)("span", null, t("alwaysOnTop"))
		    ),
		    (0, import_react3.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react3.createElement)(Switch, {
		        // 0.2.0: 情绪动作引擎总开关。关掉即完全退回 0.1.9 的姿态查表，
		        // 注入脚本一个参数都不写——出问题时的唯一退路。
		        checked: section.emotionEngine !== false,
		        onToggle: () => void controller.write("emotionEngine", !(section.emotionEngine !== false))
		      }),
		      (0, import_react3.createElement)("span", null, t("emotionEngine"))
		    ),
		    (0, import_react3.createElement)(Field, {
		      label: t("companionInterval"),
		      children: (0, import_react3.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react3.createElement)("input", {
		          style: styles.inputSmall,
		          type: "number",
		          // 0.1.7：秒级间隔，最小 10 秒（10–10800，默认 600）。
		          min: 10,
		          max: 10800,
		          value: String(section.companionIntervalSeconds ?? 600),
		          onChange: (event) => {
		            const parsed = Number(event.target.value);
		            if (Number.isFinite(parsed)) void controller.write("companionIntervalSeconds", Math.min(10800, Math.max(10, Math.round(parsed))));
		          }
		        }),
		        (0, import_react3.createElement)("span", { style: styles.hint }, t("companionIntervalUnit"))
		      )
		    }),
		    (0, import_react3.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react3.createElement)(Switch, {
		        checked: section.screenshotsEnabled !== false,
		        onToggle: () => void controller.write("screenshotsEnabled", !(section.screenshotsEnabled !== false))
		      }),
		      (0, import_react3.createElement)("span", null, t("screenshots"))
		    ),
		    // 0.2.1：对系统截图可见（默认关＝不可见）。紧贴截屏开关：两个都跟「能不能
		    // 看到屏幕」有关，但一个管她拍别人，一个管别人拍她。
		    (0, import_react3.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react3.createElement)(Switch, {
		        checked: section.visibleToCapture === true,
		        onToggle: () => void controller.write("visibleToCapture", section.visibleToCapture !== true)
		      }),
		      (0, import_react3.createElement)("span", null, t("captureVisible"))
		    ),
		    (0, import_react3.createElement)("div", { style: styles.hint }, t("captureVisibleHint")),
		    // ── 任务节点语音 ──────────────────────────────────────────────
		    // 三个开关对应三个节点。播报由页面内的观察器触发，所以只在 DSH 页面
		    // 开着的时候有效——桌面端窗口自己看不到页面。
		    (0, import_react3.createElement)("div", { style: styles.hint }, t("taskVoiceHint")),
		    (0, import_react3.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react3.createElement)(Switch, {
		        checked: taskVoice.onConfirm !== false,
		        onToggle: () => void controller.write("taskVoice.onConfirm", taskVoice.onConfirm === false)
		      }),
		      (0, import_react3.createElement)("span", null, t("taskVoiceOnConfirm"))
		    ),
		    (0, import_react3.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react3.createElement)(Switch, {
		        checked: taskVoice.onDone !== false,
		        onToggle: () => void controller.write("taskVoice.onDone", taskVoice.onDone === false)
		      }),
		      (0, import_react3.createElement)("span", null, t("taskVoiceOnDone"))
		    ),
		    (0, import_react3.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react3.createElement)(Switch, {
		        checked: taskVoice.onStart === true,
		        onToggle: () => void controller.write("taskVoice.onStart", taskVoice.onStart !== true)
		      }),
		      (0, import_react3.createElement)("span", null, t("taskVoiceOnStart"))
		    ),
		    (0, import_react3.createElement)("div", { style: styles.hint },
		      remote?.runtime?.taskChannelError ? String(remote.runtime.taskChannelError)
		        : remote?.runtime?.taskChannelPort ? `${t("taskVoiceChannel")}: 127.0.0.1:${remote.runtime.taskChannelPort}`
		          : t("taskVoiceChannelOff")),
		    // 陪伴链路自证：截屏到底有没有跑、跑到哪一步。阶段与详情来自 Electron
		    // 侧上报，宿主转存后在这里显示——"截屏没启动"从此不用靠猜。
		    companionStatus ? (0, import_react3.createElement)(
		      Status,
		      { tone: companionStatus.captured ? "ok" : companionStatus.stage === "error" || companionStatus.stage === "capture-failed" ? "fail" : "hint" },
		      `${t("companionLast")}：${companionStatus.stage}${companionStatus.detail ? ` \xB7 ${companionStatus.detail}` : ""}${companionStatus.at ? ` \xB7 ${formatClock(companionStatus.at)}` : ""}`
		    ) : (0, import_react3.createElement)("div", { style: styles.hint }, t("companionNever"))
		  );
		}
		/** 把时间戳格式化成 HH:mm:ss，设置页只关心"刚才有没有跑"。 */
		function formatClock(at) {
		  try {
		    return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
		  } catch {
		    return "";
		  }
		}

		// src/client/section/LlmBlock.ts
		var import_react4 = require("react");
		function LlmBlock(props) {
		  const { controller, section, remote, t } = props;
		  const llm = section.llm ?? {};
		  const [apiKeyDraft, setApiKeyDraft] = (0, import_react4.useState)("");
		  const [apiKeyNotice, setApiKeyNotice] = (0, import_react4.useState)(null);
		  const [baseUrlDraft, setBaseUrlDraft] = (0, import_react4.useState)(String(llm.baseUrl ?? ""));
		  const [modelDraft, setModelDraft] = (0, import_react4.useState)(String(llm.model ?? ""));
		  const [visionDraft, setVisionDraft] = (0, import_react4.useState)(String(llm.visionModel ?? ""));
		  const [temperatureDraft, setTemperatureDraft] = (0, import_react4.useState)(String(llm.temperature ?? 0.8));
		  const [probe, setProbe] = (0, import_react4.useState)(null);
		  const [testing, setTesting] = (0, import_react4.useState)(false);
		  // 保存反馈：任何字段保存后都在本区块顶部亮一行"已保存"，4s 后自动消失。
		  // 原来保存按钮点下去没有任何回执，用户无法判断"到底存进去没有"。
		  const [flash, setFlash] = (0, import_react4.useState)(null);
		  const flashTimer = (0, import_react4.useRef)(0);
		  const announce = (0, import_react4.useCallback)((label, result) => {
		    if (flashTimer.current) clearTimeout(flashTimer.current);
		    if (result && result.ok === false) {
		      setFlash({ ok: false, text: t("llmSavedFlashFail").replace("{field}", label).replace("{reason}", result.message ?? "") });
		      return;
		    }
		    setFlash({ ok: true, text: t("llmSavedFlash").replace("{field}", label) });
		    flashTimer.current = setTimeout(() => setFlash(null), 4e3);
		  }, [t]);
		  // 已保存的值由宿主回传：URL/模型原样，密钥是宿主脱敏后的前后各 4 位
		  // （明文永远不过线，客户端也拿不到）。
		  const savedUrl = String(remote?.runtime?.llmBaseUrl ?? "");
		  const savedModel = String(remote?.runtime?.llmModel ?? "");
		  const savedKeyMasked = String(remote?.runtime?.llmApiKeyMasked ?? "");
		  (0, import_react4.useEffect)(() => {
		    setBaseUrlDraft(String(llm.baseUrl ?? ""));
		  }, [llm.baseUrl]);
		  (0, import_react4.useEffect)(() => {
		    setModelDraft(String(llm.model ?? ""));
		  }, [llm.model]);
		  (0, import_react4.useEffect)(() => {
		    setVisionDraft(String(llm.visionModel ?? ""));
		  }, [llm.visionModel]);
		  (0, import_react4.useEffect)(() => {
		    setTemperatureDraft(String(llm.temperature ?? 0.8));
		  }, [llm.temperature]);
		  const commitText = (0, import_react4.useCallback)((field, value) => {
		    const label = LLM_FIELD_LABELS[field] ? t(LLM_FIELD_LABELS[field]) : field;
		    void Promise.resolve(controller.write(`llm.${field}`, value))
		      .then((result) => announce(label, result))
		      .catch((error) => announce(label, { ok: false, message: error.message }));
		  }, [controller, announce, t]);
		  const test = (0, import_react4.useCallback)(async () => {
		    setTesting(true);
		    setProbe(null);
		    const result = await controller.testLlm(baseUrlDraft, apiKeyDraft, modelDraft);
		    setTesting(false);
		    setProbe({ ok: result.ok, message: result.message });
		  }, [controller, baseUrlDraft, apiKeyDraft, modelDraft]);
		  const apiKeySet = remote?.runtime?.apiKeySet === true;
		  return (0, import_react4.createElement)(
		    Card,
		    { title: t("llmTitle") },
		    // 已保存的配置：一眼看到"现在真正在用哪个端点、哪把钥匙（脱敏）、哪个模型"。
		    // 输入框里是草稿，这里才是已落盘的事实，两者不一致时用户能立刻发现。
		    (0, import_react4.createElement)(Field, {
		      label: t("llmSavedTitle"),
		      children: (0, import_react4.createElement)(
		        "div",
		        { style: styles.column },
		        (0, import_react4.createElement)(
		          "div",
		          { style: styles.row },
		          (0, import_react4.createElement)("span", { style: styles.badgeMuted }, t("llmSavedUrl")),
		          (0, import_react4.createElement)("span", { style: styles.mono }, savedUrl !== "" ? savedUrl : t("llmSavedEmpty"))
		        ),
		        (0, import_react4.createElement)(
		          "div",
		          { style: styles.row },
		          (0, import_react4.createElement)("span", { style: styles.badgeMuted }, t("llmSavedKey")),
		          (0, import_react4.createElement)("span", { style: styles.mono }, savedKeyMasked !== "" ? savedKeyMasked : t("llmSavedEmpty"))
		        ),
		        (0, import_react4.createElement)(
		          "div",
		          { style: styles.row },
		          (0, import_react4.createElement)("span", { style: styles.badgeMuted }, t("llmSavedModel")),
		          (0, import_react4.createElement)("span", { style: styles.mono }, savedModel !== "" ? savedModel : t("llmSavedEmpty"))
		        )
		      )
		    }),
		    flash ? (0, import_react4.createElement)(Status, { tone: flash.ok ? "ok" : "fail" }, flash.text) : null,
		    (0, import_react4.createElement)(Field, {
		      label: t("llmBaseUrl"),
		      children: (0, import_react4.createElement)(TextInput, {
		        value: baseUrlDraft,
		        placeholder: "http://127.0.0.1:1234/v1",
		        onChange: setBaseUrlDraft
		      })
		    }),
		    (0, import_react4.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react4.createElement)("button", {
		        style: styles.buttonPrimary,
		        onClick: () => commitText("baseUrl", baseUrlDraft)
		      }, t("save")),
		      (0, import_react4.createElement)("span", { style: apiKeySet ? styles.badge : styles.badgeMuted }, `${t("llmApiKey")}: ${apiKeySet ? t("llmApiKeySet") : t("llmApiKeyUnset")}`)
		    ),
		    (0, import_react4.createElement)(Field, {
		      label: t("llmApiKey"),
		      hint: t("llmApiKeyHint"),
		      children: (0, import_react4.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react4.createElement)(TextInput, {
		          type: "password",
		          value: apiKeyDraft,
		          placeholder: apiKeySet ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : t("llmApiKeyKeepHint"),
		          onChange: setApiKeyDraft
		        }),
		        (0, import_react4.createElement)("button", {
		          style: styles.buttonPrimary,
		          onClick: () => {
		            const next = apiKeyDraft.trim();
		            if (next === "") {
		              setApiKeyNotice(t("llmApiKeyUnchanged"));
		              return;
		            }
		            setApiKeyNotice(null);
		            commitText("apiKey", next);
		            setApiKeyDraft("");
		          }
		        }, t("save")),
		        (0, import_react4.createElement)("button", { style: styles.button, onClick: () => { setApiKeyNotice(null); setApiKeyDraft(""); void Promise.resolve(controller.clear("llm.apiKey")).then((result) => announce(t("llmApiKey"), result)); } }, t("reset"))
		      )
		    }),
		    apiKeyNotice ? (0, import_react4.createElement)(Status, { tone: "ok" }, apiKeyNotice) : null,
		    (0, import_react4.createElement)(Field, {
		      label: t("llmModel"),
		      children: (0, import_react4.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react4.createElement)(TextInput, { value: modelDraft, onChange: setModelDraft }),
		        (0, import_react4.createElement)("button", { style: styles.buttonPrimary, onClick: () => commitText("model", modelDraft) }, t("save"))
		      )
		    }),
		    (0, import_react4.createElement)(Field, {
		      label: t("llmVisionModel"),
		      hint: t("llmVisionHint"),
		      children: (0, import_react4.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react4.createElement)(TextInput, { value: visionDraft, onChange: setVisionDraft }),
		        (0, import_react4.createElement)("button", { style: styles.buttonPrimary, onClick: () => commitText("visionModel", visionDraft) }, t("save"))
		      )
		    }),
		    (0, import_react4.createElement)(Field, {
		      label: t("llmTemperature"),
		      children: (0, import_react4.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react4.createElement)("input", {
		          style: styles.inputSmall,
		          type: "number",
		          min: 0,
		          max: 2,
		          step: 0.1,
		          value: temperatureDraft,
		          onChange: (event) => setTemperatureDraft(event.target.value)
		        }),
		        (0, import_react4.createElement)("button", {
		          style: styles.buttonPrimary,
		          onClick: () => {
		            const parsed = Number(temperatureDraft);
		            if (Number.isFinite(parsed)) commitText("temperature", String(Math.min(2, Math.max(0, parsed))));
		          }
		        }, t("save"))
		      )
		    }),
		    (0, import_react4.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react4.createElement)("button", { style: styles.button, onClick: test, disabled: testing }, testing ? t("llmTesting") : t("llmTest")),
		      probe ? (0, import_react4.createElement)(Status, { tone: probe.ok ? "ok" : "fail" }, `${probe.ok ? t("llmTestOk") : t("llmTestFail")}\uFF1A${probe.message}`) : null
		    )
		  );
		}
		/** 保存反馈里显示的字段名。 */
		var LLM_FIELD_LABELS = {
		  baseUrl: "llmBaseUrl",
		  apiKey: "llmApiKey",
		  model: "llmModel",
		  visionModel: "llmVisionModel",
		  temperature: "llmTemperature"
		};

		// src/client/section/PersonaBlock.ts
		var import_react5 = require("react");
		var BLANK_PERSONA = { id: "", name: "", emoji: "", systemPrompt: "", greeting: "", description: "", tags: [] };
		function PersonaBlock(props) {
		  const { controller, section, cosplay, t } = props;
		  const personaSection = section.persona ?? {};
		  const personas = Array.isArray(personaSection.personas) ? personaSection.personas : [];
		  const activeId = personaSection.activeId ?? "";
		  const library = Array.isArray(cosplay) ? cosplay : [];
		  const [draft, setDraft] = (0, import_react5.useState)(null);
		  const [error, setError] = (0, import_react5.useState)(null);
		  const [notice, setNotice] = (0, import_react5.useState)(null);
		  const fileRef = (0, import_react5.useRef)(null);
		  const setField = (0, import_react5.useCallback)((key, value) => {
		    setDraft((current) => current ? { ...current, [key]: value } : current);
		  }, []);
		  const persist = (0, import_react5.useCallback)(async (next, nextActiveId) => {
		    const result = await controller.mutate([
		      { op: "set", path: ["persona", "personas"], value: next },
		      { op: "set", path: ["persona", "activeId"], value: nextActiveId }
		    ]);
		    if (!result.ok) setError(result.message ?? t("personaSaveFailed"));
		    return result.ok;
		  }, [controller, t]);
		  const save = (0, import_react5.useCallback)(async () => {
		    if (!draft) return;
		    if (!draft.name.trim()) {
		      setError(t("personaNameRequired"));
		      return;
		    }
		    setError(null);
		    const next = draft.id ? personas.map((candidate) => candidate.id === draft.id ? { ...draft, name: draft.name.trim() } : candidate) : [...personas, { ...draft, id: newPersonaId(), name: draft.name.trim() }];
		    const savedId = draft.id || next[next.length - 1].id;
		    const nextActive = activeId || savedId;
		    if (await persist(next, nextActive)) setDraft(null);
		  }, [draft, personas, activeId, persist, t]);
		  const remove = (0, import_react5.useCallback)(async (persona) => {
		    if (!window.confirm(t("personaDeleteConfirm").replace("{name}", persona.name))) return;
		    const next = personas.filter((candidate) => candidate.id !== persona.id);
		    await persist(next, activeId === persona.id ? "" : activeId);
		  }, [personas, activeId, persist, t]);
		  const exportPersona = (0, import_react5.useCallback)((persona) => {
		    const blob = new Blob([JSON.stringify(toV2Card(persona), null, 2)], { type: "application/json" });
		    const url = URL.createObjectURL(blob);
		    const anchor = document.createElement("a");
		    anchor.href = url;
		    anchor.download = `${persona.name || persona.id || "persona"}.json`;
		    anchor.click();
		    URL.revokeObjectURL(url);
		  }, []);
		  const importPersona = (0, import_react5.useCallback)(async (file) => {
		    try {
		      const text = await file.text();
		      if (!text.trim()) throw new Error(t("personaImportEmpty"));
		      const imported = fromV2Card(JSON.parse(text));
		      const result = await controller.addPersona(imported);
		      if (result.ok) {
		        setError(null);
		        setNotice(t("personaImported").replace("{name}", imported.name));
		      } else {
		        setNotice(null);
		        setError(`${t("personaImportFailed")}\uFF1A${result.message ?? ""}`);
		      }
		    } catch (failure) {
		      setNotice(null);
		      setError(`${t("personaImportFailed")}\uFF1A${failure.message}`);
		    } finally {
		      if (fileRef.current) fileRef.current.value = "";
		    }
		  }, [controller, t]);
		  const importFromCosplay = (0, import_react5.useCallback)(async (role) => {
		    const result = await controller.addPersona(role);
		    if (result.ok) {
		      setError(null);
		      setNotice(t("personaImported").replace("{name}", role.name));
		    } else {
		      setNotice(null);
		      setError(`${t("personaImportFailed")}\uFF1A${result.message ?? ""}`);
		    }
		  }, [controller, t]);
		  return (0, import_react5.createElement)(
		    Card,
		    {
		      title: t("personaTitle"),
		      actions: (0, import_react5.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react5.createElement)("button", { style: styles.buttonPrimary, onClick: () => setDraft({ ...BLANK_PERSONA }) }, t("personaNew")),
		        (0, import_react5.createElement)("button", { style: styles.button, onClick: () => fileRef.current?.click() }, t("personaImport")),
		        (0, import_react5.createElement)("input", {
		          ref: fileRef,
		          type: "file",
		          accept: ".json,application/json",
		          style: { display: "none" },
		          onChange: (event) => {
		            const file = event.target.files?.[0];
		            if (file) void importPersona(file);
		          }
		        })
		      )
		    },
		    (0, import_react5.createElement)(Field, {
		      label: t("personaActive"),
		      children: (0, import_react5.createElement)(
		        "select",
		        {
		          style: styles.select,
		          value: activeId,
		          onChange: (event) => void persist(personas, event.target.value)
		        },
		        (0, import_react5.createElement)("option", { value: "" }, t("personaDefault")),
		        personas.map((persona) => (0, import_react5.createElement)("option", { key: persona.id, value: persona.id }, `${persona.emoji ?? ""} ${persona.name}`.trim()))
		      )
		    }),
		    personas.length === 0 ? (0, import_react5.createElement)("div", { style: styles.hint }, t("personaEmpty")) : (0, import_react5.createElement)(
		      "div",
		      { style: styles.column },
		      personas.map((persona) => (0, import_react5.createElement)(
		        "div",
		        { key: persona.id, style: styles.row },
		        (0, import_react5.createElement)("span", null, `${persona.emoji ?? ""} ${persona.name}`.trim()),
		        persona.id === activeId ? (0, import_react5.createElement)("span", { style: styles.badge }, "\u2605") : null,
		        (0, import_react5.createElement)("span", {
		          style: { ...styles.hint, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
		        }, persona.description ?? ""),
		        (0, import_react5.createElement)("button", { style: styles.button, onClick: () => void persist(personas, persona.id) }, t("personaUse")),
		        (0, import_react5.createElement)("button", { style: styles.button, onClick: () => setDraft({ ...persona }) }, t("personaEdit")),
		        (0, import_react5.createElement)("button", { style: styles.button, onClick: () => exportPersona(persona) }, t("personaExport")),
		        (0, import_react5.createElement)("button", { style: styles.buttonDanger, onClick: () => void remove(persona) }, t("personaDelete"))
		      ))
		    ),
		    library.length > 0 ? (0, import_react5.createElement)(
		      "div",
		      { style: styles.column },
		      (0, import_react5.createElement)("div", { style: styles.label }, t("personaFromCosplay")),
		      (0, import_react5.createElement)("div", { style: styles.hint }, t("personaCosplayHint")),
		      library.map((role) => (0, import_react5.createElement)(
		        "div",
		        { key: `cosplay-${role.id}`, style: styles.row },
		        (0, import_react5.createElement)("span", null, `${role.emoji ?? ""} ${role.name}`.trim()),
		        (0, import_react5.createElement)("span", {
		          style: { ...styles.hint, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
		        }, role.description ?? ""),
		        (0, import_react5.createElement)("button", {
		          style: styles.button,
		          onClick: () => void importFromCosplay(role)
		        }, t("personaCosplayImport"))
		      ))
		    ) : null,
		    draft ? (0, import_react5.createElement)(
		      "div",
		      { style: { ...styles.card, background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))" } },
		      (0, import_react5.createElement)("div", { style: styles.title }, draft.id ? `${t("personaEdit")}\uFF1A${draft.name}` : t("personaNew")),
		      (0, import_react5.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react5.createElement)("span", { style: styles.label }, t("personaName")),
		        (0, import_react5.createElement)(TextInput, { value: draft.name, onChange: (value) => setField("name", value) }),
		        (0, import_react5.createElement)("span", { style: styles.label }, t("personaEmoji")),
		        (0, import_react5.createElement)(TextInput, { value: draft.emoji ?? "", style: { ...styles.inputSmall }, onChange: (value) => setField("emoji", value) })
		      ),
		      (0, import_react5.createElement)(Field, {
		        label: t("personaPrompt"),
		        hint: t("personaPromptHint"),
		        children: (0, import_react5.createElement)(TextArea, {
		          value: draft.systemPrompt,
		          minHeight: "110px",
		          onChange: (value) => setField("systemPrompt", value)
		        })
		      }),
		      (0, import_react5.createElement)(Field, {
		        label: t("personaGreeting"),
		        hint: t("personaGreetingHint"),
		        children: (0, import_react5.createElement)(TextArea, {
		          value: draft.greeting ?? "",
		          minHeight: "56px",
		          onChange: (value) => setField("greeting", value)
		        })
		      }),
		      (0, import_react5.createElement)(Field, {
		        label: t("personaDescription"),
		        children: (0, import_react5.createElement)(TextArea, {
		          value: draft.description ?? "",
		          minHeight: "56px",
		          onChange: (value) => setField("description", value)
		        })
		      }),
		      (0, import_react5.createElement)(
		        "div",
		        { style: styles.row },
		        (0, import_react5.createElement)("button", { style: styles.buttonPrimary, onClick: () => void save() }, t("personaSave")),
		        (0, import_react5.createElement)("button", { style: styles.button, onClick: () => {
		          setDraft(null);
		          setError(null);
		        } }, t("personaCancel"))
		      )
		    ) : null,
		    notice ? (0, import_react5.createElement)(Status, { tone: "ok" }, notice) : null,
		    error ? (0, import_react5.createElement)(Status, { tone: "fail" }, error) : null
		  );
		}

		// src/client/section/WindowBlock.ts
		var import_react6 = require("react");
		var WINDOW_WIDTH_MIN2 = 180;
		var WINDOW_WIDTH_MAX2 = 800;
		var WINDOW_HEIGHT_MIN2 = 240;
		var WINDOW_HEIGHT_MAX2 = 1e3;
		function WindowBlock(props) {
		  const { controller, section, remote, t } = props;
		  const [widthDraft, setWidthDraft] = (0, import_react6.useState)(String(section.windowWidth ?? 260));
		  const [heightDraft, setHeightDraft] = (0, import_react6.useState)(String(section.windowHeight ?? 360));
		  const [error, setError] = (0, import_react6.useState)(null);
		  const [writeError, setWriteError] = (0, import_react6.useState)(null);
		  (0, import_react6.useEffect)(() => {
		    setWidthDraft(String(section.windowWidth ?? 260));
		  }, [section.windowWidth]);
		  (0, import_react6.useEffect)(() => {
		    setHeightDraft(String(section.windowHeight ?? 360));
		  }, [section.windowHeight]);
		  const applySize = () => {
		    const width = Number(widthDraft);
		    const height = Number(heightDraft);
		    if (!Number.isFinite(width) || !Number.isFinite(height) || width < WINDOW_WIDTH_MIN2 || width > WINDOW_WIDTH_MAX2 || height < WINDOW_HEIGHT_MIN2 || height > WINDOW_HEIGHT_MAX2) {
		      setError(t("windowOutOfRange").replace("{minW}", String(WINDOW_WIDTH_MIN2)).replace("{maxW}", String(WINDOW_WIDTH_MAX2)).replace("{minH}", String(WINDOW_HEIGHT_MIN2)).replace("{maxH}", String(WINDOW_HEIGHT_MAX2)));
		      return;
		    }
		    setError(null);
		    void controller.mutate([
		      { op: "set", path: ["windowWidth"], value: Math.round(width) },
		      { op: "set", path: ["windowHeight"], value: Math.round(height) }
		    ]).then((result) => {
		      setWriteError(result.ok ? null : result.message ?? null);
		    });
		  };
		  const toggle = (field, next) => {
		    void controller.write(field, next).then((result) => {
		      setWriteError(result.ok ? null : result.message ?? null);
		    });
		  };
		  const locked = section.windowLocked === true;
		  const clickThrough = section.clickThrough !== false;
		  const remembers = section.rememberWindowPosition === true;
		  const position = section.windowPosition ?? null;
		  const livePosition = remote?.runtime?.windowPosition ?? null;
		  return (0, import_react6.createElement)(
		    Card,
		    { title: t("windowTitle") },
		    (0, import_react6.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react6.createElement)("span", { style: styles.label }, t("windowWidth")),
		      (0, import_react6.createElement)("input", {
		        style: styles.inputSmall,
		        type: "number",
		        min: WINDOW_WIDTH_MIN2,
		        max: WINDOW_WIDTH_MAX2,
		        value: widthDraft,
		        onChange: (event) => setWidthDraft(event.target.value)
		      }),
		      (0, import_react6.createElement)("span", { style: styles.label }, t("windowHeight")),
		      (0, import_react6.createElement)("input", {
		        style: styles.inputSmall,
		        type: "number",
		        min: WINDOW_HEIGHT_MIN2,
		        max: WINDOW_HEIGHT_MAX2,
		        value: heightDraft,
		        onChange: (event) => setHeightDraft(event.target.value)
		      }),
		      (0, import_react6.createElement)("button", { style: styles.buttonPrimary, onClick: applySize }, t("windowApply"))
		    ),
		    (0, import_react6.createElement)("div", { style: styles.hint }, t("windowRange").replace("{minW}", String(WINDOW_WIDTH_MIN2)).replace("{maxW}", String(WINDOW_WIDTH_MAX2)).replace("{minH}", String(WINDOW_HEIGHT_MIN2)).replace("{maxH}", String(WINDOW_HEIGHT_MAX2))),
		    (0, import_react6.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react6.createElement)(Switch, {
		        checked: locked,
		        onToggle: () => toggle("windowLocked", !locked)
		      }),
		      (0, import_react6.createElement)("span", null, t("windowLocked"))
		    ),
		    (0, import_react6.createElement)("div", { style: styles.hint }, t("windowLockedHint")),
		    (0, import_react6.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react6.createElement)(Switch, {
		        checked: clickThrough,
		        onToggle: () => toggle("clickThrough", !clickThrough)
		      }),
		      (0, import_react6.createElement)("span", null, t("windowClickThrough"))
		    ),
		    (0, import_react6.createElement)("div", { style: styles.hint }, t("windowClickThroughHint")),
		    (0, import_react6.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react6.createElement)(Switch, {
		        checked: remembers,
		        onToggle: () => {
		          void (async () => {
		            const enabled = !remembers;
		            const result = await controller.write("rememberWindowPosition", enabled);
		            if (result.ok && enabled && livePosition) {
		              const seeded = await controller.write("windowPosition", livePosition);
		              setWriteError(seeded.ok ? null : seeded.message ?? null);
		              return;
		            }
		            setWriteError(result.ok ? null : result.message ?? null);
		          })();
		        }
		      }),
		      (0, import_react6.createElement)("span", null, t("windowRemember"))
		    ),
		    (0, import_react6.createElement)("div", { style: styles.hint }, t("windowRememberHint")),
		    remembers && position ? (0, import_react6.createElement)(
		      "div",
		      { style: styles.row },
		      (0, import_react6.createElement)("span", { style: styles.mono }, `x=${position.x} y=${position.y}`),
		      (0, import_react6.createElement)("button", { style: styles.button, onClick: () => void controller.clear("windowPosition") }, t("windowReset"))
		    ) : null,
		    error ? (0, import_react6.createElement)(Status, { tone: "fail" }, error) : null,
		    writeError ? (0, import_react6.createElement)(Status, { tone: "fail" }, writeError) : null
		  );
		}

		// src/client/section/DeskpetSection.ts
		function VoiceBlock(props) {
		  const { controller, section, remote, t } = props;
		  const voice = section.voice ?? {};
		  const stringFields = ["workspaceDir","pythonPath","modelsDir","tempDir","gptModel","sovitsModel","spkAudio","promptAudio","promptText","translateUrl","translateModel"];
		  const [draft, setDraft] = (0, import_react7.useState)({});
		  const [probe, setProbe] = (0, import_react7.useState)(null);
		  const [testing, setTesting] = (0, import_react7.useState)(false);
		  // 桥的真实状态（宿主轮询 /health 得到）：把"没声音"区分成"没启用""载入中"
		  // "载入失败/连不上"，而不是让用户只听到系统音色却无从查起。
		  const bridgeTone = voice.enabled !== true ? "init" : remote?.runtime?.voiceReady === true ? "ok" : remote?.runtime?.voiceError ? "fail" : "init";
		  const write = (key, value) => { void controller.write(`voice.${key}`, value); };
		  const testVoice = async () => {
		    setTesting(true); setProbe(null);
		    try {
		      const runtime = remote;
		      const port = remote?.runtime?.voicePort ?? voice.bridgePort ?? 9876;
		      const lang = voice.lang ?? "ja";
		      const response = await fetch(`http://127.0.0.1:${port}/tts`, {
		        method: "POST",
		        headers: { "Content-Type": "application/json" },
		        body: JSON.stringify({ text: "こんにちは、テストです。", lang })
		      });
		      if (response.ok) setProbe({ ok: true, message: t("voiceTestOk") });
		      else {
		        const detail = await response.json().catch(() => null);
		        setProbe({ ok: false, message: detail?.error ?? `HTTP ${response.status}` });
		      }
		    } catch (error) {
		      setProbe({ ok: false, message: error.message });
		    }
		    setTesting(false);
		  };
		  return (0, import_react7.createElement)(Card, { title: t("voiceTitle") },
		    (0, import_react7.createElement)("div", { style: styles.row },
		      (0, import_react7.createElement)(Switch, { checked: voice.enabled === true, onToggle: () => write("enabled", !(voice.enabled === true)) }),
		      (0, import_react7.createElement)("span", null, t("voiceEnabled"))
		    ),
		    (0, import_react7.createElement)(Field, {
		      label: t("voiceLang"),
		      hint: t("voiceLangHint"),
		      children: (0, import_react7.createElement)(Segmented, {
		        value: voice.lang ?? "ja",
		        options: [
		          { value: "ja", label: t("voiceLangJa") },
		          { value: "zh", label: t("voiceLangZh") },
		          { value: "auto", label: t("voiceLangAuto") }
		        ],
		        onChange: (value) => write("lang", value)
		      })
		    }),
		    (0, import_react7.createElement)(Field, {
		      label: t("voiceField_bridgePort"),
		      children: (0, import_react7.createElement)("div", { style: styles.row },
		        (0, import_react7.createElement)("input", { style: styles.inputSmall, type: "number", min: 1024, max: 65535,
		          value: draft.bridgePort !== void 0 ? String(draft.bridgePort) : String(voice.bridgePort ?? 9876),
		          onChange: (event) => { const parsed = Number(event.target.value); if (Number.isFinite(parsed)) setDraft((cur) => ({ ...cur, bridgePort: parsed })); }
		        }),
		        (0, import_react7.createElement)("button", { style: styles.buttonPrimary,
		          onClick: () => { if (draft.bridgePort !== undefined) write("bridgePort", draft.bridgePort); }
		        }, t("save"))
		      )
		    }),
		    stringFields.map((key) => (0, import_react7.createElement)(Field, {
		      key,
		      label: t(`voiceField_${key}`),
		      hint: VOICE_FIELD_HINTS[key] ? t(VOICE_FIELD_HINTS[key]) : void 0,
		      children: (0, import_react7.createElement)("div", { style: styles.row },
		        (0, import_react7.createElement)(TextInput, {
		          value: draft[key] !== void 0 && draft[key] !== null ? draft[key] : (voice[key] !== void 0 && voice[key] !== null ? String(voice[key]) : ""),
		          placeholder: VOICE_FIELD_PLACEHOLDERS[key] ?? "",
		          onChange: (value) => setDraft((cur) => ({ ...cur, [key]: value }))
		        }),
		        (0, import_react7.createElement)("button", { style: styles.buttonPrimary, onClick: () => write(key, draft[key]) }, t("save"))
		      )
		    })),
		    (0, import_react7.createElement)("div", { style: styles.row },
		      (0, import_react7.createElement)("button", { style: styles.button, onClick: testVoice, disabled: testing }, testing ? t("voiceTesting") : t("voiceTest")),
		      probe ? (0, import_react7.createElement)(Status, { tone: probe.ok ? "ok" : "fail" }, probe.message) : null
		    ),
		    (0, import_react7.createElement)(Status, { tone: bridgeTone },
		      (bridgeTone === "ok" ? t("voiceBridgeReady")
		        : bridgeTone === "fail" ? String(remote?.runtime?.voiceError ?? t("voiceBridgeDown"))
		          : voice.enabled === true ? t("voiceBridgeLoading") : t("voiceBridgeOff"))
		      + (voice.enabled === true && remote?.runtime?.voicePort ? ` \xB7 127.0.0.1:${remote.runtime.voicePort}` : "")),
		    remote?.runtime?.voiceLog ? (0, import_react7.createElement)("div", { style: styles.hint }, `${t("voiceLog")}: ${remote.runtime.voiceLog}`) : null
		  );
		}
		var VOICE_FIELD_HINTS = {
		  workspaceDir: "voiceWorkspaceHint",
		  pythonPath: "voicePythonHint",
		  modelsDir: "voiceModelsHint",
		  tempDir: "voiceTempHint",
		  promptText: "voicePromptHint",
		  translateUrl: "voiceTranslateHint"
		};
		var VOICE_FIELD_PLACEHOLDERS = {
		  workspaceDir: "D:\\AI\\gsv-workspace",
		  pythonPath: "C:\\...\\gsv-venv\\Scripts\\python.exe",
		  modelsDir: "C:\\...\\gsv_models",
		  gptModel: "Nanami_Chiaki-e15.ckpt",
		  sovitsModel: "Nanami_Chiaki_e20_s940.pth",
		  spkAudio: "C:\\...\\laffey.mp3",
		  promptAudio: "C:\\...\\AnAn.ogg",
		  promptText: "ちが……ちがう。レイア、貴様は間違っている。",
		  translateUrl: "http://127.0.0.1:1234/v1",
		  translateModel: "deepseek-ai/DeepSeek-V4-Flash"
		};

		// src/client/section/MemoryBlock.ts
		// 陪伴记忆（0.1.7 v1）：开关、保留轮数、一键清空、当前条目数。
		// 运行时数据在 ~/.dsh/live2d-deskpet/memory/turns.jsonl，不随配置存。
		function MemoryBlock(props) {
		  const { controller, section, remote, t } = props;
		  const memory = section.memory ?? {};
		  const enabled = memory.enabled === true;
		  const [busy, setBusy] = (0, import_react7.useState)(false);
		  const [notice, setNotice] = (0, import_react7.useState)(null);
		  const turns = remote?.runtime?.memoryTurns;
		  const clear = async () => {
		    setBusy(true);
		    setNotice(null);
		    const failure = await controller.clearCompanionMemory();
		    setBusy(false);
		    setNotice(failure ? { ok: false, text: failure } : { ok: true, text: t("memoryCleared") });
		  };
		  return (0, import_react7.createElement)(Card, { title: t("memoryTitle") },
		    (0, import_react7.createElement)("div", { style: styles.row },
		      (0, import_react7.createElement)(Switch, {
		        checked: enabled,
		        onToggle: () => void controller.write("memory.enabled", !enabled)
		      }),
		    (0, import_react7.createElement)("span", null, t("memoryEnabled"))
		    ),
		    (0, import_react7.createElement)(Field, {
		      label: t("memoryTurns"),
		      hint: t("memoryTurnsHint"),
		      children: (0, import_react7.createElement)("div", { style: styles.row },
		        (0, import_react7.createElement)("input", {
		          style: styles.inputSmall,
		          type: "number",
		          min: 1,
		          max: 30,
		          value: String(memory.shortTermTurns ?? 8),
		          onChange: (event) => {
		            const parsed = Number(event.target.value);
		            if (Number.isFinite(parsed)) void controller.write("memory.shortTermTurns", Math.min(30, Math.max(1, Math.round(parsed))));
		          }
		        }),
		        (0, import_react7.createElement)("span", { style: styles.hint }, t("memoryTurnsUnit"))
		      )
		    }),
		    (0, import_react7.createElement)("div", { style: styles.row },
		      (0, import_react7.createElement)("button", { style: styles.buttonDanger, onClick: () => void clear(), disabled: busy }, busy ? t("memoryClearing") : t("memoryClear")),
		      typeof turns === "number" ? (0, import_react7.createElement)("span", { style: styles.hint }, t("memoryCount").replace("{count}", String(turns))) : null,
		      notice ? (0, import_react7.createElement)(Status, { tone: notice.ok ? "ok" : "fail" }, notice.text) : null
		    ),
		    (0, import_react7.createElement)("div", { style: styles.hint }, t("memoryPathHint"))
		  );
		}

		// src/shared/companion-nsfw.ts（设置页用到的最小内联：上限常量 + 夹取；
		// 锚定块正文本身不进客户端 bundle——设置页只需要知道「留空 = 内置」。）
		var NSFW_PROMPT_MAX_CHARS = 8000;
		function clampNsfwPrompt(text) {
		  const value = typeof text === "string" ? text : text === void 0 || text === null ? "" : String(text);
		  const trimmed = value.trim();
		  if (trimmed === "") return "";
		  return Array.from(trimmed).slice(0, NSFW_PROMPT_MAX_CHARS).join("");
		}

		// src/client/section/NsfwBlock.ts
		// 成人向提示段（0.1.8；0.1.9 更名为「nsfw提示段」）：开关打开即注入插件内置
		// 锚定块，无需填写任何提示词；文本框只在想覆盖内置正文时才用（留空 = 内置）。
		// 写入前夹取（trim + 截 8000）。正文不进气泡、不进角色卡导出、不进日志。
		// 0.1.9：删除卡片底部的两段长说明（nsfwPromptHint / nsfwPrivacyHint）。
		function NsfwBlock(props) {
		  const { controller, section, t } = props;
		  const nsfw = section.nsfw ?? {};
		  const enabled = nsfw.enabled === true;
		  const [draft, setDraft] = (0, import_react7.useState)(null);
		  const [notice, setNotice] = (0, import_react7.useState)(null);
		  const value = draft !== null ? draft : String(nsfw.prompt ?? "");
		  const count = Array.from(value).length;
		  const writePrompt = async (next) => {
		    const clamped = clampNsfwPrompt(next);
		    setDraft(clamped);
		    const result = await controller.write("nsfw.prompt", clamped);
		    setNotice(result?.ok === false ? { ok: false, text: t("nsfwSaveFailed") } : { ok: true, text: t("nsfwSaved") });
		  };
		  return (0, import_react7.createElement)(Card, { title: t("nsfwTitle") },
		    (0, import_react7.createElement)("div", { style: styles.row },
		      (0, import_react7.createElement)(Switch, {
		        checked: enabled,
		        onToggle: () => void controller.write("nsfw.enabled", !enabled)
		      }),
		      (0, import_react7.createElement)("span", null, t("nsfwEnabled"))
		    ),
		    (0, import_react7.createElement)("div", { style: styles.hint }, t("nsfwHint")),
		    (0, import_react7.createElement)(Field, {
		      label: t("nsfwPromptLabel"),
		      children: (0, import_react7.createElement)("div", { style: styles.column },
		        (0, import_react7.createElement)(TextArea, {
		          value,
		          placeholder: t("nsfwPlaceholder"),
		          onChange: (next) => setDraft(next)
		        }),
		        (0, import_react7.createElement)("div", { style: styles.row },
		          (0, import_react7.createElement)("button", { style: styles.buttonPrimary, onClick: () => void writePrompt(value) }, t("nsfwSave")),
		          (0, import_react7.createElement)("button", { style: styles.button, onClick: () => void writePrompt("") }, t("nsfwRestore")),
		          (0, import_react7.createElement)("span", { style: styles.hint }, t("nsfwCount").replace("{count}", String(count)).replace("{max}", String(NSFW_PROMPT_MAX_CHARS)))
		        ),
		        notice ? (0, import_react7.createElement)(Status, { tone: notice.ok ? "ok" : "fail" }, notice.text) : null
		      )
		    })
		  );
		}

		// src/client/section/DeskpetSection.ts
		function DeskpetSection(props) {
		  const { controller } = props;
		  const snapshot = (0, import_react7.useSyncExternalStore)(controller.store.subscribe, controller.store.getSnapshot);
		  const t = (key) => tFn(key);
		  if (snapshot.status === "loading" && !snapshot.remote) {
		    return (0, import_react7.createElement)("div", { style: styles.hint }, t("loading"));
		  }
		  if (snapshot.status === "unavailable") {
		    return (0, import_react7.createElement)(
		      "div",
		      { style: styles.page },
		      (0, import_react7.createElement)("div", { style: styles.hint }, t("unavailable")),
		      snapshot.error ? (0, import_react7.createElement)("div", { style: styles.hint }, snapshot.error) : null
		    );
		  }
		  return (0, import_react7.createElement)(
		    "div",
		    // Scopes the injected `SECTION_CSS` interaction states to this section only.
		    { className: SECTION_ROOT_CLASS, style: styles.page },
		    snapshot.error ? (0, import_react7.createElement)("div", { style: styles.fail }, snapshot.error) : null,
		    // A refused write is the one failure the panel used to hide: the settings
		    // scope swallows host rejections, so the control snapped back with no
		    // explanation. Surfaces it once, at the top, for any block.
		    snapshot.write === "failed" && snapshot.message ? (0, import_react7.createElement)("div", { style: styles.fail }, snapshot.message) : null,
		    (0, import_react7.createElement)(ModelBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }),
		    (0, import_react7.createElement)(ModeBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }),
		    (0, import_react7.createElement)(LlmBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }),
		    (0, import_react7.createElement)(MemoryBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }),
		    (0, import_react7.createElement)(NsfwBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }),
	            (0, import_react7.createElement)(VoiceBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }),
		    (0, import_react7.createElement)(PersonaBlock, { controller, section: snapshot.section, cosplay: snapshot.cosplay, t }),
		    (0, import_react7.createElement)(WindowBlock, { controller, section: snapshot.section, remote: snapshot.remote, t })
		  );
		}
		var tFn = (key) => key;
		function setTranslator(next) {
		  tFn = next;
		}

		// src/client/locales.ts
		var en = {
		  nav: "Live2D Pet",
		  title: "Live2D Desktop Pet",
		  loading: "Loading desktop pet settings\u2026",
		  unavailable: "Desktop pet settings are unavailable: the host namespace is not exposed to this client.",
		  modelTitle: "Model",
		  modelSelect: "Active model",
		  modelNone: "No model imported",
		  modelImport: "Import model folder",
		  modelImporting: "Importing\u2026",
		  modelRemove: "Delete",
		  modelRemoveConfirm: "Delete model {name}? Its folder is removed from disk.",
		  modelOpenFolder: "Open model folder",
		  modelFolderHint: "The folder must contain exactly one .model3.json definition.",
		  modelUse: "Use",
		  modelEmpty: "No model yet. Import a folder that holds a .model3.json Live2D model.",
		  cubismReady: "Cubism Core ready",
		  cubismMissing: "Cubism Core missing",
		  cubismPath: "Cubism Core path",
		  cubismPathHint: "A live2dcubismcore.min.js file, or the folder containing it. Leave empty to use the data folder.",
		  modeTitle: "Mode",
		  modeAuto: "Auto",
		  modeTask: "Agent-driven",
		  modeCompanion: "Screenshot-driven",
		  modeEffective: "Auto currently resolves to: {mode}",
		  alwaysOnTop: "Always on top",
		  emotionEngine: "Emotion motion engine",
		  companionInterval: "Screenshot interval",
		  companionIntervalUnit: "seconds",
		  memoryTitle: "Companion memory",
		  memoryEnabled: "Remember recent turns",
		  memoryTurns: "Turns kept",
		  memoryTurnsHint: "How many recent turns are kept and injected (1\u201330, default 8).",
		  memoryTurnsUnit: "turns",
		  memoryClear: "Clear memory",
		  memoryClearing: "Clearing\u2026",
		  memoryCleared: "Companion memory cleared.",
		  memoryCount: "Stored turns: {count}",
		  memoryPathHint: "Runtime data lives in ~/.dsh/live2d-deskpet/memory/turns.jsonl; turning the switch off keeps the file, only the clear button empties it.",
		  nsfwTitle: "\uD83D\uDD1E Adult content block",
		  nsfwEnabled: "Inject the built-in adult anchor",
		  nsfwHint: "Flipping the switch injects the plugin\u2019s built-in adult-content anchor into the companion prompt \u2014 you do not need to write anything. The text box below is only for overriding the built-in text.",
		  nsfwPromptLabel: "Custom override (optional)",
		  nsfwPlaceholder: "Leave empty to use the built-in anchor; fill in to override it.",
		  nsfwSave: "Save",
		  nsfwRestore: "Restore built-in",
		  nsfwCount: "{count} / {max} chars",
		  nsfwSaved: "Saved.",
		  nsfwSaveFailed: "Save failed",
		  screenshots: "Allow screenshots in screenshot-driven mode",
		  captureVisible: "Visible to screen capture",
		  captureVisibleHint: "When off, the pet never shows up in any screenshot or recording \u2014 including her own screen-reading captures. Turn it on when you want to record her.",
		  taskVoiceHint: "Spoken task milestones (Chinese bubble, voice in the configured language). Detected from the DSH page, so it only works while the page is open.",
		  taskVoiceOnConfirm: "Announce when I need your confirmation",
		  taskVoiceOnDone: "Announce when a task finishes",
		  taskVoiceOnStart: "Announce when a task starts (noisy)",
		  taskVoiceChannel: "Event channel",
		  taskVoiceChannelOff: "Event channel is not listening.",
		  llmTitle: "Companion LLM",
		  llmBaseUrl: "Base URL",
		  llmApiKey: "API key",
		  llmApiKeySet: "configured",
		  llmApiKeyUnset: "not configured",
		  llmApiKeyHint: "Leave empty to keep the stored key. Clear it with the Reset button.",
		  llmApiKeyKeepHint: "leave empty to keep the stored key",
		  llmApiKeyUnchanged: "Stored key left unchanged. Type a new key to replace it, or use Reset to clear it.",
		  llmModel: "Model",
		  llmVisionModel: "Vision model",
		  llmVisionHint: "Leave empty for a text-only model \u2014 companion screenshots will then be refused by the server.",
		  llmTemperature: "Temperature",
		  llmTest: "Test connection",
		  llmTesting: "Testing\u2026",
		  llmTestOk: "Connected",
		  llmTestFail: "Failed",
		  llmSavedTitle: "Saved configuration",
		  llmSavedUrl: "Saved endpoint",
		  llmSavedKey: "Saved key",
		  llmSavedModel: "Saved model",
		  llmSavedEmpty: "not set",
		  llmSavedFlash: "{field} saved",
		  llmSavedFlashFail: "{field} not saved: {reason}",
		  companionLast: "Last capture",
		  companionNever: "No capture yet in companion mode.",
		  companionCaptureOk: "captured {detail}",
		  personaTitle: "Personas",
		  personaActive: "Active persona",
		  personaDefault: "Built-in default",
		  personaNew: "New persona",
		  personaEdit: "Edit",
		  personaDelete: "Delete",
		  personaDeleteConfirm: "Delete persona {name}?",
		  personaUse: "Activate",
		  personaEmpty: "No persona yet. Create one to give the pet its own personality.",
		  personaName: "Name",
		  personaEmoji: "Badge",
		  personaPrompt: "System prompt",
		  personaPromptHint: "The persona and speaking style sent as the system message. Empty falls back to the built-in text.",
		  personaGreeting: "Greeting",
		  personaGreetingHint: "Spoken once in a bubble when this persona becomes active.",
		  personaDescription: "Description",
		  personaTags: "Tags",
		  personaSave: "Save",
		  personaCancel: "Cancel",
		  personaImport: "Import character card",
		  personaExport: "Export",
		  personaNameRequired: "Give the persona a name.",
		  personaSaveFailed: "The persona was not saved.",
		  personaImportFailed: "Import failed",
		  personaImportEmpty: "The file is empty.",
		  personaImported: "Imported\u300C{name}\u300D.",
		  personaFromCosplay: "From dsh-cosplay",
		  personaCosplayHint: "Roles already in your dsh-cosplay library. Importing one copies it here; the two libraries stay independent.",
		  personaCosplayImport: "Import",
		  windowTitle: "Window",
		  windowWidth: "Width",
		  windowHeight: "Height",
		  windowLocked: "Lock size",
		  windowLockedHint: "Locks the pet window: the corner grip hides and drag-resize stops.",
		  windowRemember: "Remember position",
		  windowRememberHint: "Restores the window where you left it across restarts.",
		  windowClickThrough: "Click through",
		  windowClickThroughHint: "Clicks pass through to the window underneath, except on the model itself \u2014 so the pet never blocks the app behind it.",
		  windowApply: "Apply size",
		  windowReset: "Reset",
		  windowOutOfRange: "Width must be {minW}\u2013{maxW}px and height {minH}\u2013{maxH}px.",
		  windowRange: "Allowed: {minW}\u2013{maxW} \xD7 {minH}\u2013{maxH} px.",
		  save: "Save",
		  saving: "Saving\u2026",
		  saved: "Saved",
		  saveFailed: "Save failed",
		  reset: "Clear",
		  voiceTitle: "Voice (GSV-TTS)",
		  voiceEnabled: "Enable local voice synthesis",
		  voiceLang: "Voice language",
		  voiceLangHint: "The bubble text always stays in the language the LLM writes (Chinese); this chooses how it is spoken.",
		  voiceLangJa: "Japanese",
		  voiceLangZh: "Chinese",
		  voiceLangAuto: "Auto",
		  voiceTest: "Test voice",
		  voiceTesting: "Synthesizing…",
		  voiceTestOk: "Voice bridge responded with audio.",
		  voiceBridgeReady: "Voice bridge ready: models are loaded and the pet will speak in this voice.",
		  voiceBridgeLoading: "Voice bridge is still loading models into VRAM (the first greeting waits for it).",
		  voiceBridgeOff: "Voice bridge is off: the pet falls back to the system voice.",
		  voiceBridgeDown: "Voice bridge is unavailable.",
		  voiceLog: "Bridge log",
		  voiceField_bridgePort: "Bridge port",
		  voiceField_workspaceDir: "Workspace root",
		  voiceWorkspaceHint: "Root of the GSV-TTS workspace. Every other voice path defaults to a fixed location under it, so one field is usually enough.",
		  voiceField_pythonPath: "Python path",
		  voicePythonHint: "python.exe of the gsv-venv environment. Leave empty to use the workspace default.",
		  voiceField_modelsDir: "Models dir",
		  voiceModelsHint: "gsv_models directory holding GPT/SoVITS models. Leave empty to use the workspace default.",
		  voiceField_tempDir: "Temp dir",
		  voiceTempHint: "Scratch directory for the bridge. Must be writable: the standard Windows temp folders make Python's temp-file creation hang here, so leave it on the workspace default unless you know better.",
		  voiceField_gptModel: "GPT .ckpt",
		  voiceField_sovitsModel: "SoVITS .pth",
		  voiceField_spkAudio: "Speaker reference",
		  voiceField_promptAudio: "Prompt audio",
		  voiceField_promptText: "Prompt transcript",
		  voicePromptHint: "Transcription of the prompt audio (Japanese).",
		  voiceField_translateUrl: "Translate endpoint",
		  voiceTranslateHint: "Optional OpenAI-compatible endpoint. When set, Japanese voice first translates the Chinese line; otherwise Chinese is read with Japanese g2p pronunciation.",
		  voiceField_translateModel: "Translate model"
		};
		var zh = {
		  nav: "Live2D \u684C\u5BA0",
		  title: "Live2D \u684C\u9762\u5BA0\u7269",
		  loading: "\u6B63\u5728\u52A0\u8F7D\u684C\u5BA0\u8BBE\u7F6E\u2026",
		  unavailable: "\u684C\u5BA0\u8BBE\u7F6E\u4E0D\u53EF\u7528\uFF1A\u5BBF\u4E3B\u547D\u540D\u7A7A\u95F4\u672A\u5BF9\u672C\u5BA2\u6237\u7AEF\u5F00\u653E\u3002",
		  modelTitle: "\u6A21\u578B",
		  modelSelect: "\u5F53\u524D\u6A21\u578B",
		  modelNone: "\u5C1A\u672A\u5BFC\u5165\u6A21\u578B",
		  modelImport: "\u5BFC\u5165\u6A21\u578B\u6587\u4EF6\u5939",
		  modelImporting: "\u5BFC\u5165\u4E2D\u2026",
		  modelRemove: "\u5220\u9664",
		  modelRemoveConfirm: "\u786E\u5B9A\u5220\u9664\u6A21\u578B\u300C{name}\u300D\u5417\uFF1F\u5176\u6587\u4EF6\u5939\u4F1A\u4ECE\u78C1\u76D8\u79FB\u9664\u3002",
		  modelOpenFolder: "\u6253\u5F00\u6A21\u578B\u76EE\u5F55",
		  modelFolderHint: "\u6240\u9009\u6587\u4EF6\u5939\u5FC5\u987B\u6070\u597D\u5305\u542B\u4E00\u4E2A .model3.json \u5B9A\u4E49\u6587\u4EF6\u3002",
		  modelUse: "\u4F7F\u7528",
		  modelEmpty: "\u8FD8\u6CA1\u6709\u6A21\u578B\u3002\u5BFC\u5165\u4E00\u4E2A\u5305\u542B .model3.json \u7684 Live2D \u6A21\u578B\u6587\u4EF6\u5939\u3002",
		  cubismReady: "Cubism Core \u5DF2\u5C31\u7EEA",
		  cubismMissing: "Cubism Core \u7F3A\u5931",
		  cubismPath: "Cubism Core \u8DEF\u5F84",
		  cubismPathHint: "\u6307\u5411 live2dcubismcore.min.js \u6587\u4EF6\uFF0C\u6216\u5305\u542B\u5B83\u7684\u76EE\u5F55\u3002\u7559\u7A7A\u5219\u7528\u8FD0\u884C\u6001\u6570\u636E\u76EE\u5F55\u3002",
		  modeTitle: "\u6A21\u5F0F",
		  modeAuto: "\u81EA\u52A8",
		  modeTask: "Agent\u9A71\u52A8",
		  modeCompanion: "\u622A\u56FE\u9A71\u52A8",
		  modeEffective: "\u81EA\u52A8\u6A21\u5F0F\u5F53\u524D\u843D\u5728\uFF1A{mode}",
		  alwaysOnTop: "\u7A97\u53E3\u7F6E\u9876",
		  emotionEngine: "\u60C5\u7EEA\u52A8\u4F5C\u5F15\u64CE",
		  companionInterval: "\u622A\u56FE\u95F4\u9694",
		  companionIntervalUnit: "\u79D2\uFF08\u6700\u5C0F 10\uFF09",
		  memoryTitle: "\u966A\u4F34\u8BB0\u5FC6",
		  memoryEnabled: "\u8BB0\u4F4F\u6700\u8FD1\u51E0\u8F6E\u5BF9\u8BDD",
		  memoryTurns: "\u4FDD\u7559\u8F6E\u6570",
		  memoryTurnsHint: "\u4FDD\u7559\u5E76\u6CE8\u5165\u7684\u6700\u8FD1\u8F6E\u6570\uFF081\u201330\uFF0C\u9ED8\u8BA4 8\uFF09\u3002",
		  memoryTurnsUnit: "\u8F6E",
		  memoryClear: "\u6E05\u7A7A\u8BB0\u5FC6",
		  memoryClearing: "\u6E05\u7A7A\u4E2D\u2026",
		  memoryCleared: "\u5DF2\u6E05\u7A7A\u966A\u4F34\u8BB0\u5FC6\u3002",
		  memoryCount: "\u5F53\u524D\u6761\u76EE\u6570\uFF1A{count}",
		  memoryPathHint: "\u8FD0\u884C\u65F6\u6570\u636E\u4FDD\u5B58\u5728 ~/.dsh/live2d-deskpet/memory/turns.jsonl\uFF1B\u5173\u95ED\u5F00\u5173\u4E0D\u5220\u6587\u4EF6\uFF0C\u53EA\u6709\u300C\u6E05\u7A7A\u8BB0\u5FC6\u300D\u4F1A\u6E05\u7A7A\u5B83\u3002",
		  nsfwTitle: "\uD83D\uDD1E nsfw\u63D0\u793A\u6BB5",
		  nsfwEnabled: "\u5F00\u542Fnsfw\u966A\u4F34\u951A\u5B9A\u5757",
		  nsfwHint: "\u5F00\u5173\u6253\u5F00\u5373\u6CE8\u5165\u63D2\u4EF6\u5185\u7F6E\u7684\u951A\u5B9A\u5757\uFF0C\u65E0\u9700\u586B\u5199\u4EFB\u4F55\u63D0\u793A\u8BCD\uFF1B\u4E0B\u65B9\u6587\u672C\u6846\u53EA\u5728\u60F3\u8986\u76D6\u5185\u7F6E\u6B63\u6587\u65F6\u624D\u7528\u3002",
		  nsfwPromptLabel: "\u81EA\u5B9A\u4E49\u8986\u76D6\u6B63\u6587\uFF08\u53EF\u9009\uFF09",
		  nsfwPlaceholder: "\u7559\u7A7A\u4F7F\u7528\u5185\u7F6E\u951A\u5B9A\u5757\uFF1B\u586B\u5199\u5219\u8986\u76D6\u5185\u7F6E\u6B63\u6587",
		  nsfwSave: "\u4FDD\u5B58",
		  nsfwRestore: "\u6062\u590D\u5185\u7F6E",
		  nsfwCount: "{count} / {max} \u5B57",
		  nsfwSaved: "\u5DF2\u4FDD\u5B58\u3002",
		  nsfwSaveFailed: "\u4FDD\u5B58\u5931\u8D25",
		  screenshots: "\u622A\u56FE\u9A71\u52A8\u6A21\u5F0F\u5141\u8BB8\u622A\u5C4F",
		  captureVisible: "\u5BF9\u7CFB\u7EDF\u622A\u56FE\u53EF\u89C1",
		  captureVisibleHint: "\u5173\u6389\u65F6\uFF0C\u684C\u5BA0\u4E0D\u4F1A\u51FA\u73B0\u5728\u4EFB\u4F55\u622A\u56FE\u6216\u5F55\u5C4F\u91CC\uFF08\u5305\u62EC\u5979\u81EA\u5DF1\u7684\u5C4F\u5E55\u7406\u89E3\u622A\u56FE\uFF09\uFF1B\u9700\u8981\u5F55\u5C4F\u5C55\u793A\u5979\u65F6\u518D\u6253\u5F00\u3002",
		  taskVoiceHint: "\u4EFB\u52A1\u8282\u70B9\u8BED\u97F3\uFF08\u6C14\u6CE1\u4E2D\u6587\u3001\u53D1\u97F3\u8BED\u79CD\u8DDF\u968F\u8BED\u97F3\u8BBE\u7F6E\uFF09\u3002\u4FE1\u53F7\u6765\u81EA DSH \u9875\u9762\uFF0C\u6240\u4EE5\u53EA\u5728\u9875\u9762\u5F00\u7740\u65F6\u751F\u6548\u3002",
		  taskVoiceOnConfirm: "\u9700\u8981\u6211\u786E\u8BA4\u65F6\u63D0\u9192",
		  taskVoiceOnDone: "\u4EFB\u52A1\u5B8C\u6210\u65F6\u63D0\u9192",
		  taskVoiceOnStart: "\u4EFB\u52A1\u5F00\u59CB\u65F6\u63D0\u9192\uFF08\u8F83\u5435\uFF09",
		  taskVoiceChannel: "\u4E8B\u4EF6\u901A\u9053",
		  taskVoiceChannelOff: "\u4E8B\u4EF6\u901A\u9053\u672A\u76D1\u542C\u3002",
		  llmTitle: "\u966A\u4F34 LLM",
		  llmBaseUrl: "Base URL",
		  llmApiKey: "API \u5BC6\u94A5",
		  llmApiKeySet: "\u5DF2\u914D\u7F6E",
		  llmApiKeyUnset: "\u672A\u914D\u7F6E",
		  llmApiKeyHint: "\u7559\u7A7A\u8868\u793A\u4E0D\u6539\u52A8\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5\uFF1B\u5982\u9700\u6E05\u9664\u8BF7\u7528\u300C\u6E05\u9664\u300D\u6309\u94AE\u3002",
		  llmApiKeyKeepHint: "\u7559\u7A7A\u5373\u4FDD\u6301\u5DF2\u5B58\u5BC6\u94A5\u4E0D\u53D8",
		  llmApiKeyUnchanged: "\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5\u672A\u4F5C\u4FEE\u6539\u3002\u8981\u66FF\u6362\u8BF7\u8F93\u5165\u65B0\u5BC6\u94A5\u540E\u4FDD\u5B58\uFF0C\u8981\u6E05\u9664\u8BF7\u7528\u300C\u6E05\u9664\u300D\u3002",
		  llmModel: "\u6A21\u578B",
		  llmVisionModel: "\u89C6\u89C9\u6A21\u578B",
		  llmVisionHint: "\u7EAF\u6587\u672C\u6A21\u578B\u53EF\u7559\u7A7A \u2014\u2014 \u6B64\u65F6\u966A\u4F34\u622A\u5C4F\u4F1A\u88AB\u670D\u52A1\u7AEF\u62D2\u7EDD\u3002",
		  llmTemperature: "\u6E29\u5EA6",
		  llmTest: "\u6D4B\u8BD5\u8FDE\u63A5",
		  llmTesting: "\u6D4B\u8BD5\u4E2D\u2026",
		  llmTestOk: "\u8FDE\u63A5\u6210\u529F",
		  llmTestFail: "\u8FDE\u63A5\u5931\u8D25",
		  llmSavedTitle: "\u5DF2\u4FDD\u5B58\u7684\u914D\u7F6E",
		  llmSavedUrl: "\u5DF2\u4FDD\u5B58\u7684\u7AEF\u70B9",
		  llmSavedKey: "\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5",
		  llmSavedModel: "\u5DF2\u4FDD\u5B58\u7684\u6A21\u578B",
		  llmSavedEmpty: "\u672A\u8BBE\u7F6E",
		  llmSavedFlash: "{field} \u5DF2\u4FDD\u5B58",
		  llmSavedFlashFail: "{field} \u4FDD\u5B58\u5931\u8D25\uFF1A{reason}",
		  companionLast: "\u6700\u8FD1\u4E00\u6B21\u622A\u5C4F",
		  companionNever: "\u966A\u4F34\u6A21\u5F0F\u8FD8\u6CA1\u6709\u622A\u8FC7\u5C4F\u3002",
		  companionCaptureOk: "\u5DF2\u622A\u53D6 {detail}",
		  personaTitle: "\u4EBA\u8BBE",
		  personaActive: "\u5F53\u524D\u4EBA\u8BBE",
		  personaDefault: "\u5185\u7F6E\u9ED8\u8BA4",
		  personaNew: "\u65B0\u5EFA\u4EBA\u8BBE",
		  personaEdit: "\u7F16\u8F91",
		  personaDelete: "\u5220\u9664",
		  personaDeleteConfirm: "\u786E\u5B9A\u5220\u9664\u4EBA\u8BBE\u300C{name}\u300D\u5417\uFF1F",
		  personaUse: "\u8BBE\u4E3A\u5F53\u524D",
		  personaEmpty: "\u8FD8\u6CA1\u6709\u4EBA\u8BBE\u3002\u65B0\u5EFA\u4E00\u4E2A\u4EBA\u8BBE\uFF0C\u8BA9\u684C\u5BA0\u62E5\u6709\u81EA\u5DF1\u7684\u6027\u683C\u3002",
		  personaName: "\u540D\u79F0",
		  personaEmoji: "\u6807\u8BB0",
		  personaPrompt: "\u7CFB\u7EDF\u63D0\u793A\u8BCD",
		  personaPromptHint: "\u4F5C\u4E3A system \u6D88\u606F\u53D1\u9001\u7684\u4EBA\u683C\u4E0E\u8BF4\u8BDD\u65B9\u5F0F\u3002\u7559\u7A7A\u5219\u56DE\u9000\u5185\u7F6E\u6587\u6848\u3002",
		  personaGreeting: "\u95EE\u5019\u8BED",
		  personaGreetingHint: "\u5207\u6362\u5230\u6B64\u4EFD\u4EBA\u8BBE\u65F6\u5728\u6C14\u6CE1\u91CC\u8BF4\u4E00\u53E5\u3002",
		  personaDescription: "\u7B80\u4ECB",
		  personaTags: "\u6807\u7B7E",
		  personaSave: "\u4FDD\u5B58",
		  personaCancel: "\u53D6\u6D88",
		  personaImport: "\u5BFC\u5165\u89D2\u8272\u5361",
		  personaExport: "\u5BFC\u51FA",
		  personaNameRequired: "\u8BF7\u586B\u5199\u4EBA\u8BBE\u540D\u79F0\u3002",
		  personaSaveFailed: "\u4EBA\u8BBE\u672A\u80FD\u4FDD\u5B58\u3002",
		  personaImportFailed: "\u5BFC\u5165\u5931\u8D25",
		  personaImportEmpty: "\u6587\u4EF6\u662F\u7A7A\u7684\u3002",
		  personaImported: "\u5DF2\u5BFC\u5165\u300C{name}\u300D\u3002",
		  personaFromCosplay: "\u6765\u81EA dsh-cosplay",
		  personaCosplayHint: "dsh-cosplay \u89D2\u8272\u5E93\u91CC\u5DF2\u6709\u7684\u89D2\u8272\u3002\u5BFC\u5165\u5373\u590D\u5236\u4E00\u4EFD\u5230\u8FD9\u91CC\uFF0C\u4E24\u4E2A\u89D2\u8272\u5E93\u5404\u81EA\u72EC\u7ACB\u3002",
		  personaCosplayImport: "\u5BFC\u5165",
		  windowTitle: "\u7A97\u53E3",
		  windowWidth: "\u5BBD",
		  windowHeight: "\u9AD8",
		  windowLocked: "\u9501\u5B9A\u5C3A\u5BF8",
		  windowLockedHint: "\u9501\u5B9A\u540E\u9690\u85CF\u53F3\u4E0B\u89D2\u628A\u624B\uFF0C\u4E5F\u4E0D\u518D\u63A5\u53D7\u62D6\u52A8\u6539\u5C3A\u5BF8\u3002",
		  windowRemember: "\u8BB0\u4F4F\u4F4D\u7F6E",
		  windowRememberHint: "\u91CD\u542F\u540E\u628A\u7A97\u53E3\u653E\u56DE\u4E0A\u6B21\u7684\u4F4D\u7F6E\u3002",
		  windowClickThrough: "\u9F20\u6807\u7A7F\u900F",
		  windowClickThroughHint: "\u9F20\u6807\u70B9\u51FB\u4F1A\u900F\u8FC7\u7A97\u53E3\u843D\u5230\u4E0B\u4E00\u5C42\uFF0C\u53EA\u6709\u6A21\u578B\u672C\u4F53\u63A5\u6536\u70B9\u51FB\u2014\u2014\u684C\u5BA0\u4E0D\u518D\u6321\u4F4F\u540E\u9762\u7684\u7A0B\u5E8F\u3002",
		  windowApply: "\u5E94\u7528\u5C3A\u5BF8",
		  windowReset: "\u6E05\u9664",
		  windowOutOfRange: "\u5BBD\u5FC5\u987B\u5728 {minW}\u2013{maxW}px\u3001\u9AD8\u5FC5\u987B\u5728 {minH}\u2013{maxH}px \u4E4B\u95F4\u3002",
		  windowRange: "\u5141\u8BB8\u8303\u56F4\uFF1A{minW}\u2013{maxW} \xD7 {minH}\u2013{maxH} px\u3002",
		  save: "\u4FDD\u5B58",
		  saving: "\u4FDD\u5B58\u4E2D\u2026",
		  saved: "\u5DF2\u4FDD\u5B58",
		  saveFailed: "\u4FDD\u5B58\u5931\u8D25",
		  reset: "\u6E05\u9664",
		  voiceTitle: "\u8BED\u97F3\uFF08GSV-TTS\uFF09",
		  voiceEnabled: "\u542F\u7528\u672C\u5730\u8BED\u97F3\u5408\u6210",
		  voiceLang: "\u53D1\u58F0\u8BED\u79CD",
		  voiceLangHint: "\u6C14\u6CE1\u6587\u5B57\u59CB\u7EC8\u663E\u793A\u4E3A\u966A\u4F34 LLM \u5199\u7684\u4E2D\u6587\uFF1B\u8FD9\u91CC\u51B3\u5B9A\u7684\u662F\u53D1\u58F0\u8BED\u8A00\u3002",
		  voiceLangJa: "\u65E5\u8BED",
		  voiceLangZh: "\u4E2D\u6587",
		  voiceLangAuto: "\u81EA\u52A8",
		  voiceTest: "\u8BD5\u542C",
		  voiceTesting: "\u5408\u6210\u4E2D\u2026",
		  voiceTestOk: "\u8BED\u97F3\u6865\u5DF2\u8FD4\u56DE\u97F3\u9891\u3002",
		  voiceBridgeReady: "\u8BED\u97F3\u6865\u5C31\u7EEA\uFF1A\u6A21\u578B\u5DF2\u8F7D\u5165\uFF0C\u684C\u5BA0\u5C06\u7528\u6B64\u97F3\u8272\u53D1\u58F0\u3002",
		  voiceBridgeLoading: "\u8BED\u97F3\u6865\u6B63\u5728\u628A\u6A21\u578B\u8F7D\u5165\u663E\u5B58\uFF08\u9996\u53E5\u95EE\u5019\u4F1A\u7B49\u5B83\u5C31\u7EEA\uFF09\u3002",
		  voiceBridgeOff: "\u8BED\u97F3\u6865\u672A\u542F\u7528\uFF1A\u684C\u5BA0\u4F1A\u9000\u56DE\u7CFB\u7EDF\u97F3\u8272\u3002",
		  voiceBridgeDown: "\u8BED\u97F3\u6865\u4E0D\u53EF\u7528\u3002",
		  voiceLog: "\u6865\u65E5\u5FD7",
		  voiceField_bridgePort: "\u6865\u7AEF\u53E3",
		  voiceField_workspaceDir: "GSV \u5DE5\u4F5C\u533A\u6839\u76EE\u5F55",
		  voiceWorkspaceHint: "\u4E0B\u9762\u90A3\u4E9B\u8DEF\u5F84\u7559\u7A7A\u65F6\uFF0C\u90FD\u6309\u8FD9\u4E2A\u6839\u76EE\u5F55\u4E0B\u7684\u56FA\u5B9A\u4F4D\u7F6E\u63A8\u5BFC\uFF08gsv-venv / gsv_models / gsv-tts-lite / tmp\uFF09\uFF0C\u4E00\u822C\u53EA\u9700\u586B\u8FD9\u4E00\u9879\u3002",
		  voiceField_pythonPath: "Python \u8DEF\u5F84",
		  voicePythonHint: "gsv-venv \u73AF\u5883\u7684 python.exe\uFF1B\u7559\u7A7A\u4F7F\u7528\u5DE5\u4F5C\u533A\u9ED8\u8BA4\u3002",
		  voiceField_modelsDir: "\u6A21\u578B\u76EE\u5F55",
		  voiceModelsHint: "gsv_models \u76EE\u5F55\uFF08\u542B GPT/SoVITS \u6A21\u578B\uFF09\uFF1B\u7559\u7A7A\u4F7F\u7528\u5DE5\u4F5C\u533A\u9ED8\u8BA4\u3002",
		  voiceField_tempDir: "\u4E34\u65F6\u76EE\u5F55",
		  voiceTempHint: "\u8BED\u97F3\u6865\u7684\u4E34\u65F6\u6587\u4EF6\u76EE\u5F55\uFF0C\u5FC5\u987B\u53EF\u5199\u3002Windows \u9ED8\u8BA4 temp \u76EE\u5F55\u4F1A\u8BA9 Python \u5EFA\u4E34\u65F6\u6587\u4EF6\u65F6\u6C38\u4E45\u6302\u8D77\uFF08\u6A21\u578B\u8F7D\u5165\u5931\u8D25\uFF09\uFF0C\u9664\u975E\u4F60\u786E\u5B9A\u6709\u522B\u7684\u53EF\u5199\u76EE\u5F55\uFF0C\u5426\u5219\u8BF7\u7559\u7A7A\u7528\u5DE5\u4F5C\u533A\u9ED8\u8BA4\u3002",
		  voiceField_gptModel: "GPT \u6A21\u578B",
		  voiceField_sovitsModel: "SoVITS \u6A21\u578B",
		  voiceField_spkAudio: "\u8BF4\u8BDD\u4EBA\u53C2\u8003\u97F3\u9891",
		  voiceField_promptAudio: "\u63D0\u793A\u97F3\u9891",
		  voiceField_promptText: "\u63D0\u793A\u97F3\u9891\u6587\u672C",
		  voicePromptHint: "\u63D0\u793A\u97F3\u9891\u5BF9\u5E94\u7684\u8F6C\u5199\u6587\u672C\uFF08\u65E5\u8BED\uFF09\u3002",
		  voiceField_translateUrl: "\u4E2D\u8BD1\u65E5\u7AEF\u70B9",
		  voiceTranslateHint: "\u53EF\u9009\u3002OpenAI \u517C\u5BB9\u7AEF\u70B9\uFF0B\u6A21\u578B\u540D\uFF1B\u914D\u7F6E\u540E\u65E5\u8BED\u53D1\u58F0\u5148\u628A\u4E2D\u6587\u771F\u8BD1\u6210\u65E5\u6587\u518D\u5408\u6210\uFF0C\u672A\u914D\u7F6E\u5219\u9000\u5316\u4E3A\u65E5\u8BED\u97F3\u8BFB\u3002",
		  voiceField_translateModel: "\u7FFB\u8BD1\u6A21\u578B"
		};

		// src/client/index.ts
		var name = "live2d-deskpet-client";
		var inject = ["remote", "remote.settings", "slots", "locale", "connection"];
		var DESKPET_LOCALE_NAMESPACE = "settings.live2dDeskpet";
		/**
		 * 0.2.x 挂载姿势（对照 dsh-cosplay 的硬约束）：
		 *   1. 不要用 ctx.effect 包挂载（effect 的 rejection 会被 cordis 吞掉，页面永远
		 *      停在「加载中/未开放」）——apply 自身 async 并 await 挂载；
		 *   2. 读 ctx.remote.<ns> 前必须 ctx.inject(['remote.<ns>']) 声明；
		 *   3. 注入必须在 $mount 之后发起，否则自依赖死锁；
		 *   4. **失败绝不抛穿 apply**：桌面版 web-boot 把任何客户端 entry 失败当作致命
		 *      错误，会自动摘掉全部第三方插件 bundle 并重启进「安全模式」。挂载失败改为
		 *      把原因写进设置页（用户看得见），DSH 其余部分不受影响。
		 */
		async function apply(rawCtx) {
		  const ctx = rawCtx;
		  const controller = new DeskpetController(rawCtx);
		  const cleanups = [];
		  // 文案与样式和远端无关：先装上，保证设置页永远有可渲染的壳。
		  ctx.effect(() => ctx.locale.register(DESKPET_LOCALE_NAMESPACE, { zh, en }), "live2d-deskpet: settings dictionaries");
		  ctx.effect(() => {
		    const element = document.createElement("style");
		    element.textContent = SECTION_CSS;
		    document.head.append(element);
		    return () => {
		      element.remove();
		    };
		  }, "live2d-deskpet: section interaction styles");
		  // 任务节点观察器：跑在页面里，和设置页开没开无关，所以在这里装而不是
		  // 在 registerSection 里。失败只记日志，绝不抛穿 apply。
		  try {
		    cleanups.push(installTaskObserver());
		  } catch (error) {
		    console.error("[dsh-live2d-deskpet] 任务节点观察器安装失败（已跳过）：", error);
		  }
		  // 0.2.3：页面焦点上报（自动模式的第二判据）。同样不许抛穿 apply。
		  try {
		    cleanups.push(installPageFocusReporter());
		  } catch (error) {
		    console.error("[dsh-live2d-deskpet] 页面焦点上报安装失败（已跳过）：", error);
		  }
		  /** 注册设置页分区并接上 controller（远端成败都必须有 UI）。 */
		  const registerSection = (scope) => {
		    const bind = scope.locale.bind(DESKPET_LOCALE_NAMESPACE);
		    const translate = (key) => {
		      const value = bind(key);
		      return typeof value === "string" && value !== "" ? value : zh[key] ?? en[key] ?? key;
		    };
		    setTranslator(translate);
		    const unregister = scope.slots.inject("settings.section", () => scope.slots.register(
		      // 0.2.x：priority 是主排序键（越小越先渲染）；label 用注册时求值的字符串。
		      { name: "settings.section", id: "live2d-deskpet", priority: 90, label: translate("nav") },
		      () => import_react7.createElement(DeskpetSection, { controller })
		    ));
		    const stopObservation = controller.load();
		    void controller.refreshRemote();
		    return () => {
		      if (typeof unregister === "function") unregister();
		      stopObservation?.();
		    };
		  };
		  try {
		    cleanups.push(await ctx.remote.$mount(DESKPET_REMOTE));
		    const ui = ctx.inject(["remote.live2dDeskpet", "slots", "locale"], (child) => {
		      const api = child.remote?.live2dDeskpet;
		      if (api === void 0) {
		        throw new Error("the deskpet Remote namespace did not resolve after mount");
		      }
		      controller.attachRemote(api);
		      // 任务事件通道端口是配置项：挂载后先读一次，观察器才知道往哪发。
		      void api.getState().then(function (response) {
		        var port = Number(response && response.value && response.value.runtime ? response.value.runtime.taskChannelPort : 0);
		        if (Number.isFinite(port) && port > 0) taskChannelPort = port;
		      }).catch(function () {});
		      return registerSection(child);
		    });
		    await ui;
		    cleanups.push(() => ui.dispose());
		  } catch (error) {
		    const message = String(error?.message ?? error);
		    console.error("[dsh-live2d-deskpet] Remote 挂载失败（已降级，不阻断启动）：", message);
		    controller.set({ status: "unavailable", error: "桌宠 Remote 挂载失败：" + message });
		    try {
		      cleanups.push(registerSection(ctx));
		    } catch (sectionError) {
		      console.error("[dsh-live2d-deskpet] 设置页注册也失败：", sectionError);
		    }
		  }
		  return async () => {
		    for (const dispose of cleanups.reverse()) {
		      try {
		        await dispose();
		      } catch { /* 卸载阶段的异常吞掉即可 */ }
		    }
		  };
		}
		return module.exports;
	}
});
