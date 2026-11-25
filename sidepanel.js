/**
 * Argon-DeepSeek Autonomous Browser Agent
 * Side Panel UI Controller + Chrome Built-in Gemini Nano Window Bridge
 */

import {
  PLAN_A_MODES,
  PLAN_A_MODELS,
  PLAN_B_MODELS,
  CUSTOM_ENDPOINT_PRESETS
} from './lib/config.js';
import {
  checkLocalNanoAvailability,
  runLocalNanoPrompt
} from './lib/chrome_nano.js';

const els = {
  html: document.documentElement,
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIcon: document.getElementById('themeIcon'),
  settingsToggleBtn: document.getElementById('settingsToggleBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  settingsDrawer: document.getElementById('settingsDrawer'),

  engineBadge: document.getElementById('engineBadge'),
  engineBadgeText: document.getElementById('engineBadgeText'),
  statusPill: document.getElementById('statusPill'),
  stepCounter: document.getElementById('stepCounter'),
  failoverBanner: document.getElementById('failoverBanner'),
  failoverBannerText: document.getElementById('failoverBannerText'),

  modeAskBtn: document.getElementById('modeAskBtn'),
  modeAutoBtn: document.getElementById('modeAutoBtn'),

  approvalCard: document.getElementById('approvalCard'),
  approvalStep: document.getElementById('approvalStep'),
  approvalRule: document.getElementById('approvalRule'),
  approvalTarget: document.getElementById('approvalTarget'),
  approvalThought: document.getElementById('approvalThought'),
  approveBtn: document.getElementById('approveBtn'),
  skipBtn: document.getElementById('skipBtn'),
  denyStopBtn: document.getElementById('denyStopBtn'),

  shortcutChips: document.querySelectorAll('.shortcut-chip'),
  taskInput: document.getElementById('taskInput'),
  runBtn: document.getElementById('runBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  stopBtn: document.getElementById('stopBtn'),

  clearLogBtn: document.getElementById('clearLogBtn'),
  logFeed: document.getElementById('logFeed'),

  planAMode: document.getElementById('planAMode'),
  chromeNanoSection: document.getElementById('chromeNanoSection'),
  geminiApiSection: document.getElementById('geminiApiSection'),
  customEndpointSection: document.getElementById('customEndpointSection'),
  presetChips: document.querySelectorAll('.preset-chip'),

  geminiApiKey: document.getElementById('geminiApiKey'),
  planAModel: document.getElementById('planAModel'),
  customBaseUrl: document.getElementById('customBaseUrl'),
  customModel: document.getElementById('customModel'),
  customApiKey: document.getElementById('customApiKey'),
  deepseekApiKey: document.getElementById('deepseekApiKey'),
  planBModel: document.getElementById('planBModel'),
  maxSteps: document.getElementById('maxSteps'),
  useDebuggerFallback: document.getElementById('useDebuggerFallback'),
  userMemory: document.getElementById('userMemory'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  dryRunBtn: document.getElementById('dryRunBtn'),
  settingsToast: document.getElementById('settingsToast'),
  diagnosticsBox: document.getElementById('diagnosticsBox'),
  diagnosticsResults: document.getElementById('diagnosticsResults')
};

let currentSettings = null;
let currentState = null;

function sendBg(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

function populateSelects() {
  els.planAMode.innerHTML = '';
  for (const mode of PLAN_A_MODES) {
    const opt = document.createElement('option');
    opt.value = mode.id;
    opt.textContent = mode.label;
    els.planAMode.appendChild(opt);
  }

  els.planAModel.innerHTML = '';
  for (const m of PLAN_A_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    els.planAModel.appendChild(opt);
  }

  els.planBModel.innerHTML = '';
  for (const m of PLAN_B_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    els.planBModel.appendChild(opt);
  }
}

function updatePlanAModeSections(mode) {
  els.chromeNanoSection.classList.toggle('hidden', mode !== 'chrome-nano');
  els.geminiApiSection.classList.toggle('hidden', mode !== 'gemini-api');
  els.customEndpointSection.classList.toggle('hidden', mode !== 'custom-openai');
}

function applyTheme(theme) {
  const mode = theme === 'light' ? 'light' : 'dark';
  els.html.setAttribute('data-theme', mode);
  els.themeIcon.textContent = mode === 'dark' ? '☀️' : '🌙';
}

function applySafetyModeUI(mode) {
  const isAuto = mode === 'auto';
  els.modeAskBtn.classList.toggle('active', !isAuto);
  els.modeAutoBtn.classList.toggle('active', isAuto);
}

function applySettingsToForm(settings) {
  currentSettings = settings;
  const mode = settings.planAMode || 'chrome-nano';
  els.planAMode.value = mode;
  updatePlanAModeSections(mode);

  els.geminiApiKey.value = settings.geminiApiKey || '';
  els.planAModel.value = settings.planAModel || PLAN_A_MODELS[0].id;
  els.customBaseUrl.value = settings.customBaseUrl || 'http://localhost:11434/v1/chat/completions';
  els.customModel.value = settings.customModel || 'qwen2.5:7b';
  els.customApiKey.value = settings.customApiKey || '';
  els.deepseekApiKey.value = settings.deepseekApiKey || '';
  els.planBModel.value = settings.planBModel || PLAN_B_MODELS[0].id;
  els.maxSteps.value = settings.maxSteps || 20;
  els.useDebuggerFallback.checked = Boolean(settings.useDebuggerFallback);
  els.userMemory.value = settings.userMemory || '';
  applyTheme(settings.theme || 'dark');
  applySafetyModeUI(settings.safetyMode || 'ask');
}

function collectFormSettings() {
  return {
    planAMode: els.planAMode.value,
    geminiApiKey: els.geminiApiKey.value.trim(),
    planAModel: els.planAModel.value,
    customBaseUrl: els.customBaseUrl.value.trim(),
    customModel: els.customModel.value.trim() || 'qwen2.5:7b',
    customApiKey: els.customApiKey.value.trim(),
    deepseekApiKey: els.deepseekApiKey.value.trim(),
    planBModel: els.planBModel.value,
    maxSteps: Math.max(3, Math.min(Number(els.maxSteps.value) || 20, 40)),
    useDebuggerFallback: els.useDebuggerFallback.checked,
    userMemory: els.userMemory.value
  };
}

function showToast(message) {
  els.settingsToast.textContent = message;
  els.settingsToast.classList.remove('hidden');
  setTimeout(() => {
    els.settingsToast.classList.add('hidden');
  }, 2600);
}

function formatProviderMeta(provider, model) {
  if (provider === 'deepseek') {
    return {
      badgeClass: 'plan-b',
      label: `Plan B: DeepSeek${model ? ` (${model})` : ''}`,
      miniLabel: 'Plan B: DeepSeek'
    };
  }
  if (provider === 'chrome-nano') {
    return {
      badgeClass: 'plan-nano',
      label: 'Zero-Key Trial: Chrome Gemini Nano',
      miniLabel: 'Chrome Nano'
    };
  }
  if (provider === 'custom-openai') {
    return {
      badgeClass: 'plan-custom',
      label: `Custom/Local${model ? ` (${model})` : ''}`,
      miniLabel: 'Custom/Local'
    };
  }
  return {
    badgeClass: 'plan-a',
    label: `Plan A: Gemini${model ? ` (${model})` : ''}`,
    miniLabel: 'Plan A: Gemini'
  };
}

function renderState(state) {
  if (!state) return;
  currentState = state;

  const meta = formatProviderMeta(state.activeProvider, state.activeModel);
  els.engineBadge.className = `engine-badge ${meta.badgeClass}`;
  els.engineBadgeText.textContent = meta.label;

  const statusLabels = {
    idle: 'Idle',
    running: 'Running',
    paused: 'Paused',
    awaiting_approval: 'Awaiting Approval',
    completed: 'Completed',
    stopped: 'Stopped',
    error: 'Error'
  };
  els.statusPill.textContent = statusLabels[state.status] || state.status;
  els.statusPill.className = `status-pill status-${state.status}`;

  els.stepCounter.textContent = `Step ${state.step || 0} / ${state.maxSteps || currentSettings?.maxSteps || 20}`;

  if (state.failoverBanner) {
    els.failoverBannerText.textContent = state.failoverBanner;
    els.failoverBanner.classList.remove('hidden');
  } else {
    els.failoverBanner.classList.add('hidden');
  }

  const activeRun = ['running', 'paused', 'awaiting_approval'].includes(state.status);
  els.runBtn.disabled = activeRun;
  els.pauseBtn.classList.toggle('hidden', !activeRun || state.status === 'awaiting_approval');
  els.stopBtn.classList.toggle('hidden', !activeRun);
  els.pauseBtn.textContent = state.status === 'paused' ? '▶ Resume' : '⏸ Pause';

  if (state.status === 'awaiting_approval' && state.pendingApproval) {
    const p = state.pendingApproval;
    els.approvalStep.textContent = `Step ${p.step}`;
    els.approvalRule.textContent = p.matchedRule || 'High-risk action detected';
    els.approvalTarget.textContent = p.targetSummary || JSON.stringify(p.toolCall);
    els.approvalThought.textContent = p.thought ? `Agent reasoning: ${p.thought}` : '';
    els.approvalCard.classList.remove('hidden');
  } else {
    els.approvalCard.classList.add('hidden');
  }

  renderLogs(state.logs || []);
}

function renderLogs(logs) {
  if (!logs.length) {
    els.logFeed.innerHTML = `
      <div class="empty-state">
        <p><strong>Zero-Key Trial Ready.</strong></p>
        <p>Open <strong>⚙️ Settings</strong> to choose <strong>Chrome Built-in Gemini Nano</strong> (no API key), a <strong>Custom/Local Endpoint</strong> (Ollama / Groq / OpenRouter), or add your <strong>Gemini &amp; DeepSeek</strong> keys, then run the <strong>Dry-Run Test</strong>.</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of logs) {
    const item = document.createElement('article');
    item.className = `log-item level-${entry.level || 'info'}`;

    const head = document.createElement('div');
    head.className = 'log-item-head';

    const title = document.createElement('span');
    title.className = 'log-title';
    title.textContent = entry.title || 'Event';

    const tags = document.createElement('div');
    tags.className = 'log-tags';

    if (entry.provider) {
      const meta = formatProviderMeta(entry.provider, '');
      const pTag = document.createElement('span');
      pTag.className = `mini-provider ${entry.provider}`;
      pTag.textContent = meta.miniLabel;
      tags.appendChild(pTag);
    }

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = entry.time || '';
    tags.appendChild(time);

    head.appendChild(title);
    head.appendChild(tags);
    item.appendChild(head);

    if (entry.detail) {
      const detail = document.createElement('p');
      detail.className = 'log-detail';
      detail.textContent = entry.detail;
      item.appendChild(detail);
    }

    fragment.appendChild(item);
  }

  els.logFeed.innerHTML = '';
  els.logFeed.appendChild(fragment);
  els.logFeed.scrollTop = els.logFeed.scrollHeight;
}

function renderDiagnostics(report) {
  els.diagnosticsBox.classList.remove('hidden');
  els.diagnosticsResults.innerHTML = '';

  const rows = [
    {
      label: 'Zero-Key Trial: Chrome Built-in Gemini Nano',
      status: report.chromeNano?.available ? 'pass' : report.planAMode === 'chrome-nano' ? 'fail' : 'skip',
      badge: report.chromeNano?.available ? report.chromeNano.state.toUpperCase() : 'UNAVAILABLE',
      detail: report.chromeNano?.message || 'Not detected'
    },
    {
      label: `Plan A: Gemini Cloud (${els.planAModel.value})`,
      status: report.gemini.skipped ? 'skip' : report.gemini.ok ? 'pass' : 'fail',
      badge: report.gemini.skipped
        ? 'SKIPPED'
        : report.gemini.ok
          ? `PASS · ${report.gemini.latencyMs}ms`
          : `FAIL (${report.gemini.status || 'ERR'})`,
      detail: report.gemini.message
    }
  ];

  if (report.planAMode === 'custom-openai' && report.customEndpoint) {
    rows.push({
      label: `Custom / Local (${els.customModel.value || 'custom'})`,
      status: report.customEndpoint.skipped ? 'skip' : report.customEndpoint.ok ? 'pass' : 'fail',
      badge: report.customEndpoint.ok
        ? `PASS · ${report.customEndpoint.latencyMs}ms`
        : `FAIL (${report.customEndpoint.status || 'ERR'})`,
      detail: report.customEndpoint.message
    });
  }

  rows.push(
    {
      label: `Plan B: DeepSeek (${els.planBModel.value})`,
      status: report.deepseek.skipped ? 'skip' : report.deepseek.ok ? 'pass' : 'fail',
      badge: report.deepseek.skipped
        ? 'SKIPPED'
        : report.deepseek.ok
          ? `PASS · ${report.deepseek.latencyMs}ms`
          : `FAIL (${report.deepseek.status || 'ERR'})`,
      detail: report.deepseek.message
    },
    {
      label: 'Active Tab DOM Indexing',
      status: report.domCheck.ok ? 'pass' : 'fail',
      badge: report.domCheck.ok ? `PASS · ${report.domCheck.count} els` : 'CHECK TAB',
      detail:
        report.domCheck.message +
        (report.domCheck.sample?.length ? `\nSample: ${report.domCheck.sample.join(' | ')}` : '')
    }
  );

  for (const row of rows) {
    const div = document.createElement('div');
    div.className = `diag-row ${row.status}`;

    const head = document.createElement('div');
    head.className = 'diag-title';
    const left = document.createElement('span');
    left.textContent = row.label;
    const right = document.createElement('span');
    right.textContent = row.badge;
    head.appendChild(left);
    head.appendChild(right);

    const body = document.createElement('div');
    body.className = 'diag-detail';
    body.textContent = row.detail;

    div.appendChild(head);
    div.appendChild(body);
    els.diagnosticsResults.appendChild(div);
  }
}

async function handleRunTask() {
  const prompt = els.taskInput.value.trim();
  if (!prompt) {
    els.taskInput.focus();
    return;
  }
  await sendBg('START_TASK', { prompt });
}

function bindEvents() {
  els.themeToggleBtn.addEventListener('click', async () => {
    const nextTheme = els.html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    await sendBg('SAVE_SETTINGS', { theme: nextTheme });
  });

  els.settingsToggleBtn.addEventListener('click', () => {
    els.settingsDrawer.classList.remove('hidden');
  });
  els.closeSettingsBtn.addEventListener('click', () => {
    els.settingsDrawer.classList.add('hidden');
  });

  els.planAMode.addEventListener('change', () => {
    updatePlanAModeSections(els.planAMode.value);
  });

  els.presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const preset = CUSTOM_ENDPOINT_PRESETS[chip.dataset.preset];
      if (!preset) return;
      els.customBaseUrl.value = preset.baseUrl;
      els.customModel.value = preset.model;
      showToast(`Applied preset: ${preset.name}`);
    });
  });

  document.querySelectorAll('.reveal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  [els.modeAskBtn, els.modeAutoBtn].forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      applySafetyModeUI(mode);
      const res = await sendBg('SAVE_SETTINGS', { safetyMode: mode });
      if (res?.settings) currentSettings = res.settings;
    });
  });

  els.shortcutChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const cmd = chip.dataset.command;
      const existing = els.taskInput.value.trim();
      if (!existing || existing.startsWith('/')) {
        els.taskInput.value = `${cmd} `;
      } else {
        els.taskInput.value = `${cmd} ${existing}`;
      }
      els.taskInput.focus();
      els.taskInput.setSelectionRange(els.taskInput.value.length, els.taskInput.value.length);
    });
  });

  els.runBtn.addEventListener('click', handleRunTask);
  els.taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!els.runBtn.disabled) handleRunTask();
    }
  });

  els.pauseBtn.addEventListener('click', () => sendBg('TOGGLE_PAUSE'));
  els.stopBtn.addEventListener('click', () => sendBg('STOP_TASK'));
  els.clearLogBtn.addEventListener('click', () => sendBg('CLEAR_LOGS'));

  els.approveBtn.addEventListener('click', () => sendBg('RESOLVE_APPROVAL', { decision: 'approve' }));
  els.skipBtn.addEventListener('click', () => sendBg('RESOLVE_APPROVAL', { decision: 'skip' }));
  els.denyStopBtn.addEventListener('click', () => sendBg('RESOLVE_APPROVAL', { decision: 'stop' }));

  els.saveSettingsBtn.addEventListener('click', async () => {
    const payload = collectFormSettings();
    const res = await sendBg('SAVE_SETTINGS', payload);
    if (res?.ok) {
      applySettingsToForm(res.settings);
      showToast('Settings & Persona Memory saved.');
    }
  });

  els.dryRunBtn.addEventListener('click', async () => {
    const payload = collectFormSettings();
    els.dryRunBtn.disabled = true;
    els.dryRunBtn.textContent = 'Testing...';
    els.diagnosticsBox.classList.remove('hidden');
    els.diagnosticsResults.innerHTML =
      '<div class="diag-row">Checking Chrome Gemini Nano, API providers, and active tab DOM indexing...</div>';
    try {
      const report = await sendBg('RUN_DIAGNOSTICS', payload);
      if (report?.ok) {
        renderDiagnostics(report);
      } else {
        els.diagnosticsResults.innerHTML = `<div class="diag-row fail">Diagnostic error: ${report?.error || 'Unknown'}</div>`;
      }
    } catch (err) {
      els.diagnosticsResults.innerHTML = `<div class="diag-row fail">Diagnostic error: ${err.message}</div>`;
    } finally {
      els.dryRunBtn.disabled = false;
      els.dryRunBtn.textContent = '🧪 Dry-Run / Mock Test';
    }
  });

  // Live background updates + Side Panel bridge for Chrome Built-in Gemini Nano (window.LanguageModel)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'STATE_UPDATE') {
      renderState(message.payload);
      return false;
    }

    if (message?.type === 'SIDEPANEL_CHECK_NANO') {
      checkLocalNanoAvailability()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ available: false, state: 'error', message: err.message }));
      return true;
    }

    if (message?.type === 'SIDEPANEL_RUN_NANO') {
      runLocalNanoPrompt(message.payload || {})
        .then((text) => sendResponse({ ok: true, text }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    return false;
  });
}

async function init() {
  populateSelects();
  bindEvents();

  const [settingsRes, stateRes] = await Promise.all([
    sendBg('GET_SETTINGS'),
    sendBg('GET_STATE')
  ]);

  if (settingsRes?.ok) {
    applySettingsToForm(settingsRes.settings);
  }
  if (stateRes?.ok) {
    renderState(stateRes.state);
  }
}

init();
