/**
 * Argon-DeepSeek Autonomous Browser Agent
 * Shared configuration, model catalogs, slash shortcuts, and chrome.storage helpers.
 */

export const PLAN_A_MODELS = [
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen (Free-Tier Fast Vision + DOM)',
    tier: 'free'
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash (Free-Tier Multimodal Stable)',
    tier: 'free'
  },
  {
    id: 'gemini-4-argon',
    label: 'Gemini 4 Argon (Balanced Operator)',
    tier: 'standard'
  },
  {
    id: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon (Deep Planning)',
    tier: 'pro'
  }
];

export const PLAN_B_MODELS = [
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat (Fast DOM Navigation & Tools)',
    tier: 'fast'
  },
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner (Multi-Step Planning)',
    tier: 'reasoning'
  }
];

export const DEFAULT_SETTINGS = {
  geminiApiKey: '',
  deepseekApiKey: '',
  planAModel: 'gemini-2.5-flash',
  planBModel: 'deepseek-chat',
  safetyMode: 'ask', // 'ask' (Ask Before Submitting) | 'auto' (Full Auto)
  maxSteps: 20,
  requestTimeoutMs: 30000,
  useDebuggerFallback: false,
  theme: 'dark', // 'dark' | 'light'
  userMemory: ''
};

export const SLASH_SHORTCUTS = {
  '/linkedin-replies': {
    command: '/linkedin-replies',
    title: 'LinkedIn Replies',
    description: 'Draft replies to unanswered comments on the current post and pause before posting',
    prompt:
      'Inspect the current LinkedIn post and its visible comments. Identify comments that have not been replied to yet. ' +
      'Using my saved User Profile / Persona Memory for tone and voice, open the reply composer for an unanswered comment ' +
      'and draft a concise, authentic, value-adding reply. Do NOT click the final Post/Reply submit button without confirmation ' +
      '(if Ask Before Submitting is active, let the safety gate pause for review).'
  },
  '/research-and-gmail': {
    command: '/research-and-gmail',
    title: 'Research & Gmail',
    description: 'Research the current page/company and draft an outreach email in Gmail',
    prompt:
      'Extract the key information about the person, product, or company on the current webpage (value proposition, recent news, ' +
      'contact email if visible). Then open Gmail compose (https://mail.google.com/mail/u/0/#inbox?compose=new) or switch to an ' +
      'open Gmail tab, start a new email, fill in the Subject and Body with a personalized outreach draft reflecting my saved ' +
      'User Profile / Persona Memory, and pause before clicking Send so I can review it.'
  },
  '/fill-application': {
    command: '/fill-application',
    title: 'Fill Application',
    description: 'Populate visible form fields using saved User Profile memory',
    prompt:
      'Scan all visible form inputs, textareas, selects, and contenteditable fields on the current page. Map each field ' +
      'accurately to the details in my saved User Profile / Persona Memory (name, email, phone, LinkedIn, website, company, bio, etc.). ' +
      'Populate the fields carefully without inventing missing sensitive details, scroll if needed to check remaining fields, ' +
      'and stop or trigger the safety gate before clicking Submit or Apply.'
  }
};

export const STORAGE_KEYS = {
  SETTINGS: 'argon_deepseek_settings',
  LAST_STATE: 'argon_deepseek_last_state'
};

/**
 * Load merged settings from chrome.storage.local.
 */
export async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.SETTINGS] || {})
  };
}

/**
 * Persist partial or full settings updates to chrome.storage.local.
 */
export async function saveSettings(partial) {
  const current = await loadSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

/**
 * Expand a leading slash shortcut into a rich task prompt while preserving any extra user instructions.
 */
export function expandSlashCommand(rawInput) {
  const trimmed = (rawInput || '').trim();
  if (!trimmed.startsWith('/')) {
    return { expandedPrompt: trimmed, shortcutUsed: null };
  }

  const firstSpace = trimmed.indexOf(' ');
  const cmd = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
  const extra = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();
  const shortcut = SLASH_SHORTCUTS[cmd];

  if (!shortcut) {
    return { expandedPrompt: trimmed, shortcutUsed: null };
  }

  const expandedPrompt = extra
    ? `${shortcut.prompt}\n\nAdditional user instructions: ${extra}`
    : shortcut.prompt;

  return {
    expandedPrompt,
    shortcutUsed: shortcut.command
  };
}
