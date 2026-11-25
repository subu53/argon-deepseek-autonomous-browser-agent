/**
 * Argon-DeepSeek Autonomous Browser Agent
 * Manifest V3 Service Worker (background.js)
 *
 * Orchestrates:
 * - ReAct loop (Observe -> Think -> Act -> Verify)
 * - Plan A engines: Zero-Key Chrome Built-in Gemini Nano | Google Gemini Cloud API | Custom/Local Endpoint
 * - Seamless Plan A -> Plan B (DeepSeek) auto-failover
 * - Human-in-the-Loop Safety Gate for high-risk actions
 * - Tab management, optional chrome.debugger fallback click, and Dry-Run diagnostics
 */

import { loadSettings, saveSettings, expandSlashCommand } from './lib/config.js';
import { evaluateActionSafety } from './lib/safety.js';
import {
  decideNextAction,
  verifyGeminiKey,
  verifyDeepSeekKey,
  verifyCustomEndpoint
} from './lib/providers.js';
import {
  getLocalNanoApi,
  checkLocalNanoAvailability,
  runLocalNanoPrompt
} from './lib/chrome_nano.js';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {
    // Supported in Chrome 116+
  });

const agentState = {
  status: 'idle', // 'idle' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'stopped' | 'error'
  runId: 0,
  goal: '',
  rawInput: '',
  shortcutUsed: null,
  step: 0,
  maxSteps: 20,
  activeProvider: 'chrome-nano', // 'chrome-nano' | 'gemini' | 'custom-openai' | 'deepseek'
  activeModel: 'gemini-nano (on-device)',
  failoverBanner: null,
  pendingApproval: null,
  logs: [],
  history: [],
  lastDomMap: [],
  lastTabId: null
};

let approvalResolver = null;
let pauseResolver = null;

function nowIso() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addLog(entry) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: nowIso(),
    level: 'info',
    provider: agentState.activeProvider,
    ...entry
  };
  agentState.logs.push(item);
  if (agentState.logs.length > 200) {
    agentState.logs = agentState.logs.slice(-200);
  }
  broadcastState();
}

function getPublicState() {
  return {
    status: agentState.status,
    runId: agentState.runId,
    goal: agentState.goal,
    rawInput: agentState.rawInput,
    shortcutUsed: agentState.shortcutUsed,
    step: agentState.step,
    maxSteps: agentState.maxSteps,
    activeProvider: agentState.activeProvider,
    activeModel: agentState.activeModel,
    failoverBanner: agentState.failoverBanner,
    pendingApproval: agentState.pendingApproval,
    logs: agentState.logs
  };
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload: getPublicState() }).catch(() => {
    // Side panel may be closed; ignore cleanly
  });
}

function isRestrictedUrl(url = '') {
  return (
    !url ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  );
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function getOpenTabsSummary() {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  return tabs.map((t) => ({
    id: t.id,
    title: t.title || 'Untitled',
    url: t.url || '',
    active: Boolean(t.active)
  }));
}

async function ensureContentScript(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_PING' });
    if (ping?.ok) return true;
  } catch {
    // Not injected yet
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
  await sleep(120);
  return true;
}

async function sendToTab(tabId, message) {
  await ensureContentScript(tabId);
  return await chrome.tabs.sendMessage(tabId, message);
}

async function captureViewportScreenshot(windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: 68
    });
    const prefix = 'data:image/jpeg;base64,';
    return dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : null;
  } catch {
    return null;
  }
}

async function debuggerClickFallback(tabId, x, y) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    return true;
  } catch {
    return false;
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch {
      // Already detached
    }
  }
}

/**
 * Run Chrome Built-in Gemini Nano directly in the service worker if exposed,
 * or bridge cleanly to the open Side Panel window context.
 */
async function executeChromeNanoPrompt({ systemPrompt, userPrompt }) {
  if (getLocalNanoApi()) {
    return await runLocalNanoPrompt({ systemPrompt, userPrompt });
  }
  const resp = await chrome.runtime.sendMessage({
    type: 'SIDEPANEL_RUN_NANO',
    payload: { systemPrompt, userPrompt }
  });
  if (!resp?.ok) {
    throw new Error(resp?.error || 'Chrome Built-in Gemini Nano is not available.');
  }
  return resp.text;
}

async function checkChromeNanoAcrossContexts() {
  if (getLocalNanoApi()) {
    return await checkLocalNanoAvailability();
  }
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SIDEPANEL_CHECK_NANO' });
    if (resp && typeof resp.available === 'boolean') {
      return resp;
    }
  } catch {
    // Side panel closed
  }
  return await checkLocalNanoAvailability();
}

