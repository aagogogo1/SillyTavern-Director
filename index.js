import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "SillyTavern-Director";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const chatMetadataKey = `${extensionName}:chat-state`;
const injectionPosition = 1; // IN_CHAT：作为消息注入聊天历史
const injectionDepth = 0;   // depth=0：插入在最末尾，紧贴生成前
const floatingButtonMargin = 12;

const defaultSettings = Object.freeze({
  enabled: true,
  antiSpoiler: true,
  autoGeneratePlot: true,
  floatingButtonPosition: {
    left: null,
    top: null,
  },
  generationApi: {
    name: "生成连接",
    url: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    modelList: [],
  },
  analysisApi: {
    name: "分析连接",
    url: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    modelList: [],
  },
  analysisHistoryDepth: 10,
  nodeGenerationCount: 4,
  promptTemplates: {
    nodeGenerationSystem: [
      "你是一个故事导演策划器，同时具备剧本作家和小说编辑的创作视角。",
      "你的任务是根据用户提供的情节构想（可能很简短或粗略），先对其进行润色和扩充，再生成该情节的有序节点序列。",
      "",
      "处理流程：",
      "1. 理解意图：从用户的简短输入中推断故事背景、人物关系、核心冲突和情节走向。",
      "2. 润色扩充：在忠实用户意图的前提下，补充合理的氛围铺垫、角色动机和情节细节，使情节更完整丰满、更具叙事张力。",
      "3. 拆分节点：将润色后的情节拆分为有序的可执行事件节点，每个节点代表一个明确发生的关键转折或场景。",
      "",
      "节点要求：",
      "- 节点按推进顺序排列，每个节点清晰描述一件具体发生的事。",
      "- 节点内容要有画面感，包含动作、反应或环境变化，不只是抽象概念。",
      "- 不要生成空节点、重复节点或仅描述情绪状态而不推动剧情的节点。",
      "- 涉及主角、玩家、用户或第一人称主视角角色时，统一写成 <user>，不要写真实名字。",
      "",
      "输出要求：",
      "- 输出合法 JSON，不要输出 Markdown 代码块，不要输出解释文字。",
      "- summary 字段为润色扩充后的完整情节概述，应比用户原始输入更详细、更具文学质感。",
      "- 节点的数量必须严格遵循用户要求的个数，不要多也不要少。",
      "- 只输出单个 JSON 对象，顶层字段只有 title、summary、nodes。",
      "- 输出格式：{\"title\":string,\"summary\":string,\"nodes\":[{\"title\":string,\"content\":string}]}"
    ].join("\n"),
    nodeAnalysisSystem: [
      "你是故事导演进度追踪器。",
      "你会收到当前尚未处理的节点列表和最近一段聊天记录（包含角色和用户的全部发言）。",
      "你的任务是根据完整的聊天记录，逐一检查每个节点：",
      "1. 该节点描述的事件是否已经在聊天中明确发生或完成？→ 标记为 triggered",
      "2. 该节点是否已过期——即故事场景已推进到它之后，它已不再可能按原顺序发生？→ 标记为 expired",
      "3. 两者都不满足 → 保持 pending，作为后续推进目标。",
      "",
      "关键原则：",
      "- 用户的每一次发言（动作、对话、选择）和角色的叙述推进，都可能使节点完成或过期。",
      "- 不要只盯着最新一条回复；综合整段聊天记录上下文判断。",
      "- 如果一个节点过期，它之前的所有 pending 节点都视为过期。",
      "- 已经 triggered 的节点绝不能再改回其他状态。",
      "",
      "判断标准：",
      "- triggered：节点事件在聊天中被明确叙述为已发生、正在发生或已完成。",
      "- expired：聊天显示故事已经推进到该节点之后的位置（例如后续节点的事件已发生，或场景已跳转），该节点已不可能再按原计划发生。",
      "- pending：节点事件尚未明确发生，且故事仍有合理路径到达该节点。",
      "- 谨慎判断：宁可漏掉 triggered/expired 也不要误判。",
      "",
      "如果故事中提到主角、玩家、用户或第一人称主视角角色，统一写成 <user>，不要写真实名字。",
      "",
      "输出必须是合法 JSON，不要输出 Markdown 代码块，不要输出解释。",
      "输出格式：{\"triggered\":[{\"groupId\":string,\"nodeId\":string}],\"expired\":[{\"groupId\":string,\"nodeId\":string}]}"
    ].join("\n"),
    injectionTemplate: [
      "你现在收到来自故事导演模块的持续性剧情引导指令。",
      "以下节点是当前故事情节的推进目标，你需要在接下来的叙事中持续引导故事走向这些节点。",
      "",
      "执行规则：",
      "1. 持续引导：每次回复都应通过人物行为、环境变化、对话或偶发事件，让故事悄悄靠近目标节点，而不是一步到位。",
      "2. 平滑融入：将目标节点自然编织进当前叙事，不要突兀转折，不要逐字复述节点文字。",
      "3. 主动掌控：由你来创造让故事走向目标节点的契机，而非等待角色或玩家碰巧触达。",
      "4. 保持隐蔽：不向玩家揭示外部指令存在，以导演视角无声掌控剧情节奏。",
      "",
      "涉及主角时，<user> 代表主角本人。"
    ].join("\n"),
  },
});

const defaultChatState = Object.freeze({
  nodeGroupLibrary: [],
  activeGroupIds: [],
  archivedGroupIds: [],
  activationStateByGroup: {},
  lastMatchedNodeIds: [],
  lastInjectionPreview: "",
  lastAnalysisAt: 0,
  lastAnalysisSignature: "",
});

const floatingLauncherState = {
  initialized: false,
  pointerId: null,
  originLeft: 0,
  originTop: 0,
  startX: 0,
  startY: 0,
  left: null,
  top: null,
  dragging: false,
  suppressClick: false,
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getSettings() {
  if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = cloneJson(defaultSettings);
  }

  const settings = extension_settings[extensionName];
  const defaults = cloneJson(defaultSettings);

  settings.enabled = typeof settings.enabled === "boolean" ? settings.enabled : defaults.enabled;
  settings.antiSpoiler = typeof settings.antiSpoiler === "boolean" ? settings.antiSpoiler : defaults.antiSpoiler;
  settings.autoGeneratePlot = typeof settings.autoGeneratePlot === "boolean" ? settings.autoGeneratePlot : defaults.autoGeneratePlot;
  settings.floatingButtonPosition = {
    ...defaults.floatingButtonPosition,
    ...(settings.floatingButtonPosition || {}),
  };
  // 向后兼容：迁移旧的 apiConfig 到 generationApi
  if (settings.apiConfig && !settings.generationApi) {
    settings.generationApi = { ...defaults.generationApi, ...settings.apiConfig };
    if (Array.isArray(settings.modelList)) settings.generationApi.modelList = settings.modelList;
    delete settings.apiConfig;
    delete settings.modelList;
  }
  settings.generationApi = { ...defaults.generationApi, ...(settings.generationApi || {}) };
  settings.generationApi.modelList = Array.isArray(settings.generationApi.modelList) ? settings.generationApi.modelList : [];
  settings.analysisApi = { ...defaults.analysisApi, ...(settings.analysisApi || {}) };
  settings.analysisApi.modelList = Array.isArray(settings.analysisApi.modelList) ? settings.analysisApi.modelList : [];
  settings.analysisHistoryDepth = clampNumber(settings.analysisHistoryDepth, 1, 50, defaults.analysisHistoryDepth);
  settings.nodeGenerationCount = clampNumber(settings.nodeGenerationCount, 1, 50, defaults.nodeGenerationCount);
  settings.promptTemplates = { ...defaults.promptTemplates, ...(settings.promptTemplates || {}) };

  return settings;
}

