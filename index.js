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
  apiConfig: {
    name: "Director API",
    url: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
  },
  modelList: [],
  promptTemplates: {
    nodeGenerationSystem: [
      "你是一个故事导演策划器。",
      "你的任务是根据用户提供的情节描述，生成该情节的有序节点序列。",
      "输出必须是合法 JSON，不要输出 Markdown 代码块，不要输出解释。",
      "如果提到主角、玩家、用户或第一人称主视角角色，统一写成 <user>，不要写真实名字。",
      "节点按推荐推进顺序排列，代表该情节内将依次发生的事件。",
      "节点描述要短、可执行、可触发，且能显著推动故事。",
      "不要生成空节点、重复节点或仅描述情绪而不推动剧情的节点。",
      "输出格式：{\"title\":string,\"summary\":string,\"nodes\":[{\"title\":string,\"content\":string}]}"
    ].join("\n"),
    nodeAnalysisSystem: [
      "你是故事导演分析器，负责主动规划如何把未触发的故事节点引导进当前叙事。",
      "你会收到当前聊天历史、已激活的故事节点组和每个节点的触发状态。",
      "你的任务是选出应当引导故事走向的未触发节点，并判断每个节点的融入时机。",
      "如果故事中提到主角、玩家、用户或第一人称主视角角色，统一写成 <user>，不要写真实名字。",
      "",
      "timing 字段规则：",
      "- immediate：当前情节已有衔接点，可以立刻开始将叙事引向该节点。",
      "- deferred：当前情节处于高潮或关键段落尚未收尾，应等当前段落自然结束后再引导。",
      "",
      "输出必须是合法 JSON，不要输出 Markdown 代码块，不要输出解释。",
      "输出格式：{\"matches\":[{\"groupId\":string,\"nodeId\":string,\"reason\":string,\"priority\":number,\"timing\":\"immediate\"|\"deferred\"}],\"summary\":string}"
    ].join("\n"),
    injectionTemplate: [
      "你现在收到来自故事导演模块的剧情引导指令。",
      "你的职责是主动驱动故事朝以下目标节点发展，而不是被动等待情节自然碰到那里。",
      "",
      "执行规则：",
      "1. 平滑融入：将目标节点自然编织进当前叙事，通过人物行为、环境变化、对话或事件制造通往节点的契机，不要突兀转折，不要逐字复述节点文字。",
      "2. 时机判断：标注了【立即引导】的节点，应在本次回复中开始将故事引向该节点；标注了【情节收尾后引导】的节点，应在当前段落自然结束后，下一个叙事节点再启动引导。",
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
  settings.apiConfig = { ...defaults.apiConfig, ...(settings.apiConfig || {}) };
  settings.modelList = Array.isArray(settings.modelList) ? settings.modelList : [];
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

function getModelValue() {
  const explicitValue = $("#director_model_name").val();
  return String(explicitValue || "").trim();
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

function getLibraryGroupById(groupId) {
  return getChatState().nodeGroupLibrary.find((group) => group.id === groupId) || null;
}

function syncChatStateWithLibrary() {
  const state = getChatState();
  const validGroupIds = new Set(state.nodeGroupLibrary.map((group) => group.id));

  state.activeGroupIds = state.activeGroupIds.filter((groupId) => validGroupIds.has(groupId));

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
        activationState.nodeStateById[node.id] = { triggered: false, note: "" };
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
      state.activationStateByGroup[groupId].nodeStateById[node.id] = { triggered: false, note: "" };
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
        const nodeState = activationState.nodeStateById[node.id] || { triggered: false, note: "" };
        return {
          ...node,
          triggered: Boolean(nodeState.triggered),
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

function buildAnalysisSignature(groups, chat) {
  const nodeState = groups.map((group) => ({
    id: group.id,
    nodes: group.nodes.map((node) => ({ id: node.id, triggered: node.triggered })),
  }));
  const recentMessages = chat.slice(-8).map((message) => `${message.is_user ? "u" : "a"}:${message.mes || message.message || ""}`).join("|");
  return JSON.stringify({
    activeGroupIds: groups.map((group) => group.id),
    nodeState,
    recentMessages,
    messageCount: chat.length,
  });
}

async function callDirectorApi({ messages, temperature = 0.4 }) {
  const settings = getSettings();
  const apiUrl = trimTrailingSlash(settings.apiConfig.url);
  const apiKey = String(settings.apiConfig.apiKey || "").trim();
  const model = String(settings.apiConfig.model || "").trim();

  if (!settings.enabled) {
    throw new Error("导演插件当前已禁用");
  }
  if (!apiUrl) {
    throw new Error("请先填写 API URL");
  }
  if (!apiKey) {
    throw new Error("请先填写 API Key");
  }
  if (!model) {
    throw new Error("请先选择或填写模型名称");
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

async function fetchModelsList() {
  const settings = getSettings();
  const apiUrl = trimTrailingSlash(settings.apiConfig.url);
  const apiKey = String(settings.apiConfig.apiKey || "").trim();

  if (!apiUrl) {
    throw new Error("请先填写 API URL");
  }
  if (!apiKey) {
    throw new Error("请先填写 API Key");
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
  settings.modelList = models.map((model) => ({
    id: model.id || model.name || model.model || String(model),
  }));
  saveSettingsDebounced();
  return settings.modelList;
}

function renderModelSelect() {
  const settings = getSettings();
  const selected = settings.apiConfig.model || "";
  const options = ['<option value="">选择已拉取模型</option>']
    .concat(settings.modelList.map((model) => {
      const id = escapeHtml(model.id);
      const isSelected = model.id === selected ? " selected" : "";
      return `<option value="${id}"${isSelected}>${id}</option>`;
    }));

  $("#director_model_select").html(options.join(""));
  $("#director_model_name").val(selected);
}

function renderChatPanel() {
  const context = getContext();
  const state = syncChatStateWithLibrary();
  const { antiSpoiler } = getSettings();
  const chatName = context?.name2 || context?.groupId || "当前会话";

  $("#director_chat_scope").text(`当前聊天：${chatName}`);

  const allPlots = state.nodeGroupLibrary;

  if (allPlots.length === 0) {
    $("#director_plot_list").html('<div class="director-empty">还没有情节，点击“新增情节”开始创建。</div>');
  } else {
    const html = allPlots.map((group) => {
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
              <button class="menu_button director-remove-plot" data-group-id="${escapeHtml(group.id)}" type="button">移除</button>
            </div>
          </div>`;
      }

      const activationState = state.activationStateByGroup[group.id] || { nodeStateById: {} };
      const triggeredCount = group.nodes.filter((node) => activationState.nodeStateById[node.id]?.triggered).length;

      if (antiSpoiler) {
        return `
          <div class="director-plot-card is-spoiler-protected" data-group-id="${escapeHtml(group.id)}">
            <div class="director-plot-header">
              <strong class="director-plot-title">${escapeHtml(group.title)}</strong>
              <span class="director-chip">${triggeredCount}/${group.nodes.length} 已触发</span>
              <button class="menu_button director-remove-plot" data-group-id="${escapeHtml(group.id)}" type="button">移除</button>
            </div>
          </div>`;
      }

      return `
        <div class="director-plot-card" data-group-id="${escapeHtml(group.id)}">
          <div class="director-plot-header">
            <span class="director-plot-chevron">▶</span>
            <strong class="director-plot-title">${escapeHtml(group.title)}</strong>
            <span class="director-chip">${triggeredCount}/${group.nodes.length} 已触发</span>
            <button class="menu_button director-remove-plot" data-group-id="${escapeHtml(group.id)}" type="button">移除</button>
          </div>
          <div class="director-plot-body">
            <div class="director-active-summary">${escapeHtml(group.summary || "")}</div>
            <div class="director-node-state-list">
              ${group.nodes.map((node) => {
                const nodeState = activationState.nodeStateById[node.id] || { triggered: false };
                return `
                  <label class="director-node-state-item">
                    <input class="director-node-trigger" type="checkbox" data-group-id="${escapeHtml(group.id)}" data-node-id="${escapeHtml(node.id)}" ${nodeState.triggered ? "checked" : ""} />
                    <span>
                      <strong>${escapeHtml(node.title || "未命名节点")}</strong>
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
}

function renderSettings() {
  const settings = getSettings();
  $("#director_enabled").prop("checked", settings.enabled);
  $("#director_anti_spoiler").prop("checked", settings.antiSpoiler);
  $("#director_auto_generate_plot").prop("checked", settings.autoGeneratePlot);
  $("#director_connection_name").val(settings.apiConfig.name || "");
  $("#director_api_url").val(settings.apiConfig.url || "");
  $("#director_api_key").val(settings.apiConfig.apiKey || "");
  $("#director_generation_prompt").val(settings.promptTemplates.nodeGenerationSystem);
  $("#director_analysis_prompt").val(settings.promptTemplates.nodeAnalysisSystem);
  $("#director_injection_prompt").val(settings.promptTemplates.injectionTemplate);
  renderModelSelect();
  renderChatPanel();
}

function invalidateCurrentChatAnalysisCache() {
  const state = getChatState();
  state.lastAnalysisSignature = "";
  state.lastMatchedNodeIds = [];
  state.lastInjectionPreview = "";
}

function syncSettingsFromInputs() {
  const settings = getSettings();
  settings.enabled = Boolean($("#director_enabled").prop("checked"));
  settings.antiSpoiler = Boolean($("#director_anti_spoiler").prop("checked"));
  settings.autoGeneratePlot = Boolean($("#director_auto_generate_plot").prop("checked"));
  settings.apiConfig.name = String($("#director_connection_name").val() || "").trim();
  settings.apiConfig.url = trimTrailingSlash($("#director_api_url").val());
  settings.apiConfig.apiKey = String($("#director_api_key").val() || "").trim();
  settings.apiConfig.model = getModelValue();
  settings.promptTemplates.nodeGenerationSystem = String($("#director_generation_prompt").val() || "").trim();
  settings.promptTemplates.nodeAnalysisSystem = String($("#director_analysis_prompt").val() || "").trim();
  settings.promptTemplates.injectionTemplate = String($("#director_injection_prompt").val() || "").trim();
}

function saveAllSettings() {
  syncSettingsFromInputs();
  saveSettingsDebounced();
}

async function handleFetchModels() {
  try {
    saveAllSettings();
    setStatus("#director_connection_status", "正在拉取模型列表...", "info");
    const models = await fetchModelsList();
    renderModelSelect();
    setStatus("#director_connection_status", `已获取 ${models.length} 个模型`, "success");
    toastr.success(`已获取 ${models.length} 个模型`, "St导演");
  } catch (error) {
    console.error("Director fetch models failed", error);
    setStatus("#director_connection_status", error.message, "error");
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
      messages: [
        { role: "system", content: settings.promptTemplates.nodeGenerationSystem },
        { role: "user", content: `情节描述：${normalizeUserPlaceholder(description)}\n请根据以上情节描述生成节点序列，严格输出 JSON。` },
      ],
    });

    const parsed = extractJsonObject(rawResult);
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    if (nodes.length === 0) throw new Error("模型没有返回任何节点");

    const group = getLibraryGroupById(groupId);
    if (group) {
      group.title = normalizeUserPlaceholder(String(parsed.title || description).trim());
      group.summary = normalizeUserPlaceholder(String(parsed.summary || description).trim());
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

function getAnalysisPayload() {
  const context = getContext();
  const activeGroups = getActiveGroups().filter(
    (group) => group.nodes.some((node) => !node.triggered)
  );
  const chat = Array.isArray(context.chat) ? context.chat : [];

  return {
    activeGroups,
    chat,
    signature: buildAnalysisSignature(activeGroups, chat),
  };
}

function buildFallbackInjection(activeGroups, settings) {
  const untriggeredNodes = [];
  for (const group of activeGroups) {
    for (const node of group.nodes) {
      if (!node.triggered) {
        untriggeredNodes.push({
          groupTitle: group.title,
          nodeTitle: node.title,
          nodeContent: node.content,
        });
      }
    }
  }

  if (untriggeredNodes.length === 0) {
    return "";
  }

  const triggeredSummary = buildTriggeredSummary(activeGroups);
  const nodeLines = untriggeredNodes.slice(0, 5).map((item, index) =>
    `${index + 1}. \u3010\u7acb\u5373\u5f15\u5bfc\u3011 [${item.groupTitle}] ${item.nodeTitle}\n   \u76ee\u6807\uff1a${item.nodeContent}\n   \u5f15\u5bfc\u7406\u7531\uff1a\u987a\u5e94\u5f53\u524d\u5267\u60c5\u63a8\u8fdb`
  );

  return [
    settings.promptTemplates.injectionTemplate,
    "",
    "\u5019\u9009\u63a8\u8fdb\u8282\u70b9\uff1a",
    ...nodeLines,
    "",
    triggeredSummary ? `\u5df2\u89e6\u53d1\u8282\u70b9\u6458\u8981\uff1a\n${triggeredSummary}` : "\u5df2\u89e6\u53d1\u8282\u70b9\u6458\u8981\uff1a\u6682\u65e0",
  ].filter(Boolean).join("\n");
}

async function buildInjectionPreview(forceRefresh = false) {
  const settings = getSettings();
  const state = getChatState();
  const { activeGroups, chat, signature } = getAnalysisPayload();

  if (activeGroups.length === 0) {
    state.lastMatchedNodeIds = [];
    state.lastInjectionPreview = "";
    state.lastAnalysisSignature = "";
    state.lastAnalysisAt = 0;
    await saveChatState();
    return "";
  }

  if (!forceRefresh && state.lastAnalysisSignature === signature && state.lastInjectionPreview) {
    return state.lastInjectionPreview;
  }

  const triggeredSummary = buildTriggeredSummary(activeGroups);
  const activeGroupText = activeGroups.map((group) => {
    const nodes = group.nodes.map((node) => {
      const status = node.triggered ? "已触发" : "未触发";
      return `- ${node.id} | ${node.title} | ${status} | ${node.content}`;
    }).join("\n");
    return `组 ${group.id} | ${group.title}\n概述: ${group.summary || "无"}\n${nodes}`;
  }).join("\n\n");

  const analysisPrompt = [
    "以下是当前聊天整理后的历史：",
    serializeConversation(chat),
    "",
    "以下是当前已激活的故事节点组：",
    activeGroupText,
    "",
    triggeredSummary ? `已触发摘要：\n${triggeredSummary}` : "已触发摘要：暂无",
    "",
    "请判断每个候选节点的融入时机（immediate/deferred），只返回 JSON。若没有合适节点，matches 返回空数组。",
  ].join("\n");

  let rawResult;
  try {
    rawResult = await callDirectorApi({
      temperature: 0.2,
      messages: [
        { role: "system", content: settings.promptTemplates.nodeAnalysisSystem },
        { role: "user", content: analysisPrompt },
      ],
    });
  } catch (apiError) {
    console.warn("Director analysis API unavailable, using direct node injection:", apiError.message);
    const fallback = normalizeUserPlaceholder(buildFallbackInjection(activeGroups, settings));
    state.lastMatchedNodeIds = [];
    state.lastInjectionPreview = fallback;
    state.lastAnalysisSignature = "";
    await saveChatState();
    return fallback;
  }

  const parsed = extractJsonObject(rawResult);
  const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
  const chosenMatches = matches
    .filter((match) => match.groupId && match.nodeId)
    .sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999))
    .slice(0, 4);

  const matchedNodes = [];
  const lastMatchedNodeIds = [];

  for (const match of chosenMatches) {
    const group = activeGroups.find((item) => item.id === match.groupId);
    const node = group?.nodes.find((item) => item.id === match.nodeId && !item.triggered);
    if (!group || !node) {
      continue;
    }

    matchedNodes.push({
      groupTitle: group.title,
      nodeTitle: node.title,
      nodeContent: node.content,
      reason: normalizeUserPlaceholder(match.reason || "顺应当前剧情推进"),
      timing: match.timing === "deferred" ? "deferred" : "immediate",
    });
    lastMatchedNodeIds.push(`${group.title} / ${node.title}`);
  }

  const preview = matchedNodes.length === 0
    ? ""
    : [
      settings.promptTemplates.injectionTemplate,
      "",
      "候选推进节点：",
      ...matchedNodes.map((node, index) => {
        const timingLabel = node.timing === "deferred" ? "【情节收尾后引导】" : "【立即引导】";
        return `${index + 1}. ${timingLabel} [${node.groupTitle}] ${node.nodeTitle}\n   目标：${node.nodeContent}\n   引导理由：${node.reason}`;
      }),
      "",
      triggeredSummary ? `已触发节点摘要：\n${triggeredSummary}` : "已触发节点摘要：暂无",
      parsed.summary ? `\n分析摘要：${normalizeUserPlaceholder(parsed.summary)}` : "",
    ].filter(Boolean).join("\n");

  state.lastMatchedNodeIds = lastMatchedNodeIds;
  state.lastInjectionPreview = normalizeUserPlaceholder(preview);
  state.lastAnalysisSignature = signature;
  state.lastAnalysisAt = Date.now();
  await saveChatState();

  return state.lastInjectionPreview;
}

async function handleManualAnalysis() {
  try {
    setStatus("#director_analysis_status", "正在分析当前聊天最适合的节点...", "info");
    const preview = await buildInjectionPreview(true);
    renderChatPanel();
    if (preview) {
      setStatus("#director_analysis_status", "分析完成，注入预览已刷新", "success");
      toastr.success("分析完成，注入预览已刷新", "St导演");
    } else {
      setStatus("#director_analysis_status", "当前没有合适的候选节点或没有激活节点组", "warning");
      toastr.warning("当前没有合适的候选节点或没有激活节点组", "St导演");
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
    context.setExtensionPrompt(extensionName, content, injectionPosition, injectionDepth, false, "system");
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
  const nodeState = groupState.nodeStateById[nodeId] || { triggered: false, note: "" };
  nodeState.triggered = checked;
  groupState.nodeStateById[nodeId] = nodeState;
  state.activationStateByGroup[groupId] = groupState;
  state.lastAnalysisSignature = "";
  await saveChatState();
  await checkAndAutoGeneratePlot();
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

  $("#director_enabled, #director_connection_name, #director_api_url, #director_api_key, #director_generation_prompt, #director_analysis_prompt, #director_injection_prompt")
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

  $("#director_model_name")
    .off("input")
    .on("input", () => {
      saveAllSettings();
      renderModelSelect();
    });

  $("#director_model_select")
    .off("change")
    .on("change", function onModelSelected() {
      $("#director_model_name").val($(this).val());
      saveAllSettings();
    });

  $("#director_save_connection")
    .off("click")
    .on("click", () => {
      saveAllSettings();
      setStatus("#director_connection_status", "连接配置已保存", "success");
      toastr.success("连接配置已保存", "St导演");
    });

  $("#director_fetch_models")
    .off("click")
    .on("click", handleFetchModels);

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
    const triggeredCount = group.nodes.filter((node) => activationState.nodeStateById[node.id]?.triggered).length;
    if (group.nodes.length - triggeredCount === 1) {
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
    `【自动续写】当前情节“${group.title}”已接近尾声（仅剩最后一个节点未触发）。`,
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
    await buildInjectionPreview(true);
    await checkAndAutoGeneratePlot();
    renderChatPanel();
  } catch (error) {
    console.error("Director after-message analysis failed", error);
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
}

globalThis.stDirectorGenerateInterceptor = async function stDirectorGenerateInterceptor() {
  const settings = getSettings();
  if (!settings.enabled) {
    updateExtensionPrompt("");
    return;
  }
  const state = getChatState();
  updateExtensionPrompt(state.lastInjectionPreview || "");
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