async function observeBrowser(includeScreenshot) {
  const [activeTab, tabs] = await Promise.all([getActiveTab(), getOpenTabsSummary()]);
  if (!activeTab) {
    return {
      activeTab: null,
      tabs,
      domMap: [],
      pageMeta: null,
      screenshotBase64: null,
      domError: 'No active browser tab found.'
    };
  }

  agentState.lastTabId = activeTab.id;

  if (isRestrictedUrl(activeTab.url)) {
    return {
      activeTab: { id: activeTab.id, title: activeTab.title, url: activeTab.url },
      tabs,
      domMap: [],
      pageMeta: null,
      screenshotBase64: null,
      domError: `Active tab (${activeTab.url}) is a restricted Chrome page. Use open_tab or switch_tab to navigate to a standard website.`
    };
  }

  let domResult = null;
  let domError = null;
  try {
    domResult = await sendToTab(activeTab.id, { type: 'CONTENT_INDEX_DOM' });
  } catch (err) {
    domError = `Could not inspect DOM on this tab: ${err.message}`;
  }

  const screenshotBase64 = includeScreenshot
    ? await captureViewportScreenshot(activeTab.windowId)
    : null;

  agentState.lastDomMap = domResult?.domMap || [];

  return {
    activeTab: { id: activeTab.id, title: activeTab.title, url: activeTab.url },
    tabs,
    domMap: domResult?.domMap || [],
    pageMeta: domResult?.pageMeta || null,
    screenshotBase64,
    domError
  };
}

function waitForTabReady(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') {
        setTimeout(done, 350);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(done, timeoutMs);
  });
}