function getChatState() {
  const context = getContext();
  const chatMetadata = context.chatMetadata || {};

  if (!chatMetadata[chatMetadataKey]) {
    chatMetadata[chatMetadataKey] = cloneJson(defaultChatState);
  }

  const state = chatMetadata[chatMetadataKey];
  state.nodeGroupLibrary = Array.isArray(state.nodeGroupLibrary) ? state.nodeGroupLibrary : [];
  state.activeGroupIds = Array.isArray(state.activeGroupIds) ? state.activeGroupIds : [];
  state.archivedGroupIds = Array.isArray(state.archivedGroupIds) ? state.archivedGroupIds : [];
  state.activationStateByGroup = state.activationStateByGroup || {};
  state.lastMatchedNodeIds = Array.isArray(state.lastMatchedNodeIds) ? state.lastMatchedNodeIds : [];
  state.lastInjectionPreview = state.lastInjectionPreview || "";
  state.lastAnalysisAt = Number(state.lastAnalysisAt || 0);
  state.lastAnalysisSignature = state.lastAnalysisSignature || "";

  return state;
}

async function saveChatState() {
  const context = getContext();
  if (typeof context.saveMetadata === "function") {
    await context.saveMetadata();
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createId(prefix) {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function setStatus(selector, message, type = "info") {
  const element = $(selector);
  element
    .removeClass("director-status-info director-status-success director-status-warning director-status-error")
    .addClass(`director-status-${type}`)
    .text(message || "");
}

function getFloatingButtonElement() {
  return $("#director_floating_button");
}

function getViewportMetrics() {
  const visualViewport = window.visualViewport;
  const width = visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0;
  const height = visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
  const offsetLeft = visualViewport?.offsetLeft || 0;
  const offsetTop = visualViewport?.offsetTop || 0;

  return {
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
    offsetLeft: Math.max(0, Math.round(offsetLeft)),
    offsetTop: Math.max(0, Math.round(offsetTop)),
    constrained: Boolean(visualViewport && width < window.innerWidth),
  };
}

function updateDirectorViewportState() {
  const shell = $(".director-shell");
  if (!shell.length) {
    return;
  }

  const { width, height, offsetLeft, offsetTop, constrained } = getViewportMetrics();
  shell.css({
    "--director-viewport-width": `${width}px`,
    "--director-viewport-height": `${height}px`,
    "--director-viewport-offset-left": `${offsetLeft}px`,
    "--director-viewport-offset-top": `${offsetTop}px`,
  });

  shell.toggleClass("is-compact", width <= 700);
  shell.toggleClass("is-narrow", width <= 480);
  shell.toggleClass("is-constrained", constrained);
}

function setFloatingButtonPosition(left, top) {
  const button = getFloatingButtonElement();
  if (!button.length) {
    return;
  }

  const { width: viewportWidth, height: viewportHeight } = getViewportMetrics();

  const maxLeft = Math.max(floatingButtonMargin, viewportWidth - button.outerWidth() - floatingButtonMargin);
  const maxTop = Math.max(floatingButtonMargin, viewportHeight - button.outerHeight() - floatingButtonMargin);
  const nextLeft = clampValue(left, floatingButtonMargin, maxLeft);
  const nextTop = clampValue(top, floatingButtonMargin, maxTop);

  floatingLauncherState.left = nextLeft;
  floatingLauncherState.top = nextTop;

  button.css({
    left: `${nextLeft}px`,
    top: `${nextTop}px`,
    right: "auto",
    bottom: "auto",
  });
}

function persistFloatingButtonPosition() {
  const settings = getSettings();
  settings.floatingButtonPosition = {
    left: floatingLauncherState.left,
    top: floatingLauncherState.top,
  };
  saveSettingsDebounced();
}

function ensureFloatingButtonPosition() {
  const button = getFloatingButtonElement();
  if (!button.length) {
    return;
  }

  updateDirectorViewportState();

  const width = button.outerWidth() || 0;
  const height = button.outerHeight() || 0;
  const { width: viewportWidth, height: viewportHeight } = getViewportMetrics();
  const defaultLeft = Math.max(floatingButtonMargin, viewportWidth - width - 24);
  const defaultTop = Math.max(floatingButtonMargin, viewportHeight - height - 88);
  const settings = getSettings();
  const savedLeft = Number.isFinite(Number(settings.floatingButtonPosition?.left))
    ? Number(settings.floatingButtonPosition.left)
    : null;
  const savedTop = Number.isFinite(Number(settings.floatingButtonPosition?.top))
    ? Number(settings.floatingButtonPosition.top)
    : null;

  setFloatingButtonPosition(
    floatingLauncherState.left ?? savedLeft ?? defaultLeft,
    floatingLauncherState.top ?? savedTop ?? defaultTop,
  );
}

function openDirectorModal() {
  const modal = $("#director_modal");
  updateDirectorViewportState();
  modal.addClass("is-open").attr("aria-hidden", "false");
  $("body").addClass("director-modal-open");
}

function closeDirectorModal() {
  const modal = $("#director_modal");
  modal.removeClass("is-open").attr("aria-hidden", "true");
  $("body").removeClass("director-modal-open");
}

function initializeFloatingLauncher() {
  if (floatingLauncherState.initialized) {
    updateDirectorViewportState();
    ensureFloatingButtonPosition();
    return;
  }

  floatingLauncherState.initialized = true;
  updateDirectorViewportState();
  ensureFloatingButtonPosition();

  const handleViewportChange = () => {
    updateDirectorViewportState();
    ensureFloatingButtonPosition();
  };

  $(window)
    .off("resize.directorLauncher")
    .on("resize.directorLauncher orientationchange.directorLauncher", handleViewportChange);

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", handleViewportChange, { passive: true });
    window.visualViewport.addEventListener("scroll", handleViewportChange, { passive: true });
  }
}

function serializeConversation(messages) {
  const context = getContext();
  const userNameCandidates = [context?.name1, context?.userName, context?.chatMetadata?.persona];
  const validUserNames = userNameCandidates.filter(Boolean).map((entry) => String(entry));

  return messages.map((message) => {
    const speaker = message.is_user ? "<user>" : (message.name || context?.name2 || "assistant");
    let content = String(message.mes || message.message || "").trim();

    for (const candidate of validUserNames) {
      content = content.replaceAll(candidate, "<user>");
    }

    return `${speaker}: ${content}`.trim();
  }).join("\n");
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error("模型返回为空");
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("未找到有效 JSON 对象");
  }

  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function normalizeUserPlaceholder(value) {
  return String(value || "")
    .replace(/<(?:\s*user\s*)>/gi, "<user>")
    .replace(/\b(?:用户|玩家|主角本人|主人公本人)\b/g, "<user>");
}

function normalizeNodeState(nodeState = {}) {
  return {
    triggered: Boolean(nodeState.triggered),
    expired: Boolean(nodeState.expired || nodeState.skipped),
    note: String(nodeState.note || ""),
  };
}

function isNodeResolved(nodeState = {}) {
  return Boolean(nodeState.triggered || nodeState.expired);
}

function getFirstPendingNode(nodes = []) {
  return nodes.find((node) => !isNodeResolved(node)) || null;
}

function hashString(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash >>> 0);
}

function getLibraryGroupById(groupId) {
  return getChatState().nodeGroupLibrary.find((group) => group.id === groupId) || null;
}

function syncChatStateWithLibrary() {
  const state = getChatState();
  const validGroupIds = new Set(state.nodeGroupLibrary.map((group) => group.id));

  state.activeGroupIds = state.activeGroupIds.filter((groupId) => validGroupIds.has(groupId));
  state.archivedGroupIds = state.archivedGroupIds.filter((groupId) => validGroupIds.has(groupId));

  for (const groupId of Object.keys(state.activationStateByGroup)) {
    if (!validGroupIds.has(groupId)) {
      delete state.activationStateByGroup[groupId];
      continue;
    }

    const group = getLibraryGroupById(groupId);
    const activationState = state.activationStateByGroup[groupId] || { nodeStateById: {} };
    activationState.nodeStateById = activationState.nodeStateById || {};
    const validNodeIds = new Set(group.nodes.map((node) => node.id));

    for (const nodeId of Object.keys(activationState.nodeStateById)) {
      if (!validNodeIds.has(nodeId)) {
        delete activationState.nodeStateById[nodeId];
      }
    }

    for (const node of group.nodes) {
      if (!activationState.nodeStateById[node.id]) {
        activationState.nodeStateById[node.id] = normalizeNodeState();
      } else {
        activationState.nodeStateById[node.id] = normalizeNodeState(activationState.nodeStateById[node.id]);
      }
    }

    state.activationStateByGroup[groupId] = activationState;
  }

  return state;
}

function ensureGroupActivated(groupId) {
  const state = syncChatStateWithLibrary();
  if (!state.activeGroupIds.includes(groupId)) {
    state.activeGroupIds.push(groupId);
  }

  const group = getLibraryGroupById(groupId);
  if (!group) {
    return;
  }

  if (!state.activationStateByGroup[groupId]) {
    state.activationStateByGroup[groupId] = { nodeStateById: {} };
  }

  for (const node of group.nodes) {
    if (!state.activationStateByGroup[groupId].nodeStateById[node.id]) {
      state.activationStateByGroup[groupId].nodeStateById[node.id] = normalizeNodeState();
    } else {
      state.activationStateByGroup[groupId].nodeStateById[node.id] = normalizeNodeState(state.activationStateByGroup[groupId].nodeStateById[node.id]);
    }
  }
}

function archiveResolvedGroups() {
  const state = getChatState();
  const toArchive = [];

  for (const groupId of state.activeGroupIds) {
    const group = getLibraryGroupById(groupId);
    if (!group) continue;
    const activationState = state.activationStateByGroup[groupId] || { nodeStateById: {} };
    const allResolved = group.nodes.every((node) => isNodeResolved(normalizeNodeState(activationState.nodeStateById[node.id])));
    if (allResolved) {
      toArchive.push(groupId);
    }
  }

  for (const groupId of toArchive) {
    state.activeGroupIds = state.activeGroupIds.filter((id) => id !== groupId);
    if (!state.archivedGroupIds.includes(groupId)) {
      state.archivedGroupIds.push(groupId);
    }
  }

  // 归档上限：仅保留最新的 3 个，删除多余的老数据
  if (state.archivedGroupIds.length > 3) {
    const toRemove = state.archivedGroupIds.slice(0, state.archivedGroupIds.length - 3);
    state.archivedGroupIds = state.archivedGroupIds.slice(-3);
    for (const groupId of toRemove) {
      state.nodeGroupLibrary = state.nodeGroupLibrary.filter((g) => g.id !== groupId);
      delete state.activationStateByGroup[groupId];
    }
  }
}

function removeActivatedGroup(groupId) {
  const state = getChatState();
  state.activeGroupIds = state.activeGroupIds.filter((candidate) => candidate !== groupId);
  delete state.activationStateByGroup[groupId];
}

function getActiveGroups() {
  const state = syncChatStateWithLibrary();
  return state.activeGroupIds
    .map((groupId) => {
      const group = getLibraryGroupById(groupId);
      if (!group) {
        return null;
      }

      const activationState = state.activationStateByGroup[groupId] || { nodeStateById: {} };
      const nodes = group.nodes.map((node) => {
        const nodeState = normalizeNodeState(activationState.nodeStateById[node.id]);
        return {
          ...node,
          triggered: nodeState.triggered,
          expired: nodeState.expired,
          note: String(nodeState.note || ""),
        };
      });

      return {
        ...group,
        nodes,
      };
    })
    .filter(Boolean);
}

function buildTriggeredSummary(groups) {
  const lines = [];
  for (const group of groups) {
    const triggeredNodes = group.nodes.filter((node) => node.triggered);
    if (triggeredNodes.length === 0) {
      continue;
    }

    lines.push(`${group.title}: ${triggeredNodes.map((node) => node.title || node.content).join("；")}`);
  }
  return lines.join("\n");
}

function buildExpiredSummary(groups) {
  const lines = [];
  for (const group of groups) {
    const expiredNodes = group.nodes.filter((node) => node.expired);
    if (expiredNodes.length === 0) {
      continue;
    }

    lines.push(`${group.title}: ${expiredNodes.map((node) => node.title || node.content).join("；")}`);
  }
  return lines.join("\n");
}

async function callDirectorApi({ messages, temperature = 0.4, apiType = "generation" }) {
  const settings = getSettings();
  const config = apiType === "analysis" ? settings.analysisApi : settings.generationApi;
  const apiUrl = trimTrailingSlash(config.url);
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "").trim();
  const label = apiType === "analysis" ? "分析" : "生成";

  if (!settings.enabled) {
    throw new Error("导演插件当前已禁用");
  }
  if (!apiUrl) {
    throw new Error(`请先填写${label}连接的 API URL`);
  }
  if (!apiKey) {
    throw new Error(`请先填写${label}连接的 API Key`);
  }
  if (!model) {
    throw new Error(`请先选择或填写${label}连接的模型名称`);
  }

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.response
    || data?.content
    || "";

  if (!content) {
    throw new Error("模型返回为空");
  }

  return String(content);
}

