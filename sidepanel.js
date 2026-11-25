/**
 * Argon-DeepSeek Autonomous Browser Agent
 * Side Panel UI Controller
 */

import { PLAN_A_MODELS, PLAN_B_MODELS } from './lib/config.js';

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

  geminiApiKey: document.getElementById('geminiApiKey'),
  planAModel: document.getElementById('planAModel'),
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

function populateModelSelects() {
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
  els.geminiApiKey.value = settings.geminiApiKey || '';
  els.planAModel.value = settings.planAModel || PLAN_A_MODELS[0].id;
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
    geminiApiKey: els.geminiApiKey.value.trim(),
    planAModel: els.planAModel.value,
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

function renderState(state) {
  if (!state) return;
  currentState = state;

  // Engine Badge
  const isDeepSeek = state.activeProvider === 'deepseek';
  els.engineBadge.className = `engine-badge ${isDeepSeek ? 'plan-b' : 'plan-a'}`;
  els.engineBadgeText.textContent = isDeepSeek
    ? `Plan B: DeepSeek${state.activeModel ? ` (${state.activeModel})` : ''}`
    : `Plan A: Gemini${state.activeModel ? ` (${state.activeModel})` : ''}`;

  // Status Pill
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

  // Step counter
  els.stepCounter.textContent = `Step ${state.step || 0} / ${state.maxSteps || currentSettings?.maxSteps || 20}`;

  // Failover Banner
  if (state.failoverBanner) {
    els.failoverBannerText.textContent = state.failoverBanner;
    els.failoverBanner.classList.remove('hidden');
  } else {
    els.failoverBanner.classList.add('hidden');
  }

  // Controls visibility
  const activeRun = ['running', 'paused', 'awaiting_approval'].includes(state.status);
  els.runBtn.disabled = activeRun;
  els.pauseBtn.classList.toggle('hidden', !activeRun || state.status === 'awaiting_approval');
  els.stopBtn.classList.toggle('hidden', !activeRun);
  els.pauseBtn.textContent = state.status === 'paused' ? '▶ Resume' : '⏸ Pause';

  // Human-in-the-Loop Confirmation Card
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

  // Logs Feed
  renderLogs(state.logs || []);
}

function renderLogs(logs) {
  if (!logs.length) {
    els.logFeed.innerHTML = `
      <div class="empty-state">
        <p><strong>Ready to operate.</strong></p>
        <p>Add your Gemini (Plan A) and DeepSeek (Plan B) API keys in <strong>⚙️ Settings</strong>, run the <strong>Dry-Run Test</strong>, then start a task.</p>
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

    if (entry.provider === 'gemini' || entry.provider === 'deepseek') {
      const pTag = document.createElement('span');
      pTag.className = `mini-provider ${entry.provider}`;
      pTag.textContent = entry.provider === 'gemini' ? 'Plan A: Gemini' : 'Plan B: DeepSeek';
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
      label: `Plan A: Gemini (${els.planAModel.value})`,
      status: report.gemini.skipped ? 'skip' : report.gemini.ok ? 'pass' : 'fail',
      badge: report.gemini.skipped
        ? 'SKIPPED'
        : report.gemini.ok
          ? `PASS · ${report.gemini.latencyMs}ms`
          : `FAIL (${report.gemini.status || 'ERR'})`,
      detail: report.gemini.message
    },
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
  ];

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
  // Theme toggle
  els.themeToggleBtn.addEventListener('click', async () => {
    const nextTheme = els.html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    await sendBg('SAVE_SETTINGS', { theme: nextTheme });
  });

  // Settings drawer open/close
  els.settingsToggleBtn.addEventListener('click', () => {
    els.settingsDrawer.classList.remove('hidden');
  });
  els.closeSettingsBtn.addEventListener('click', () => {
    els.settingsDrawer.classList.add('hidden');
  });

  // Reveal API key buttons
  document.querySelectorAll('.reveal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // Safety mode toggle
  [els.modeAskBtn, els.modeAutoBtn].forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      applySafetyModeUI(mode);
      const res = await sendBg('SAVE_SETTINGS', { safetyMode: mode });
      if (res?.settings) currentSettings = res.settings;
    });
  });

  // Slash shortcut chips
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

  // Task execution controls
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

  // Safety confirmation card actions
  els.approveBtn.addEventListener('click', () => sendBg('RESOLVE_APPROVAL', { decision: 'approve' }));
  els.skipBtn.addEventListener('click', () => sendBg('RESOLVE_APPROVAL', { decision: 'skip' }));
  els.denyStopBtn.addEventListener('click', () => sendBg('RESOLVE_APPROVAL', { decision: 'stop' }));

  // Settings save
  els.saveSettingsBtn.addEventListener('click', async () => {
    const payload = collectFormSettings();
    const res = await sendBg('SAVE_SETTINGS', payload);
    if (res?.ok) {
      applySettingsToForm(res.settings);
      showToast('Settings & Persona Memory saved.');
    }
  });

  // Built-in Dry-Run / Mock Test
  els.dryRunBtn.addEventListener('click', async () => {
    const payload = collectFormSettings();
    els.dryRunBtn.disabled = true;
    els.dryRunBtn.textContent = 'Testing...';
    els.diagnosticsBox.classList.remove('hidden');
    els.diagnosticsResults.innerHTML = '<div class="diag-row">Running Gemini, DeepSeek, and active tab DOM checks...</div>';
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

  // Live background state push updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'STATE_UPDATE') {
      renderState(message.payload);
    }
  });
}

async function init() {
  populateModelSelects();
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