async function executeToolCall(toolCall, activeTabId, settings) {
  const { name, args = {} } = toolCall;

  switch (name) {
    case 'click': {
      if (!activeTabId) return { ok: false, error: 'No active tab to click on.' };
      const res = await sendToTab(activeTabId, { type: 'CONTENT_CLICK', payload: args });
      if (res?.ok && settings.useDebuggerFallback && res.coords) {
        await debuggerClickFallback(activeTabId, res.coords.clientX, res.coords.clientY);
      }
      await sleep(550);
      return res;
    }

    case 'type': {
      if (!activeTabId) return { ok: false, error: 'No active tab to type into.' };
      const res = await sendToTab(activeTabId, { type: 'CONTENT_TYPE', payload: args });
      await sleep(300);
      return res;
    }

    case 'select_option': {
      if (!activeTabId) return { ok: false, error: 'No active tab for select_option.' };
      const res = await sendToTab(activeTabId, { type: 'CONTENT_SELECT', payload: args });
      await sleep(250);
      return res;
    }

    case 'scroll': {
      if (!activeTabId) return { ok: false, error: 'No active tab to scroll.' };
      const res = await sendToTab(activeTabId, { type: 'CONTENT_SCROLL', payload: args });
      await sleep(450);
      return res;
    }

    case 'extract_page_text': {
      if (!activeTabId) return { ok: false, error: 'No active tab to extract text from.' };
      return await sendToTab(activeTabId, { type: 'CONTENT_EXTRACT_TEXT', payload: args });
    }

    case 'open_tab': {
      const rawUrl = String(args.url || '').trim();
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const tab = await chrome.tabs.create({ url, active: args.active !== false });
      await waitForTabReady(tab.id, 8000);
      return { ok: true, message: `Opened tab [${tab.id}] at ${url}`, tabId: tab.id };
    }

    case 'switch_tab': {
      const targetTabId = Number(args.tab_id);
      if (!Number.isInteger(targetTabId)) {
        return { ok: false, error: `Invalid tab_id: ${args.tab_id}` };
      }
      const tab = await chrome.tabs.update(targetTabId, { active: true });
      if (tab?.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      await sleep(400);
      return { ok: true, message: `Switched to tab [${tab.id}] ${tab.title || tab.url}` };
    }

    case 'wait': {
      const ms = Math.max(500, Math.min(Number(args.ms) || 1500, 5000));
      await sleep(ms);
      return { ok: true, message: `Waited ${ms}ms` };
    }

    case 'finish': {
      return {
        ok: true,
        finished: true,
        status: args.status || 'completed',
        summary: args.summary || 'Task finished.'
      };
    }

    default:
      return { ok: false, error: `Unsupported tool: ${name}` };
  }
}

async function waitIfPaused(myRunId) {
  while (agentState.status === 'paused' && agentState.runId === myRunId) {
    await new Promise((resolve) => {
      pauseResolver = resolve;
    });
  }
}

function requestHumanApproval(payload) {
  agentState.status = 'awaiting_approval';
  agentState.pendingApproval = payload;
  broadcastState();
  return new Promise((resolve) => {
    approvalResolver = resolve;
  });
}

function resolveHumanApproval(decision) {
  if (!approvalResolver) return;
  const resolve = approvalResolver;
  approvalResolver = null;
  agentState.pendingApproval = null;
  if (decision === 'approve' || decision === 'skip') {
    agentState.status = 'running';
  }
  broadcastState();
  resolve(decision);
}

function resolveInitialProvider(settings) {
  const mode = settings.planAMode || 'chrome-nano';
  if (mode === 'chrome-nano') {
    return { provider: 'chrome-nano', model: 'gemini-nano (on-device)', failoverBanner: null };
  }
  if (mode === 'custom-openai') {
    return { provider: 'custom-openai', model: settings.customModel || 'local-model', failoverBanner: null };
  }
  if (settings.geminiApiKey && settings.geminiApiKey.trim()) {
    return { provider: 'gemini', model: settings.planAModel, failoverBanner: null };
  }
  if (settings.deepseekApiKey && settings.deepseekApiKey.trim()) {
    return {
      provider: 'deepseek',
      model: settings.planBModel,
      failoverBanner: 'Switched to Plan B: DeepSeek Failsafe'
    };
  }
  return { provider: 'gemini', model: settings.planAModel, failoverBanner: null };
}

async function startAgentTask(rawInput) {
  const settings = await loadSettings();
  const { expandedPrompt, shortcutUsed } = expandSlashCommand(rawInput);

  if (!expandedPrompt) {
    addLog({ level: 'error', title: 'Empty task', detail: 'Please enter a task or choose a slash shortcut.' });
    return;
  }

  const myRunId = agentState.runId + 1;
  if (approvalResolver) resolveHumanApproval('stop');
  if (pauseResolver) {
    pauseResolver();
    pauseResolver = null;
  }

  const initial = resolveInitialProvider(settings);

  agentState.runId = myRunId;
  agentState.status = 'running';
  agentState.rawInput = rawInput.trim();
  agentState.goal = expandedPrompt;
  agentState.shortcutUsed = shortcutUsed;
  agentState.step = 0;
  agentState.maxSteps = Math.max(3, Math.min(Number(settings.maxSteps) || 20, 40));
  agentState.activeProvider = initial.provider;
  agentState.activeModel = initial.model;
  agentState.failoverBanner = initial.failoverBanner;
  agentState.pendingApproval = null;
  agentState.logs = [];
  agentState.history = [];
  agentState.lastDomMap = [];

  addLog({
    level: 'system',
    title: shortcutUsed ? `Task started via ${shortcutUsed}` : 'Task started',
    detail: agentState.rawInput
  });

  try {
    for (let step = 1; step <= agentState.maxSteps; step++) {
      if (agentState.runId !== myRunId || agentState.status === 'stopped') break;
      await waitIfPaused(myRunId);
      if (agentState.runId !== myRunId || agentState.status === 'stopped') break;

      agentState.step = step;
      const liveSettings = await loadSettings();
      broadcastState();

      // 1. OBSERVE
      const needVision = agentState.activeProvider === 'gemini';
      addLog({
        level: 'observe',
        step,
        title: `Step ${step}: Observing page`,
        detail: needVision
          ? 'Capturing Interactive DOM Map + viewport vision screenshot (Plan A: Gemini Cloud)'
          : 'Capturing structured Interactive DOM Map'
      });

      const observation = await observeBrowser(needVision);
      if (agentState.runId !== myRunId || agentState.status === 'stopped') break;

      // 2. THINK (with automatic Plan A -> Plan B DeepSeek failover)
      const decision = await decideNextAction({
        settings: liveSettings,
        activeProvider: agentState.activeProvider,
        goal: agentState.goal,
        step,
        maxSteps: agentState.maxSteps,
        observation,
        history: agentState.history,
        nanoRunner: executeChromeNanoPrompt,
        onFailover: ({ reason }) => {
          agentState.activeProvider = 'deepseek';
          agentState.activeModel = liveSettings.planBModel;
          agentState.failoverBanner = 'Switched to Plan B: DeepSeek Failsafe';
          addLog({
            level: 'failover',
            step,
            provider: 'deepseek',
            title: 'Switched to Plan B: DeepSeek Failsafe',
            detail: `${reason}. Seamlessly resuming step ${step} via ${liveSettings.planBModel} with full task state preserved.`
          });
        }
      });

      if (agentState.runId !== myRunId || agentState.status === 'stopped') break;

      agentState.activeProvider = decision.provider;
      agentState.activeModel = decision.model;

      const { toolCall, thought } = decision;
      addLog({
        level: 'think',
        step,
        provider: decision.provider,
        title: `Action: ${toolCall.name}`,
        detail: `${thought}\nArgs: ${JSON.stringify(toolCall.args)}`
      });

      // 3. SAFETY GATE (Human-in-the-Loop)
      const safety = evaluateActionSafety(toolCall, observation.domMap, liveSettings.safetyMode);
      if (safety.requiresApproval) {
        addLog({
          level: 'warning',
          step,
          provider: decision.provider,
          title: 'Paused at Human-in-the-Loop Safety Gate',
          detail: `${safety.matchedRule} (${safety.targetSummary}). Waiting for user confirmation.`
        });

        const userChoice = await requestHumanApproval({
          id: `approval-${myRunId}-${step}`,
          step,
          toolCall,
          thought,
          matchedRule: safety.matchedRule,
          targetSummary: safety.targetSummary,
          element: safety.element
        });

        if (agentState.runId !== myRunId || userChoice === 'stop') {
          agentState.status = 'stopped';
          addLog({ level: 'warning', step, title: 'Task stopped by user at safety gate', detail: '' });
          break;
        }

        if (userChoice === 'skip') {
          addLog({
            level: 'info',
            step,
            title: 'Step skipped by user',
            detail: `Skipped ${safety.targetSummary}. Asking agent to continue or wrap up safely.`
          });
          agentState.history.push({
            step,
            provider: decision.provider,
            thought,
            toolCall,
            result:
              'USER_SKIPPED_HIGH_RISK_ACTION: Do not retry this exact high-risk click unless asked. Consider finishing and letting the user review.'
          });
          continue;
        }

        addLog({
          level: 'success',
          step,
          title: 'Approved by user',
          detail: `Executing ${safety.targetSummary}`
        });
      }

      // 4. ACT & VERIFY
      const result = await executeToolCall(toolCall, observation.activeTab?.id, liveSettings);
      const compactResult =
        toolCall.name === 'extract_page_text' && result?.ok
          ? `Extracted ${result.text.length} chars from "${result.title}":\n${result.text.slice(0, 2600)}`
          : result?.ok
            ? result.message || result.summary || 'OK'
            : `ERROR: ${result?.error || 'Action failed'}`;

      agentState.history.push({
        step,
        provider: decision.provider,
        thought,
        toolCall,
        result: compactResult
      });

      if (result?.finished) {
        agentState.status = 'completed';
        addLog({
          level: 'success',
          step,
          provider: decision.provider,
          title: result.status === 'completed' ? 'Task completed' : `Task finished (${result.status})`,
          detail: result.summary
        });
        break;
      }

      addLog({
        level: result?.ok ? 'verify' : 'error',
        step,
        provider: decision.provider,
        title: result?.ok ? `Verified: ${toolCall.name}` : `Action error: ${toolCall.name}`,
        detail: result?.ok ? result.message || 'Succeeded' : result?.error || 'Unknown error'
      });
    }

    if (agentState.runId === myRunId && agentState.status === 'running') {
      agentState.status = 'completed';
      addLog({
        level: 'warning',
        title: 'Reached maximum step limit',
        detail: `Stopped after ${agentState.maxSteps} steps. Increase Max Steps in Settings or continue with a follow-up prompt.`
      });
    }
  } catch (err) {
    if (agentState.runId === myRunId) {
      agentState.status = 'error';
      addLog({
        level: 'error',
        title: 'Execution halted due to error',
        detail: err?.message || String(err)
      });
    }
  } finally {
    if (agentState.runId === myRunId) {
      agentState.pendingApproval = null;
      if (agentState.lastTabId) {
        chrome.tabs.sendMessage(agentState.lastTabId, { type: 'CONTENT_CLEAR_IDS' }).catch(() => {});
      }
      broadcastState();
    }
  }
}

function stopAgentTask() {
  agentState.runId += 1;
  agentState.status = 'stopped';
  agentState.pendingApproval = null;
  if (approvalResolver) {
    const r = approvalResolver;
    approvalResolver = null;
    r('stop');
  }
  if (pauseResolver) {
    const r = pauseResolver;
    pauseResolver = null;
    r();
  }
  if (agentState.lastTabId) {
    chrome.tabs.sendMessage(agentState.lastTabId, { type: 'CONTENT_CLEAR_IDS' }).catch(() => {});
  }
  addLog({ level: 'warning', title: 'Emergency Stop triggered', detail: 'Agent execution halted immediately.' });
}

function togglePauseTask() {
  if (agentState.status === 'running') {
    agentState.status = 'paused';
    addLog({ level: 'warning', title: 'Execution paused', detail: 'Click Resume to continue from this step.' });
  } else if (agentState.status === 'paused') {
    agentState.status = 'running';
    addLog({ level: 'info', title: 'Execution resumed', detail: 'Continuing ReAct loop.' });
    if (pauseResolver) {
      const r = pauseResolver;
      pauseResolver = null;
      r();
    }
  }
  broadcastState();
}

async function runDiagnostics(overrideSettings = {}) {
  const saved = await loadSettings();
  const cfg = { ...saved, ...overrideSettings };

  const [chromeNano, gemini, customEndpoint, deepseek, domCheck] = await Promise.all([
    checkChromeNanoAcrossContexts(),
    verifyGeminiKey(cfg.geminiApiKey, cfg.planAModel),
    cfg.planAMode === 'custom-openai'
      ? verifyCustomEndpoint(cfg.customBaseUrl, cfg.customApiKey, cfg.customModel)
      : Promise.resolve({ ok: false, skipped: true, status: 0, latencyMs: 0, message: 'Not selected' }),
    verifyDeepSeekKey(cfg.deepseekApiKey, cfg.planBModel),
    (async () => {
      const tab = await getActiveTab();
      if (!tab) return { ok: false, count: 0, message: 'No active tab detected' };
      if (isRestrictedUrl(tab.url)) {
        return {
          ok: false,
          count: 0,
          url: tab.url,
          message: `Active tab is a restricted Chrome URL (${tab.url}). Open a regular webpage to test DOM indexing.`
        };
      }
      try {
        const res = await sendToTab(tab.id, { type: 'CONTENT_INDEX_DOM' });
        await chrome.tabs.sendMessage(tab.id, { type: 'CONTENT_CLEAR_IDS' }).catch(() => {});
        const sample = (res?.domMap || [])
          .slice(0, 4)
          .map((e) => `#${e.id} <${e.tag}> ${e.text || e.ariaLabel || e.placeholder || ''}`.trim());
        return {
          ok: Boolean(res?.ok),
          count: res?.domMap?.length || 0,
          totalIndexed: res?.pageMeta?.totalIndexed || 0,
          url: tab.url,
          title: tab.title,
          sample,
          message: `Indexed ${res?.domMap?.length || 0} visible interactive elements (${res?.pageMeta?.totalIndexed || 0} total on page)`
        };
      } catch (err) {
        return { ok: false, count: 0, url: tab.url, message: `DOM indexing failed: ${err.message}` };
      }
    })()
  ]);

  return {
    ok: true,
    timestamp: nowIso(),
    planAMode: cfg.planAMode,
    chromeNano,
    gemini,
    customEndpoint,
    deepseek,
    domCheck
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;
  if (message.type.startsWith('SIDEPANEL_')) return false;

  (async () => {
    try {
      switch (message.type) {
        case 'GET_STATE':
          sendResponse({ ok: true, state: getPublicState() });
          break;

        case 'GET_SETTINGS':
          sendResponse({ ok: true, settings: await loadSettings() });
          break;

        case 'SAVE_SETTINGS': {
          const updated = await saveSettings(message.payload || {});
          if (agentState.status === 'idle') {
            const initial = resolveInitialProvider(updated);
            agentState.activeProvider = initial.provider;
            agentState.activeModel = initial.model;
            broadcastState();
          }
          sendResponse({ ok: true, settings: updated });
          break;
        }

        case 'START_TASK':
          startAgentTask(message.payload?.prompt || '');
          sendResponse({ ok: true });
          break;

        case 'STOP_TASK':
          stopAgentTask();
          sendResponse({ ok: true, state: getPublicState() });
          break;

        case 'TOGGLE_PAUSE':
          togglePauseTask();
          sendResponse({ ok: true, state: getPublicState() });
          break;

        case 'RESOLVE_APPROVAL':
          resolveHumanApproval(message.payload?.decision || 'stop');
          sendResponse({ ok: true, state: getPublicState() });
          break;

        case 'CLEAR_LOGS':
          agentState.logs = [];
          agentState.failoverBanner = null;
          broadcastState();
          sendResponse({ ok: true, state: getPublicState() });
          break;

        case 'RUN_DIAGNOSTICS': {
          const report = await runDiagnostics(message.payload || {});
          sendResponse(report);
          break;
        }

        default:
          sendResponse({ ok: false, error: `Unknown background message: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});