async function fetchModelsList(apiType = "generation") {
  const settings = getSettings();
  const config = apiType === "analysis" ? settings.analysisApi : settings.generationApi;
  const apiUrl = trimTrailingSlash(config.url);
  const apiKey = String(config.apiKey || "").trim();
  const label = apiType === "analysis" ? "分析" : "生成";

  if (!apiUrl) {
    throw new Error(`请先填写${label}连接的 API URL`);
  }
  if (!apiKey) {
    throw new Error(`请先填写${label}连接的 API Key`);
  }

  const response = await fetch(`${apiUrl}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
  config.modelList = models.map((model) => ({
    id: model.id || model.name || model.model || String(model),
  }));
  saveSettingsDebounced();
  return config.modelList;
}

function renderModelSelectFor(apiType) {
  const settings = getSettings();
  const config = apiType === "analysis" ? settings.analysisApi : settings.generationApi;
  const selected = config.model || "";
  const options = ['<option value="">选择已拉取模型</option>']
    .concat((config.modelList || []).map((model) => {
      const id = escapeHtml(model.id);
      const isSelected = model.id === selected ? " selected" : "";
      return `<option value="${id}"${isSelected}>${id}</option>`;
    }));
  const prefix = apiType === "analysis" ? "analysis" : "generation";
  $(`#director_${prefix}_model_select`).html(options.join(""));
  $(`#director_${prefix}_model_name`).val(selected);
}

function renderChatPanel() {
  const context = getContext();
  const state = syncChatStateWithLibrary();
  archiveResolvedGroups();
  const { antiSpoiler } = getSettings();
  const chatName = context?.name2 || context?.groupId || "当前会话";

  $("#director_chat_scope").text(`当前聊天：${chatName}`);

  // ── 活跃情节列表 ──
  const activeGroupIds = new Set(state.activeGroupIds);
  const activePlots = state.nodeGroupLibrary.filter((g) => activeGroupIds.has(g.id));

  if (activePlots.length === 0) {
    $("#director_plot_list").html('<div class="director-empty">还没有情节，点击“新增情节”开始创建。</div>');
  } else {
    const html = activePlots.map((group) => {
      if (group.generating) {
        return `
          <div class="director-plot-card is-generating" data-group-id="${escapeHtml(group.id)}">
            <div class="director-plot-header">
              <span class="director-plot-title">${escapeHtml(group.title)}</span>
              <span class="director-chip">生成中…</span>
            </div>
          </div>`;
      }

      if (group.generateError) {
        return `
          <div class="director-plot-card is-error" data-group-id="${escapeHtml(group.id)}">
            <div class="director-plot-header">
              <span class="director-plot-title">${escapeHtml(group.title)}</span>
              <span class="director-chip director-chip-error">生成失败</span>
              <button class="menu_button director-retry-plot" data-group-id="${escapeHtml(group.id)}" type="button">重新生成</button>
              <button class="menu_button director-remove-plot" data-group-id="${escapeHtml(group.id)}" type="button">移除</button>
            </div>
            <div class="director-plot-error-msg">${escapeHtml(group.generateError)}</div>
          </div>`;
      }

      const activationState = state.activationStateByGroup[group.id] || { nodeStateById: {} };
      const resolvedCount = group.nodes.filter((node) => isNodeResolved(normalizeNodeState(activationState.nodeStateById[node.id]))).length;
      const currentNodeId = getFirstPendingNode(group.nodes.map((node) => ({
        ...node,
        ...normalizeNodeState(activationState.nodeStateById[node.id]),
      })))?.id || "";

      if (antiSpoiler) {
        return `
          <div class="director-plot-card is-spoiler-protected" data-group-id="${escapeHtml(group.id)}">
            <div class="director-plot-header">
              <strong class="director-plot-title">${escapeHtml(group.title)}</strong>
              <span class="director-chip">${resolvedCount}/${group.nodes.length} 已处理</span>
              <button class="menu_button director-remove-plot" data-group-id="${escapeHtml(group.id)}" type="button">移除</button>
            </div>
          </div>`;
      }

      return `
        <div class="director-plot-card" data-group-id="${escapeHtml(group.id)}">
          <div class="director-plot-header">
            <span class="director-plot-chevron">▶</span>
            <strong class="director-plot-title">${escapeHtml(group.title)}</strong>
            <span class="director-chip">${resolvedCount}/${group.nodes.length} 已处理</span>
            <button class="menu_button director-remove-plot" data-group-id="${escapeHtml(group.id)}" type="button">移除</button>
          </div>
          <div class="director-plot-body">
            <div class="director-active-summary">${escapeHtml(group.summary || "")}</div>
            <div class="director-node-state-list">
              ${group.nodes.map((node) => {
                const nodeState = normalizeNodeState(activationState.nodeStateById[node.id]);
                const statusKey = nodeState.triggered
                  ? "completed"
                  : (nodeState.expired ? "expired" : (node.id === currentNodeId ? "current" : "pending"));
                const statusLabel = statusKey === "completed"
                  ? "已完成"
                  : (statusKey === "expired" ? "已过期" : (statusKey === "current" ? "进行中" : "未开始"));
                return `
                  <label class="director-node-state-item is-${statusKey}">
                    <input class="director-node-trigger" type="checkbox" data-group-id="${escapeHtml(group.id)}" data-node-id="${escapeHtml(node.id)}" ${nodeState.triggered ? "checked" : ""} />
                    <span class="director-node-state-content">
                      <span class="director-node-state-heading">
                        <strong>${escapeHtml(node.title || "未命名节点")}</strong>
                        <span class="director-chip director-node-status-chip director-node-status-chip-${statusKey}">${statusLabel}</span>
                      </span>
                      <span>${escapeHtml(node.content)}</span>
                    </span>
                  </label>`;
              }).join("")}
            </div>
          </div>
        </div>`;
    }).join("");

    $("#director_plot_list").html(html);
  }

  $("#director_last_matches").html(state.lastMatchedNodeIds.length
    ? state.lastMatchedNodeIds.map((item) => `<span class="director-chip">${escapeHtml(item)}</span>`).join("")
    : '<span class="director-empty-inline">暂无最近命中的节点</span>');
  if (antiSpoiler) {
    $("#director_injection_preview").val("（防剧透已开启，注入内容已隐藏）");
    $("#director_injection_preview").prop("disabled", true);
  } else {
    $("#director_injection_preview").val(state.lastInjectionPreview || "");
    $("#director_injection_preview").prop("disabled", false);
  }

  // ── 归档面板 ──
  const archivedIds = new Set(state.archivedGroupIds);
  const archivedPlots = state.nodeGroupLibrary.filter((g) => archivedIds.has(g.id));

  const $archiveDrawer = $(".director-archive-drawer");
  const $archiveList = $("#director_archive_list");
  const $archiveCount = $("#director_archive_count");

  if (archivedPlots.length === 0) {
    $archiveDrawer.hide();
  } else {
    $archiveDrawer.show();
    $archiveCount.text(String(archivedPlots.length));
    const archiveHtml = archivedPlots.map((group) => {
      const activationState = state.activationStateByGroup[group.id] || { nodeStateById: {} };
      const resolvedCount = group.nodes.filter((node) => isNodeResolved(normalizeNodeState(activationState.nodeStateById[node.id]))).length;
      return `
        <div class="director-plot-card is-archived" data-group-id="${escapeHtml(group.id)}">
          <div class="director-plot-header">
            <strong class="director-plot-title">${escapeHtml(group.title)}</strong>
            <span class="director-chip">${resolvedCount}/${group.nodes.length} 已处理</span>
          </div>
          <div class="director-plot-body" style="display:none;">
            <div class="director-active-summary">${escapeHtml(group.summary || "")}</div>
            <div class="director-node-state-list">
              ${group.nodes.map((node) => {
                const nodeState = normalizeNodeState(activationState.nodeStateById[node.id]);
                const statusKey = nodeState.triggered ? "completed" : "expired";
                const statusLabel = statusKey === "completed" ? "已完成" : "已过期";
                return `
                  <div class="director-node-state-item is-${statusKey}" style="cursor:default;">
                    <span class="director-node-state-content">
                      <span class="director-node-state-heading">
                        <strong>${escapeHtml(node.title || "未命名节点")}</strong>
                        <span class="director-chip director-node-status-chip director-node-status-chip-${statusKey}">${statusLabel}</span>
                      </span>
                      <span>${escapeHtml(node.content)}</span>
                    </span>
                  </div>`;
              }).join("")}
            </div>
          </div>
        </div>`;
    }).join("");
    $archiveList.html(archiveHtml);
  }
}

function renderSettings() {
  const settings = getSettings();
  $("#director_enabled").prop("checked", settings.enabled);
  $("#director_anti_spoiler").prop("checked", settings.antiSpoiler);
  $("#director_auto_generate_plot").prop("checked", settings.autoGeneratePlot);
  $("#director_generation_connection_name").val(settings.generationApi.name || "");
  $("#director_generation_api_url").val(settings.generationApi.url || "");
  $("#director_generation_api_key").val(settings.generationApi.apiKey || "");
  $("#director_analysis_connection_name").val(settings.analysisApi.name || "");
  $("#director_analysis_api_url").val(settings.analysisApi.url || "");
  $("#director_analysis_api_key").val(settings.analysisApi.apiKey || "");
  $("#director_analysis_history_depth").val(settings.analysisHistoryDepth);
  $("#director_node_generation_count").val(settings.nodeGenerationCount);
  $("#director_generation_prompt").val(settings.promptTemplates.nodeGenerationSystem);
  $("#director_analysis_prompt").val(settings.promptTemplates.nodeAnalysisSystem);
  $("#director_injection_prompt").val(settings.promptTemplates.injectionTemplate);
  renderModelSelectFor("generation");
  renderModelSelectFor("analysis");
  renderChatPanel();
}

function invalidateCurrentChatAnalysisCache() {
  const state = getChatState();
  state.lastAnalysisSignature = "";
  state.lastMatchedNodeIds = [];
  state.lastInjectionPreview = normalizeUserPlaceholder(buildInjectionContent());
}

function syncSettingsFromInputs() {
  const settings = getSettings();
  settings.enabled = Boolean($("#director_enabled").prop("checked"));
  settings.antiSpoiler = Boolean($("#director_anti_spoiler").prop("checked"));
  settings.autoGeneratePlot = Boolean($("#director_auto_generate_plot").prop("checked"));
  settings.generationApi.name = String($("#director_generation_connection_name").val() || "").trim();
  settings.generationApi.url = trimTrailingSlash($("#director_generation_api_url").val());
  settings.generationApi.apiKey = String($("#director_generation_api_key").val() || "").trim();
  settings.generationApi.model = String($("#director_generation_model_name").val() || "").trim();
  settings.analysisApi.name = String($("#director_analysis_connection_name").val() || "").trim();
  settings.analysisApi.url = trimTrailingSlash($("#director_analysis_api_url").val());
  settings.analysisApi.apiKey = String($("#director_analysis_api_key").val() || "").trim();
  settings.analysisApi.model = String($("#director_analysis_model_name").val() || "").trim();
  settings.analysisHistoryDepth = clampNumber($("#director_analysis_history_depth").val(), 1, 50, 10);
  settings.nodeGenerationCount = clampNumber($("#director_node_generation_count").val(), 1, 50, 4);
  settings.promptTemplates.nodeGenerationSystem = String($("#director_generation_prompt").val() || "").trim();
  settings.promptTemplates.nodeAnalysisSystem = String($("#director_analysis_prompt").val() || "").trim();
  settings.promptTemplates.injectionTemplate = String($("#director_injection_prompt").val() || "").trim();
}

function saveAllSettings() {
  syncSettingsFromInputs();
  saveSettingsDebounced();
}

async function handleFetchModelsFor(apiType) {
  const statusId = apiType === "analysis" ? "#director_analysis_connection_status" : "#director_generation_connection_status";
  try {
    saveAllSettings();
    setStatus(statusId, "正在拉取模型列表...", "info");
    const models = await fetchModelsList(apiType);
    renderModelSelectFor(apiType);
    setStatus(statusId, `已获取 ${models.length} 个模型`, "success");
    toastr.success(`已获取 ${models.length} 个模型`, "St导演");
  } catch (error) {
    console.error("Director fetch models failed", error);
    setStatus(statusId, error.message, "error");
    toastr.error(error.message, "St导演");
  }
}

async function handleAddPlot(description) {
  const settings = getSettings();
  const state = getChatState();

  const groupId = createId("group");
  const placeholderGroup = {
    id: groupId,
    title: description.length > 24 ? description.slice(0, 24) + "…" : description,
    summary: description,
    originalDescription: description,
    generating: true,
    nodes: [],
    createdAt: Date.now(),
  };

  state.nodeGroupLibrary.push(placeholderGroup);
  ensureGroupActivated(groupId);
  await saveChatState();
  renderChatPanel();

  try {
    const rawResult = await callDirectorApi({
      temperature: 0.6,
      apiType: "generation",
      messages: [
        { role: "system", content: settings.promptTemplates.nodeGenerationSystem },
        { role: "user", content: `用户情节构想：${normalizeUserPlaceholder(description)}\n\n请充分理解上述情节构想，发挥创作想象，润色语言并丰富情节细节（补充氛围、角色动机、转折铺垫等），然后生成有序的节点序列。请严格生成 ${settings.nodeGenerationCount} 个节点，不要多也不要少。严格输出 JSON，不要输出任何解释。` },
      ],
    });

    const parsed = extractJsonObject(rawResult);
    // 兼容 {title,summary,nodes:[]} 和 {groups:[{title,summary,nodes:[]}]} 两种格式
    const parsedData = Array.isArray(parsed.groups) && parsed.groups.length > 0
      ? parsed.groups[0]
      : parsed;
    const nodes = Array.isArray(parsedData.nodes) ? parsedData.nodes : [];
    if (nodes.length === 0) throw new Error("模型没有返回任何节点");

    const group = getLibraryGroupById(groupId);
    if (group) {
      group.title = normalizeUserPlaceholder(String(parsedData.title || description).trim());
      group.summary = normalizeUserPlaceholder(String(parsedData.summary || description).trim());
      group.nodes = nodes.map((node, i) => ({
        id: createId("node"),
        title: normalizeUserPlaceholder(String(node.title || `节点 ${i + 1}`).trim()),
        content: normalizeUserPlaceholder(String(node.content || node.title || "").trim()),
      }));
      group.generating = false;
    }

    syncChatStateWithLibrary();
    invalidateCurrentChatAnalysisCache();
    await saveChatState();
    toastr.success(`情节已生成：${group?.title || ""}`, "St导演");
  } catch (error) {
    console.error("Director plot generation failed", error);
    const group = getLibraryGroupById(groupId);
    if (group) {
      group.generating = false;
      group.generateError = error.message;
    }
    await saveChatState();
    toastr.error(`情节生成失败：${error.message}`, "St导演");
  }

  renderChatPanel();
}

// 纯本地函数：根据当前节点状态构建注入文本，不调用 API
function buildInjectionContent() {
  const settings = getSettings();
  const activeGroups = getActiveGroups().filter((group) => group.nodes.some((node) => !isNodeResolved(node)));
  if (activeGroups.length === 0) return "";

  const currentNodes = activeGroups
    .map((group) => {
      const first = getFirstPendingNode(group.nodes);
      return first
        ? { groupTitle: group.title, nodeTitle: first.title, nodeContent: first.content }
        : null;
    })
    .filter(Boolean);

  if (currentNodes.length === 0) return "";

  const triggeredSummary = buildTriggeredSummary(activeGroups);
  const expiredSummary = buildExpiredSummary(activeGroups);
  return [
    settings.promptTemplates.injectionTemplate,
    "",
    "当前推进中的节点：",
    ...currentNodes.map((node, i) =>
      `${i + 1}. [${node.groupTitle}] ${node.nodeTitle}\n   目标：${node.nodeContent}`
    ),
    "",
    triggeredSummary ? `已完成节点摘要：\n${triggeredSummary}` : "",
    expiredSummary ? `已过期节点摘要：\n${expiredSummary}` : "",
  ].filter(Boolean).join("\n");
}

// 调用 API 分析：AI 最新回复中是否触发了当前节点
async function analyzeNodeCompletion() {
  const settings = getSettings();
  const context = getContext();
  const activeGroups = getActiveGroups().filter((group) => group.nodes.some((node) => !isNodeResolved(node)));
  if (activeGroups.length === 0) return;

  const chat = Array.isArray(context.chat) ? context.chat : [];
  const historyDepth = settings.analysisHistoryDepth || 10;
  const recentMessages = chat.slice(-historyDepth);
  if (recentMessages.length === 0) return;
  const chatContext = serializeConversation(recentMessages);

  const currentNodes = activeGroups.flatMap((group) => group.nodes
    .map((node, index) => (!isNodeResolved(node)
      ? {
        groupId: group.id,
        nodeId: node.id,
        groupTitle: group.title,
        nodeTitle: node.title,
        nodeContent: node.content,
        nodeOrder: index + 1,
      }
      : null))
    .filter(Boolean));

  if (currentNodes.length === 0) return;

  const state = getChatState();
  const signature = `${currentNodes.map((n) => `${n.groupId}:${n.nodeId}`).join(",")}|${hashString(chatContext)}`;
  if (state.lastAnalysisSignature === signature) return;

  const nodeList = currentNodes
    .map((n) => `- groupId: "${n.groupId}", nodeId: "${n.nodeId}", 顺序: ${n.nodeOrder}, 所属情节: "${n.groupTitle}", 节点: "${n.nodeTitle}", 目标事件: "${n.nodeContent}"`)
    .join("\n");

  const groupNodeOrderMap = Object.fromEntries(activeGroups.map((group) => [
    group.id,
    Object.fromEntries(group.nodes.map((node, index) => [node.id, index])),
  ]));

  try {
    const rawResult = await callDirectorApi({
      temperature: 0.1,
      apiType: "analysis",
      messages: [
        { role: "system", content: settings.promptTemplates.nodeAnalysisSystem },
        {
          role: "user",
          content: [
            "以下为当前尚未处理的节点（按原定剧情顺序排列）：",
            nodeList,
            "",
            `最近 ${recentMessages.length} 条聊天记录：`,
            chatContext,
            "",
            "请综合上述聊天记录，一步步推理：",
            "1. 当前故事场景已经到了哪里？",
            "2. 哪些节点的目标事件已经在聊天中明确发生或完成？→ 放进 triggered",
            "3. 是否存在已过期的节点——故事已推进到它之后，它已不可能再按原顺序发生？→ 放进 expired",
            "4. 如果一个节点触发，那么它之前所有既未触发也未过期的节点都应视为过期。",
            "",
            "只返回 JSON，不要输出任何解释：",
            "{\"triggered\":[{\"groupId\":string,\"nodeId\":string}],\"expired\":[{\"groupId\":string,\"nodeId\":string}]}",
          ].join("\n"),
        },
      ],
    });

    const parsed = extractJsonObject(rawResult);
    const triggered = Array.isArray(parsed.triggered) ? parsed.triggered : [];
    const expired = Array.isArray(parsed.expired) ? parsed.expired : [];
    let anyResolved = false;
    const stateObj = getChatState();
    const highestTriggeredIndexByGroup = {};

    for (const item of triggered) {
      const groupState = stateObj.activationStateByGroup[item.groupId];
      if (groupState?.nodeStateById?.[item.nodeId]) {
        const nodeState = normalizeNodeState(groupState.nodeStateById[item.nodeId]);
        nodeState.triggered = true;
        nodeState.expired = false;
        groupState.nodeStateById[item.nodeId] = nodeState;
        anyResolved = true;
        const nodeIndex = groupNodeOrderMap[item.groupId]?.[item.nodeId];
        if (Number.isInteger(nodeIndex)) {
          highestTriggeredIndexByGroup[item.groupId] = Math.max(highestTriggeredIndexByGroup[item.groupId] ?? -1, nodeIndex);
        }
      }
    }

    for (const item of expired) {
      const groupState = stateObj.activationStateByGroup[item.groupId];
      if (groupState?.nodeStateById?.[item.nodeId]) {
        const nodeState = normalizeNodeState(groupState.nodeStateById[item.nodeId]);
        if (!nodeState.triggered) {
          nodeState.expired = true;
          groupState.nodeStateById[item.nodeId] = nodeState;
          anyResolved = true;
        }
      }
    }

    for (const [groupId, highestTriggeredIndex] of Object.entries(highestTriggeredIndexByGroup)) {
      const group = activeGroups.find((item) => item.id === groupId);
      const groupState = stateObj.activationStateByGroup[groupId];
      if (!group || !groupState) {
        continue;
      }

      for (let index = 0; index < highestTriggeredIndex; index += 1) {
        const node = group.nodes[index];
        const nodeState = normalizeNodeState(groupState.nodeStateById[node.id]);
        if (!isNodeResolved(nodeState)) {
          nodeState.expired = true;
          groupState.nodeStateById[node.id] = nodeState;
          anyResolved = true;
        }
      }
    }

    stateObj.lastAnalysisSignature = signature;
    if (anyResolved) await checkAndAutoGeneratePlot();
    await saveChatState();
  } catch (error) {
    console.warn("Director node completion analysis failed:", error.message);
    state.lastAnalysisSignature = signature;
    await saveChatState();
  }
}

async function buildInjectionPreview(forceRefresh = false) {
  const state = getChatState();
  const activeGroups = getActiveGroups().filter((group) => group.nodes.some((node) => !isNodeResolved(node)));

  if (activeGroups.length === 0) {
    if (state.lastInjectionPreview || state.lastMatchedNodeIds.length) {
      state.lastMatchedNodeIds = [];
      state.lastInjectionPreview = "";
      state.lastAnalysisSignature = "";
      await saveChatState();
    }
    return "";
  }

  const signature = activeGroups
    .map((group) => { const f = getFirstPendingNode(group.nodes); return f ? `${group.id}:${f.id}` : null; })
    .filter(Boolean)
    .join("|");

  if (!forceRefresh && state.lastAnalysisSignature === signature && state.lastInjectionPreview) {
    return state.lastInjectionPreview;
  }

  const preview = normalizeUserPlaceholder(buildInjectionContent());
  state.lastMatchedNodeIds = activeGroups
    .map((group) => { const f = getFirstPendingNode(group.nodes); return f ? `${group.title} / ${f.title}` : null; })
    .filter(Boolean);
  state.lastInjectionPreview = preview;
  state.lastAnalysisSignature = signature;
  state.lastAnalysisAt = Date.now();
  await saveChatState();
  return preview;
}

async function handleManualAnalysis() {
  try {
    setStatus("#director_analysis_status", "正在分析节点触发进度...", "info");
    await analyzeNodeCompletion();
    const preview = await buildInjectionPreview(true);
    renderChatPanel();
    if (preview) {
      setStatus("#director_analysis_status", "分析完成，注入预览已刷新", "success");
      toastr.success("分析完成，注入预览已刷新", "St导演");
    } else {
      setStatus("#director_analysis_status", "当前没有激活的情节节点", "warning");
      toastr.warning("当前没有激活的情节节点", "St导演");
    }
  } catch (error) {
    console.error("Director manual analysis failed", error);
    setStatus("#director_analysis_status", error.message, "error");
    toastr.error(error.message, "St导演");
  }
}

function updateExtensionPrompt(content) {
  const context = getContext();
  if (typeof context.setExtensionPrompt === "function") {
    // role 必须传数字 0 (SYSTEM)，传字符串 "system" 会被 Number() 转为 NaN 导致注入被丢弃
    context.setExtensionPrompt(extensionName, content, injectionPosition, injectionDepth, false, 0);
  }
}

async function handleGroupActivation(groupId, shouldActivate) {
  if (shouldActivate) {
    ensureGroupActivated(groupId);
  } else {
    removeActivatedGroup(groupId);
  }
  await saveChatState();
  renderChatPanel();
}

async function handleTriggerToggle(groupId, nodeId, checked) {
  ensureGroupActivated(groupId);
  const state = getChatState();
  const groupState = state.activationStateByGroup[groupId] || { nodeStateById: {} };
  const nodeState = normalizeNodeState(groupState.nodeStateById[nodeId]);
  nodeState.triggered = checked;
  nodeState.expired = false;
  groupState.nodeStateById[nodeId] = nodeState;
  state.activationStateByGroup[groupId] = groupState;
  state.lastAnalysisSignature = "";
  await checkAndAutoGeneratePlot();
  await buildInjectionPreview(true);
  renderChatPanel();
}

async function updateLibraryGroupField(groupId, field, value) {
  const group = getLibraryGroupById(groupId);
  if (!group) {
    return;
  }
  group[field] = normalizeUserPlaceholder(String(value || "").trim());
  invalidateCurrentChatAnalysisCache();
  await saveChatState();
  renderChatPanel();
}

async function updateLibraryNodeField(groupId, nodeId, field, value) {
  const group = getLibraryGroupById(groupId);
  const node = group?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return;
  }
  node[field] = normalizeUserPlaceholder(String(value || "").trim());
  invalidateCurrentChatAnalysisCache();
  await saveChatState();
  renderChatPanel();
}

