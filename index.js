import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "SillyTavern-Director";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const chatMetadataKey = `${extensionName}:chat-state`;
const injectionPosition = 0;
const injectionDepth = 4;
const floatingButtonMargin = 12;

const defaultSettings = Object.freeze({
  enabled: true,
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
  storyBrief: "",
  generatorGroupCount: 3,
  generatorNodesPerGroup: 4,
  nodeGroupLibrary: [],
  promptTemplates: {
    nodeGenerationSystem: [
      "你是一个故事导演策划器。",
      "你的任务是根据用户提供的故事概要，输出多组并行推进的故事事件节点。",
      "输出必须是合法 JSON，不要输出 Markdown 代码块，不要输出解释。",
      "如果提到主角、玩家、用户或第一人称主视角角色，统一写成 <user>，不要写真实名字。",
      "每组节点是并行关系，组内节点按推荐推进顺序排列。",
      "节点描述要短、可执行、可触发，且能显著推动故事。",
      "不要生成空节点、重复节点或仅描述情绪而不推动剧情的节点。",
      "输出格式：{\"groups\":[{\"title\":string,\"summary\":string,\"nodes\":[{\"title\":string,\"content\":string}]}]}"
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
  settings.floatingButtonPosition = {
    ...defaults.floatingButtonPosition,
    ...(settings.floatingButtonPosition || {}),
  };
  settings.apiConfig = { ...defaults.apiConfig, ...(settings.apiConfig || {}) };
  settings.modelList = Array.isArray(settings.modelList) ? settings.modelList : [];
  settings.storyBrief = settings.storyBrief || "";
  settings.generatorGroupCount = clampNumber(settings.generatorGroupCount, 1, 8, defaults.generatorGroupCount);
  settings.generatorNodesPerGroup = clampNumber(settings.generatorNodesPerGroup, 1, 8, defaults.generatorNodesPerGroup);
  settings.nodeGroupLibrary = Array.isArray(settings.nodeGroupLibrary) ? settings.nodeGroupLibrary : [];
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

function setFloatingButtonPosition(left, top) {
  const button = getFloatingButtonElement();
  if (!button.length) {
    return;
  }

  const maxLeft = Math.max(floatingButtonMargin, window.innerWidth - button.outerWidth() - floatingButtonMargin);
  const maxTop = Math.max(floatingButtonMargin, window.innerHeight - button.outerHeight() - floatingButtonMargin);
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

  const width = button.outerWidth() || 0;
  const height = button.outerHeight() || 0;
  const defaultLeft = Math.max(floatingButtonMargin, window.innerWidth - width - 24);
  const defaultTop = Math.max(floatingButtonMargin, window.innerHeight - height - 88);
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
    ensureFloatingButtonPosition();
    return;
  }

  floatingLauncherState.initialized = true;
  ensureFloatingButtonPosition();

  $(window)
    .off("resize.directorLauncher")
    .on("resize.directorLauncher", () => {
      ensureFloatingButtonPosition();
    });
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

function normalizeGeneratedGroups(rawGroups) {
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
    throw new Error("模型没有返回任何节点组");
  }

  return rawGroups.map((group, groupIndex) => {
    const nodes = Array.isArray(group.nodes) ? group.nodes : [];
    if (nodes.length === 0) {
      throw new Error(`第 ${groupIndex + 1} 组没有节点`);
    }

    return {
      id: createId("group"),
      title: String(group.title || `节点组 ${groupIndex + 1}`).trim(),
      summary: String(group.summary || "").trim(),
      createdAt: Date.now(),
      nodes: nodes.map((node, nodeIndex) => ({
        id: createId("node"),
        title: normalizeUserPlaceholder(String(node.title || `节点 ${nodeIndex + 1}`).trim()),
        content: normalizeUserPlaceholder(String(node.content || node.title || "").trim()),
      })),
    };
  });
}

function normalizeUserPlaceholder(value) {
  return String(value || "")
    .replace(/<(?:\s*user\s*)>/gi, "<user>")
    .replace(/\b(?:用户|玩家|主角本人|主人公本人)\b/g, "<user>");
}

function getLibraryGroupById(groupId) {
  return getSettings().nodeGroupLibrary.find((group) => group.id === groupId) || null;
}

function syncChatStateWithLibrary() {
  const settings = getSettings();
  const state = getChatState();
  const validGroupIds = new Set(settings.nodeGroupLibrary.map((group) => group.id));

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

function renderLibrary() {
  const settings = getSettings();
  const state = syncChatStateWithLibrary();

  if (settings.nodeGroupLibrary.length === 0) {
    $("#director_library_groups").html('<div class="director-empty">还没有故事节点组。先在上方输入故事概要并生成。</div>');
    return;
  }

  const html = settings.nodeGroupLibrary.map((group) => {
    const active = state.activeGroupIds.includes(group.id);
    const nodes = group.nodes.map((node) => `
      <div class="director-node-row" data-node-id="${escapeHtml(node.id)}">
        <input class="text_pole director-node-title" type="text" value="${escapeHtml(node.title)}" placeholder="节点标题" />
        <textarea class="text_pole director-node-content" rows="2" placeholder="节点内容">${escapeHtml(node.content)}</textarea>
        <div class="director-node-actions">
          <button class="menu_button director-add-node" data-group-id="${escapeHtml(group.id)}" type="button">在后面加节点</button>
          <button class="menu_button director-delete-node" data-group-id="${escapeHtml(group.id)}" data-node-id="${escapeHtml(node.id)}" type="button">删除节点</button>
        </div>
      </div>
    `).join("");

    return `
      <div class="director-card" data-group-id="${escapeHtml(group.id)}">
        <div class="director-card-header">
          <div>
            <input class="text_pole director-group-title" type="text" value="${escapeHtml(group.title)}" placeholder="节点组标题" />
            <textarea class="text_pole director-group-summary" rows="2" placeholder="该组概述">${escapeHtml(group.summary || "")}</textarea>
          </div>
          <div class="director-group-actions">
            <button class="menu_button director-toggle-active" data-group-id="${escapeHtml(group.id)}" type="button">${active ? "从聊天移除" : "加入聊天"}</button>
            <button class="menu_button director-delete-group" data-group-id="${escapeHtml(group.id)}" type="button">删除整组</button>
          </div>
        </div>
        <div class="director-node-list">${nodes}</div>
      </div>
    `;
  }).join("");

  $("#director_library_groups").html(html);
}

function renderChatPanel() {
  const context = getContext();
  const state = syncChatStateWithLibrary();
  const activeGroups = getActiveGroups();
  const chatName = context?.name2 || context?.groupId || "当前会话";

  $("#director_chat_scope").text(`当前聊天：${chatName}`);

  if (activeGroups.length === 0) {
    $("#director_active_groups").html('<div class="director-empty">当前聊天还没有激活任何节点组。去上面的节点库里点击“加入当前聊天”。</div>');
  } else {
    const html = activeGroups.map((group) => `
      <div class="director-card director-active-card" data-group-id="${escapeHtml(group.id)}">
        <div class="director-active-header">
          <strong>${escapeHtml(group.title)}</strong>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="director-chip">${group.nodes.filter((node) => node.triggered).length}/${group.nodes.length} 已触发</span>
            <button class="menu_button director-toggle-active" data-group-id="${escapeHtml(group.id)}" type="button" style="padding:2px 10px;font-size:0.82rem;">从聊天移除</button>
          </div>
        </div>
        <div class="director-active-summary">${escapeHtml(group.summary || "")}</div>
        <div class="director-node-state-list">
          ${group.nodes.map((node) => `
            <label class="director-node-state-item">
              <input class="director-node-trigger" type="checkbox" data-group-id="${escapeHtml(group.id)}" data-node-id="${escapeHtml(node.id)}" ${node.triggered ? "checked" : ""} />
              <span>
                <strong>${escapeHtml(node.title || "未命名节点")}</strong>
                <span>${escapeHtml(node.content)}</span>
              </span>
            </label>
          `).join("")}
        </div>
      </div>
    `).join("");

    $("#director_active_groups").html(html);
  }

  $("#director_last_matches").html(state.lastMatchedNodeIds.length
    ? state.lastMatchedNodeIds.map((item) => `<span class="director-chip">${escapeHtml(item)}</span>`).join("")
    : '<span class="director-empty-inline">暂无最近命中的节点</span>');
  $("#director_injection_preview").val(state.lastInjectionPreview || "");
}

function renderSettings() {
  const settings = getSettings();
  $("#director_enabled").prop("checked", settings.enabled);
  $("#director_connection_name").val(settings.apiConfig.name || "");
  $("#director_api_url").val(settings.apiConfig.url || "");
  $("#director_api_key").val(settings.apiConfig.apiKey || "");
  $("#director_story_brief").val(settings.storyBrief || "");
  $("#director_group_count").val(settings.generatorGroupCount);
  $("#director_nodes_per_group").val(settings.generatorNodesPerGroup);
  $("#director_generation_prompt").val(settings.promptTemplates.nodeGenerationSystem);
  $("#director_analysis_prompt").val(settings.promptTemplates.nodeAnalysisSystem);
  $("#director_injection_prompt").val(settings.promptTemplates.injectionTemplate);
  renderModelSelect();
  renderLibrary();
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
  settings.apiConfig.name = String($("#director_connection_name").val() || "").trim();
  settings.apiConfig.url = trimTrailingSlash($("#director_api_url").val());
  settings.apiConfig.apiKey = String($("#director_api_key").val() || "").trim();
  settings.apiConfig.model = getModelValue();
  settings.storyBrief = String($("#director_story_brief").val() || "").trim();
  settings.generatorGroupCount = clampNumber($("#director_group_count").val(), 1, 8, defaultSettings.generatorGroupCount);
  settings.generatorNodesPerGroup = clampNumber($("#director_nodes_per_group").val(), 1, 8, defaultSettings.generatorNodesPerGroup);
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

async function handleGenerateGroups() {
  try {
    saveAllSettings();
    const settings = getSettings();

    if (!settings.storyBrief) {
      throw new Error("请先输入故事概要");
    }

    setStatus("#director_generation_status", "正在生成故事节点组...", "info");

    const userPrompt = [
      `故事概要：${normalizeUserPlaceholder(settings.storyBrief)}`,
      `需要生成 ${settings.generatorGroupCount} 组并行节点组。`,
      `每组约 ${settings.generatorNodesPerGroup} 个节点。`,
      "请严格输出 JSON。",
      "如果故事里提到主角姓名，必须统一替换成 <user>。",
    ].join("\n");

    const rawResult = await callDirectorApi({
      temperature: 0.6,
      messages: [
        { role: "system", content: settings.promptTemplates.nodeGenerationSystem },
        { role: "user", content: userPrompt },
      ],
    });

    const parsed = extractJsonObject(rawResult);
    const groups = normalizeGeneratedGroups(parsed.groups);
    settings.nodeGroupLibrary.push(...groups);
    saveSettingsDebounced();

    const activeContext = getContext();
    const hasActiveChat = Array.isArray(activeContext.chat) && activeContext.chat.length > 0;
    if (hasActiveChat) {
      for (const group of groups) {
        ensureGroupActivated(group.id);
      }
      await saveChatState();
    }

    renderLibrary();
    renderChatPanel();
    const activatedNote = hasActiveChat ? "，已自动加入当前聊天" : "，请手动加入聊天";
    setStatus("#director_generation_status", `已生成 ${groups.length} 组故事节点${activatedNote}`, "success");
    toastr.success(`已生成 ${groups.length} 组故事节点${activatedNote}`, "St导演");
  } catch (error) {
    console.error("Director generate groups failed", error);
    setStatus("#director_generation_status", error.message, "error");
    toastr.error(error.message, "St导演");
  }
}

function getAnalysisPayload() {
  const context = getContext();
  const activeGroups = getActiveGroups();
  const chat = Array.isArray(context.chat) ? context.chat : [];

  return {
    activeGroups,
    chat,
    signature: buildAnalysisSignature(activeGroups, chat),
  };
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

  const rawResult = await callDirectorApi({
    temperature: 0.2,
    messages: [
      { role: "system", content: settings.promptTemplates.nodeAnalysisSystem },
      { role: "user", content: analysisPrompt },
    ],
  });

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
  renderLibrary();
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
  renderChatPanel();
}

function updateLibraryGroupField(groupId, field, value) {
  const group = getLibraryGroupById(groupId);
  if (!group) {
    return;
  }
  group[field] = normalizeUserPlaceholder(String(value || "").trim());
  invalidateCurrentChatAnalysisCache();
  saveSettingsDebounced();
  renderChatPanel();
}

function updateLibraryNodeField(groupId, nodeId, field, value) {
  const group = getLibraryGroupById(groupId);
  const node = group?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return;
  }
  node[field] = normalizeUserPlaceholder(String(value || "").trim());
  invalidateCurrentChatAnalysisCache();
  saveSettingsDebounced();
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
  saveSettingsDebounced();
  syncChatStateWithLibrary();
  await saveChatState();
  renderLibrary();
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
  saveSettingsDebounced();
  syncChatStateWithLibrary();
  await saveChatState();
  renderLibrary();
  renderChatPanel();
}

async function deleteGroup(groupId) {
  const settings = getSettings();
  settings.nodeGroupLibrary = settings.nodeGroupLibrary.filter((group) => group.id !== groupId);
  removeActivatedGroup(groupId);
  invalidateCurrentChatAnalysisCache();
  saveSettingsDebounced();
  await saveChatState();
  renderLibrary();
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

  $("#director_enabled, #director_connection_name, #director_api_url, #director_api_key, #director_story_brief, #director_group_count, #director_nodes_per_group, #director_generation_prompt, #director_analysis_prompt, #director_injection_prompt")
    .off("input")
    .on("input", () => {
      saveAllSettings();
      renderLibrary();
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

  $("#director_generate_groups")
    .off("click")
    .on("click", handleGenerateGroups);

  $("#director_run_analysis")
    .off("click")
    .on("click", handleManualAnalysis);

  $(document)
    .off("click", ".director-toggle-active")
    .on("click", ".director-toggle-active", async function toggleActive() {
      const groupId = $(this).data("group-id");
      const isActive = getChatState().activeGroupIds.includes(groupId);
      await handleGroupActivation(groupId, !isActive);
    });

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

function bindContextEvents() {
  const context = getContext();
  if (!context?.eventSource || !context?.event_types) {
    return;
  }

  context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
    syncChatStateWithLibrary();
    renderChatPanel();
  });
}

globalThis.stDirectorGenerateInterceptor = async function stDirectorGenerateInterceptor() {
  const settings = getSettings();
  if (!settings.enabled) {
    updateExtensionPrompt("");
    return;
  }

  try {
    const preview = await buildInjectionPreview(false);
    updateExtensionPrompt(preview || "");
    renderChatPanel();
  } catch (error) {
    console.error("Director interceptor failed", error);
    updateExtensionPrompt("");
  }
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