async function addNodeToGroup(groupId) {
  const group = getLibraryGroupById(groupId);
  if (!group) {
    return;
  }

  group.nodes.push({
    id: createId("node"),
    title: "新节点",
    content: "用一句话描述这个新事件节点，主角统一写成 <user>。",
  });

  invalidateCurrentChatAnalysisCache();
  syncChatStateWithLibrary();
  await saveChatState();
  renderChatPanel();
}

async function deleteNodeFromGroup(groupId, nodeId) {
  const group = getLibraryGroupById(groupId);
  if (!group) {
    return;
  }

  if (group.nodes.length <= 1) {
    toastr.warning("每组至少保留一个节点", "St导演");
    return;
  }

  group.nodes = group.nodes.filter((node) => node.id !== nodeId);
  invalidateCurrentChatAnalysisCache();
  syncChatStateWithLibrary();
  await saveChatState();
  renderChatPanel();
}

async function deleteGroup(groupId) {
  const state = getChatState();
  state.nodeGroupLibrary = state.nodeGroupLibrary.filter((group) => group.id !== groupId);
  removeActivatedGroup(groupId);
  invalidateCurrentChatAnalysisCache();
  await saveChatState();
  renderChatPanel();
}

function bindStaticEvents() {
  initializeFloatingLauncher();

  $(document)
    .off("click", ".director-drawer-toggle")
    .on("click", ".director-drawer-toggle", function toggleDrawer() {
      const drawer = $(this).closest(".director-drawer");
      drawer.toggleClass("is-open");
      $(this).find(".inline-drawer-icon").toggleClass("down", drawer.hasClass("is-open"));
    });

  $(document)
    .off("click.directorOpen", "#director_floating_button")
    .on("click.directorOpen", "#director_floating_button", () => {
      if (floatingLauncherState.suppressClick) {
        floatingLauncherState.suppressClick = false;
        return;
      }
      openDirectorModal();
    });

  $(document)
    .off("click.directorClose", "#director_modal_close, #director_modal_close_bottom, [data-director-close='true']")
    .on("click.directorClose", "#director_modal_close, #director_modal_close_bottom, [data-director-close='true']", () => {
      closeDirectorModal();
    });

  $(document)
    .off("keydown.directorModal")
    .on("keydown.directorModal", (event) => {
      if (event.key === "Escape" && $("#director_modal").hasClass("is-open")) {
        closeDirectorModal();
      }
    });

  $(document)
    .off("pointerdown.directorDrag", "#director_floating_button")
    .on("pointerdown.directorDrag", "#director_floating_button", function onPointerDown(event) {
      const button = $(this);
      const element = button.get(0);
      if (!element) {
        return;
      }

      ensureFloatingButtonPosition();
      floatingLauncherState.pointerId = event.originalEvent.pointerId;
      floatingLauncherState.startX = event.clientX;
      floatingLauncherState.startY = event.clientY;
      floatingLauncherState.originLeft = floatingLauncherState.left ?? (parseFloat(button.css("left")) || 0);
      floatingLauncherState.originTop = floatingLauncherState.top ?? (parseFloat(button.css("top")) || 0);
      floatingLauncherState.dragging = false;
      floatingLauncherState.suppressClick = false;

      if (typeof element.setPointerCapture === "function") {
        element.setPointerCapture(floatingLauncherState.pointerId);
      }
    });

  $(document)
    .off("pointermove.directorDrag")
    .on("pointermove.directorDrag", (event) => {
      if (floatingLauncherState.pointerId === null || event.originalEvent.pointerId !== floatingLauncherState.pointerId) {
        return;
      }

      const deltaX = event.clientX - floatingLauncherState.startX;
      const deltaY = event.clientY - floatingLauncherState.startY;
      if (!floatingLauncherState.dragging && Math.hypot(deltaX, deltaY) < 6) {
        return;
      }

      floatingLauncherState.dragging = true;
      getFloatingButtonElement().addClass("is-dragging");
      setFloatingButtonPosition(
        floatingLauncherState.originLeft + deltaX,
        floatingLauncherState.originTop + deltaY,
      );
    });

  $(document)
    .off("pointerup.directorDrag pointercancel.directorDrag")
    .on("pointerup.directorDrag pointercancel.directorDrag", "#director_floating_button", function onPointerUp(event) {
      if (floatingLauncherState.pointerId === null || event.originalEvent.pointerId !== floatingLauncherState.pointerId) {
        return;
      }

      const element = $(this).get(0);
      if (element && typeof element.releasePointerCapture === "function") {
        element.releasePointerCapture(floatingLauncherState.pointerId);
      }

      floatingLauncherState.suppressClick = floatingLauncherState.dragging;
      if (floatingLauncherState.suppressClick) {
        persistFloatingButtonPosition();
      }
      floatingLauncherState.pointerId = null;
      floatingLauncherState.dragging = false;
      getFloatingButtonElement().removeClass("is-dragging");
    });

  $("#director_enabled, #director_generation_connection_name, #director_generation_api_url, #director_generation_api_key, #director_analysis_connection_name, #director_analysis_api_url, #director_analysis_api_key, #director_generation_prompt, #director_analysis_prompt, #director_injection_prompt")
    .off("input")
    .on("input", () => {
      saveAllSettings();
      renderChatPanel();
    });

  $("#director_anti_spoiler, #director_auto_generate_plot")
    .off("change")
    .on("change", () => {
      saveAllSettings();
      renderChatPanel();
    });

  $("#director_analysis_history_depth")
    .off("input")
    .on("input", () => { saveAllSettings(); });

  $("#director_generation_model_name")
    .off("input")
    .on("input", () => { saveAllSettings(); renderModelSelectFor("generation"); });

  $("#director_analysis_model_name")
    .off("input")
    .on("input", () => { saveAllSettings(); renderModelSelectFor("analysis"); });

  $("#director_generation_model_select")
    .off("change")
    .on("change", function () {
      $("#director_generation_model_name").val($(this).val());
      saveAllSettings();
    });

  $("#director_analysis_model_select")
    .off("change")
    .on("change", function () {
      $("#director_analysis_model_name").val($(this).val());
      saveAllSettings();
    });

  $("#director_save_generation_connection")
    .off("click")
    .on("click", () => {
      saveAllSettings();
      setStatus("#director_generation_connection_status", "生成连接配置已保存", "success");
      toastr.success("生成连接配置已保存", "St导演");
    });

  $("#director_fetch_generation_models")
    .off("click")
    .on("click", () => handleFetchModelsFor("generation"));

  $("#director_clone_generation_to_analysis")
    .off("click")
    .on("click", () => {
      const s = getSettings();
      Object.assign(s.analysisApi, { url: s.generationApi.url, apiKey: s.generationApi.apiKey, model: s.generationApi.model });
      saveSettingsDebounced();
      renderSettings();
      toastr.success("已将生成连接克隆到分析连接", "St导演");
    });

  $("#director_save_analysis_connection")
    .off("click")
    .on("click", () => {
      saveAllSettings();
      setStatus("#director_analysis_connection_status", "分析连接配置已保存", "success");
      toastr.success("分析连接配置已保存", "St导演");
    });

  $("#director_fetch_analysis_models")
    .off("click")
    .on("click", () => handleFetchModelsFor("analysis"));

  $("#director_clone_analysis_to_generation")
    .off("click")
    .on("click", () => {
      const s = getSettings();
      Object.assign(s.generationApi, { url: s.analysisApi.url, apiKey: s.analysisApi.apiKey, model: s.analysisApi.model });
      saveSettingsDebounced();
      renderSettings();
      toastr.success("已将分析连接克隆到生成连接", "St导演");
    });

  $("#director_add_plot")
    .off("click")
    .on("click", () => {
      const form = $("#director_add_plot_form");
      form.toggle();
      if (form.is(":visible")) $("#director_plot_description").val("").focus();
    });

  $("#director_confirm_add_plot")
    .off("click")
    .on("click", async () => {
      const description = String($("#director_plot_description").val() || "").trim();
      if (!description) { toastr.warning("请先输入情节描述", "St导演"); return; }
      $("#director_add_plot_form").hide();
      $("#director_plot_description").val("");
      await handleAddPlot(description);
    });

  $(document)
    .off("click", ".director-plot-header")
    .on("click", ".director-plot-header", function onPlotHeaderClick(event) {
      if ($(event.target).closest(".director-remove-plot").length) return;
      const card = $(this).closest(".director-plot-card");
      if (card.hasClass("is-generating") || card.hasClass("is-error")) return;
      card.toggleClass("is-open");
      card.find(".director-plot-body").toggle(card.hasClass("is-open"));
    });

  $(document)
    .off("click", ".director-retry-plot")
    .on("click", ".director-retry-plot", async function onRetryPlot(event) {
      event.stopPropagation();
      const groupId = $(this).data("group-id");
      const group = getLibraryGroupById(groupId);
      if (!group) return;
      const description = group.originalDescription || group.summary;
      const state = getChatState();
      state.nodeGroupLibrary = state.nodeGroupLibrary.filter((g) => g.id !== groupId);
      removeActivatedGroup(groupId);
      await saveChatState();
      await handleAddPlot(description);
    });

  $(document)
    .off("click", ".director-remove-plot")
    .on("click", ".director-remove-plot", async function onRemovePlot() {
      await deleteGroup($(this).data("group-id"));
    });

  $("#director_run_analysis")
    .off("click")
    .on("click", handleManualAnalysis);

  $(document)
    .off("change", ".director-node-trigger")
    .on("change", ".director-node-trigger", async function onTriggerChange() {
      await handleTriggerToggle($(this).data("group-id"), $(this).data("node-id"), $(this).prop("checked"));
    });

  $(document)
    .off("input", ".director-group-title")
    .on("input", ".director-group-title", function onGroupTitleInput() {
      updateLibraryGroupField($(this).closest(".director-card").data("group-id"), "title", $(this).val());
    });

  $(document)
    .off("input", ".director-group-summary")
    .on("input", ".director-group-summary", function onGroupSummaryInput() {
      updateLibraryGroupField($(this).closest(".director-card").data("group-id"), "summary", $(this).val());
    });

  $(document)
    .off("input", ".director-node-title")
    .on("input", ".director-node-title", function onNodeTitleInput() {
      const groupId = $(this).closest(".director-card").data("group-id");
      const nodeId = $(this).closest(".director-node-row").data("node-id");
      updateLibraryNodeField(groupId, nodeId, "title", $(this).val());
    });

  $(document)
    .off("input", ".director-node-content")
    .on("input", ".director-node-content", function onNodeContentInput() {
      const groupId = $(this).closest(".director-card").data("group-id");
      const nodeId = $(this).closest(".director-node-row").data("node-id");
      updateLibraryNodeField(groupId, nodeId, "content", $(this).val());
    });

  $(document)
    .off("click", ".director-add-node")
    .on("click", ".director-add-node", async function onAddNode() {
      await addNodeToGroup($(this).data("group-id"));
    });

  $(document)
    .off("click", ".director-delete-node")
    .on("click", ".director-delete-node", async function onDeleteNode() {
      await deleteNodeFromGroup($(this).data("group-id"), $(this).data("node-id"));
    });

  $(document)
    .off("click", ".director-delete-group")
    .on("click", ".director-delete-group", async function onDeleteGroup() {
      await deleteGroup($(this).data("group-id"));
    });
}

async function checkAndAutoGeneratePlot() {
  const settings = getSettings();
  if (!settings.autoGeneratePlot) return;
  const state = getChatState();
  for (const group of state.nodeGroupLibrary) {
    if (group.generating || group.generateError || group.autoNextTriggered) continue;
    if (!group.nodes || group.nodes.length < 2) continue;
    const activationState = state.activationStateByGroup[group.id] || { nodeStateById: {} };
    const resolvedCount = group.nodes.filter((node) => isNodeResolved(normalizeNodeState(activationState.nodeStateById[node.id]))).length;
    if (group.nodes.length - resolvedCount === 1) {
      group.autoNextTriggered = true;
      await saveChatState();
      toastr.info(`检测到“${group.title}”即将结束，正在自动生成下一情节…`, "St导演");
      handleAutoGeneratePlot(group); // fire-and-forget
      break;
    }
  }
}

async function handleAutoGeneratePlot(group) {
  const context = getContext();
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const recentMessages = chat.slice(-8);
  const chatContext = recentMessages.length > 0 ? serializeConversation(recentMessages) : "（暂无聊天记录）";
  const description = [
    `【自动续写】当前情节“${group.title}”已接近尾声（仅剩最后一个节点未处理）。`,
    "请根据以下最近对话内容，规划下一段自然衬接的故事情节，使叙事流畅延续。",
    "",
    `最近对话：\n${chatContext}`,
  ].join("\n");
  return handleAddPlot(description);
}

async function handleAfterCharacterMessage() {
  const settings = getSettings();
  if (!settings.enabled) return;
  try {
    await analyzeNodeCompletion();
    await buildInjectionPreview(true);
    await checkAndAutoGeneratePlot();
    renderChatPanel();
  } catch (error) {
    console.error("Director after-message handler failed", error);
  }
}

function bindContextEvents() {
  const context = getContext();
  if (!context?.eventSource || !context?.event_types) {
    return;
  }

  context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
    syncChatStateWithLibrary();
    renderChatPanel();
  });

  context.eventSource.on(context.event_types.CHARACTER_MESSAGE_RENDERED, () => {
    handleAfterCharacterMessage();
  });

  // 用户发送消息后也触发分析，使节点状态更快跟上叙事
  const userEvent = context.event_types.USER_MESSAGE_RENDERED
    || context.event_types.MESSAGE_SENT
    || context.event_types.MESSAGE_RECEIVED;
  if (userEvent) {
    context.eventSource.on(userEvent, () => {
      handleAfterCharacterMessage();
    });
  }
}

globalThis.stDirectorGenerateInterceptor = async function stDirectorGenerateInterceptor() {
  const settings = getSettings();
  if (!settings.enabled) {
    updateExtensionPrompt("");
    return;
  }
  // 总是实时构建注入内容，不依赖缓存
  const content = normalizeUserPlaceholder(buildInjectionContent());
  updateExtensionPrompt(content);
};

jQuery(async () => {
  $(".director-shell").remove();
  const settingsHtml = await $.get(`${extensionFolderPath}/director-settings.html`);
  $("body").append(settingsHtml);

  getSettings();
  syncChatStateWithLibrary();
  bindStaticEvents();
  bindContextEvents();
  renderSettings();
});