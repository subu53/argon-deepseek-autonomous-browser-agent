/**
 * Dual-Provider + Zero-Key Trial LLM Client & Auto-Failover Engine
 *
 * Plan A Modes:
 * - 'chrome-nano'   : Zero-Key Trial — Chrome Built-in Gemini Nano (On-Device Prompt API)
 * - 'gemini-api'    : Google Gemini Cloud API (Vision + Interactive DOM Map + Function Calling)
 * - 'custom-openai' : Custom / Local OpenAI-Compatible Endpoint (Ollama, LM Studio, OpenRouter, Groq)
 *
 * Plan B (Automatic Failsafe):
 * - 'deepseek'      : DeepSeek API (`deepseek-chat` / `deepseek-reasoner`)
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export class ProviderError extends Error {
  constructor(message, { provider, status = 0, code = 'UNKNOWN', failoverEligible = false, details = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.failoverEligible = failoverEligible;
    this.details = details;
  }
}

/**
 * Canonical browser operator tool definitions.
 */
export const AGENT_TOOLS = [
  {
    name: 'click',
    description:
      'Click an interactive element on the current page identified by its numeric agent_id from the Interactive DOM Map.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'integer',
          description: 'The numeric data-agent-id of the element to click.'
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why you are clicking this element.'
        }
      },
      required: ['agent_id', 'reason']
    }
  },
  {
    name: 'type',
    description:
      'Type text into an input, textarea, or contenteditable element (e.g. LinkedIn comment box or Gmail compose body).',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'integer',
          description: 'The numeric data-agent-id of the editable element.'
        },
        text: {
          type: 'string',
          description: 'The exact text to enter into the element.'
        },
        clear_first: {
          type: 'boolean',
          description: 'Whether to clear existing text before typing. Defaults to true.'
        },
        press_enter: {
          type: 'boolean',
          description: 'Whether to press Enter after typing. Defaults to false.'
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of what field is being populated.'
        }
      },
      required: ['agent_id', 'text', 'reason']
    }
  },
  {
    name: 'select_option',
    description: 'Select an option in a native HTML <select> dropdown by visible text or option value.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'integer',
          description: 'The numeric data-agent-id of the <select> element.'
        },
        value: {
          type: 'string',
          description: 'The option label or value to select.'
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of this selection.'
        }
      },
      required: ['agent_id', 'value', 'reason']
    }
  },
  {
    name: 'scroll',
    description: 'Scroll the page or a scrollable container vertically to reveal more content or elements.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['down', 'up', 'top', 'bottom'],
          description: 'Direction to scroll.'
        },
        amount: {
          type: 'integer',
          description: 'Pixels to scroll (e.g. 600). Ignored for top/bottom.'
        },
        agent_id: {
          type: 'integer',
          description: 'Optional agent_id of a specific scrollable container.'
        },
        reason: {
          type: 'string',
          description: 'Why scrolling is needed.'
        }
      },
      required: ['direction', 'reason']
    }
  },
  {
    name: 'open_tab',
    description: 'Open a new browser tab at a specified URL (e.g. Gmail compose or a company research URL).',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full https:// URL to open.'
        },
        active: {
          type: 'boolean',
          description: 'Whether to focus the newly opened tab. Defaults to true.'
        },
        reason: {
          type: 'string',
          description: 'Why this tab is being opened.'
        }
      },
      required: ['url', 'reason']
    }
  },
  {
    name: 'switch_tab',
    description: 'Switch focus to an already open Chrome tab using its numeric tab_id from the Open Tabs list.',
    parameters: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'integer',
          description: 'Numeric Chrome tab ID from the Open Tabs list.'
        },
        reason: {
          type: 'string',
          description: 'Why switching to this tab is needed.'
        }
      },
      required: ['tab_id', 'reason']
    }
  },
  {
    name: 'extract_page_text',
    description:
      'Extract clean readable text from the active webpage (useful for researching a company, reading an article, or inspecting LinkedIn comments in full).',
    parameters: {
      type: 'object',
      properties: {
        max_chars: {
          type: 'integer',
          description: 'Maximum characters to return (default 6000, max 12000).'
        },
        reason: {
          type: 'string',
          description: 'What information you are looking for on this page.'
        }
      },
      required: ['reason']
    }
  },
  {
    name: 'wait',
    description: 'Wait briefly for dynamic SPA content, network requests, or modals to finish rendering.',
    parameters: {
      type: 'object',
      properties: {
        ms: {
          type: 'integer',
          description: 'Milliseconds to wait (between 500 and 5000).'
        },
        reason: {
          type: 'string',
          description: 'What you are waiting for.'
        }
      },
      required: ['ms', 'reason']
    }
  },
  {
    name: 'finish',
    description:
      'Complete the task and report the final result to the user. Use this once the goal is achieved or if a manual blocker prevents progress.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Clear, concise summary of what was accomplished or why the task stopped.'
        },
        status: {
          type: 'string',
          enum: ['completed', 'needs_user_input', 'blocked'],
          description: 'Outcome status.'
        }
      },
      required: ['summary', 'status']
    }
  }
];

/**
 * Build the shared system prompt for the autonomous ReAct browser operator.
 */
export function buildSystemPrompt({ userMemory, safetyMode, providerLabel, compactJsonMode = false }) {
  const memorySection =
    userMemory && userMemory.trim()
      ? `\n\n### Saved User Profile / Persona Memory\nUse these facts and tone preferences when filling forms, writing LinkedIn replies, or drafting Gmail outreach:\n${userMemory.trim()}`
      : '\n\n### Saved User Profile / Persona Memory\n(No user profile memory saved yet. Do not invent sensitive personal data like phone numbers or addresses.)';

  const safetyNote =
    safetyMode === 'auto'
      ? 'Safety Mode: FULL AUTO. Execute steps efficiently while avoiding destructive mistakes.'
      : 'Safety Mode: ASK BEFORE SUBMITTING. Before clicking high-risk buttons (Submit, Send, Post, Apply, Delete, Pay, Confirm), the extension will automatically pause and ask the user for approval.';

  const lines = [
    `You are Argon-DeepSeek Autonomous Browser Agent (running on ${providerLabel}).`,
    'You operate a live Chrome browser step-by-step using a ReAct loop: Observe -> Think -> Act -> Verify.',
    '',
    '### Operating Rules',
    '1. Emit EXACTLY ONE tool call per turn.',
    '2. Refer to webpage elements strictly by their numeric `agent_id` from the Interactive DOM Map.',
    '3. Never guess an `agent_id` not present in the DOM Map. Scroll if you need more elements.',
    '4. On modern SPAs (LinkedIn, Gmail, React, Ember), wait briefly or re-observe after opening modals/composers before typing.',
    '5. Call `extract_page_text` if you need full body copy to research a page or read comments.',
    '6. Call `finish` as soon as the user objective is satisfied.',
    `7. ${safetyNote}`
  ];

  if (compactJsonMode) {
    lines.push(
      '',
      '### REQUIRED OUTPUT FORMAT (Strict JSON Only)',
      'Respond with ONLY a single JSON object (no markdown prose around it):',
      '{"thought":"short reasoning","tool":"click|type|select_option|scroll|open_tab|switch_tab|extract_page_text|wait|finish","args":{...}}',
      'Tool args schemas:',
      '- click: {"agent_id": 1, "reason": "..."}',
      '- type: {"agent_id": 2, "text": "...", "clear_first": true, "press_enter": false, "reason": "..."}',
      '- select_option: {"agent_id": 3, "value": "...", "reason": "..."}',
      '- scroll: {"direction": "down|up|top|bottom", "amount": 600, "reason": "..."}',
      '- open_tab: {"url": "https://...", "active": true, "reason": "..."}',
      '- switch_tab: {"tab_id": 123, "reason": "..."}',
      '- extract_page_text: {"max_chars": 4000, "reason": "..."}',
      '- wait: {"ms": 1500, "reason": "..."}',
      '- finish: {"summary": "...", "status": "completed|needs_user_input|blocked"}'
    );
  }

  lines.push(memorySection);
  return lines.join('\n');
}

/**
 * Format the current browser observation into a compact, token-efficient prompt payload.
 */
export function formatObservationPrompt({ goal, step, maxSteps, observation, history, compact = false }) {
  const sections = [];
  sections.push(`## User Objective\n${goal}`);
  sections.push(`## Step\n${step} of ${maxSteps}`);

  if (observation?.activeTab) {
    sections.push(
      `## Active Tab\n- Tab ID: ${observation.activeTab.id}\n- Title: ${observation.activeTab.title || '(untitled)'}\n- URL: ${observation.activeTab.url || '(unknown)'}`
    );
  }

  const maxTabs = compact ? 6 : 20;
  if (Array.isArray(observation?.tabs) && observation.tabs.length > 0) {
    const tabLines = observation.tabs
      .slice(0, maxTabs)
      .map(
        (t) =>
          `  - [${t.id}]${t.active ? ' (ACTIVE)' : ''} ${truncate(t.title || 'Untitled', 50)} | ${truncate(t.url || '', 75)}`
      );
    sections.push(`## Open Tabs (${observation.tabs.length})\n${tabLines.join('\n')}`);
  }

  if (observation?.pageMeta) {
    const m = observation.pageMeta;
    sections.push(
      `## Viewport & Scroll\nViewport: ${m.viewportWidth}x${m.viewportHeight} | ScrollY: ${m.scrollY}/${m.scrollHeight} | Visible Interactive Elements: ${observation.domMap?.length || 0}`
    );
  }

  if (observation?.domError) {
    sections.push(`## Page DOM Notice\n${observation.domError}`);
  }

  const domLimit = compact ? 45 : 160;
  if (Array.isArray(observation?.domMap) && observation.domMap.length > 0) {
    const domLines = observation.domMap.slice(0, domLimit).map(formatDomElementLine);
    sections.push(`## Interactive DOM Map\n${domLines.join('\n')}`);
  } else {
    sections.push(
      '## Interactive DOM Map\n(No interactive elements indexed on this page yet. You may open_tab, switch_tab, scroll, or wait.)'
    );
  }

  const historyLimit = compact ? 4 : 8;
  if (Array.isArray(history) && history.length > 0) {
    const recent = history.slice(-historyLimit);
    const traceLines = recent.map((h) => {
      const actionStr = h.toolCall ? `${h.toolCall.name}(${JSON.stringify(h.toolCall.args)})` : 'none';
      const resultStr = truncate(typeof h.result === 'string' ? h.result : JSON.stringify(h.result), compact ? 220 : 500);
      return `Step ${h.step} [${h.provider}]: Thought="${truncate(h.thought || '', 120)}" -> Action=${actionStr} -> Result=${resultStr}`;
    });
    sections.push(`## Execution Trace (Recent Steps)\n${traceLines.join('\n')}`);
  }

  sections.push(
    compact
      ? '## Next Action\nReply ONLY with one JSON object {"thought":"...","tool":"...","args":{...}}.'
      : '## Next Action\nDecide the single best next tool call to advance the User Objective. Explain your reasoning concisely and invoke one tool.'
  );

  return sections.join('\n\n');
}

function formatDomElementLine(el) {
  const parts = [`[#${el.id}]`, `<${el.tag}>`];
  if (el.role) parts.push(`role=${el.role}`);
  if (el.inputType) parts.push(`type=${el.inputType}`);
  if (el.contentEditable) parts.push('editable');
  if (el.inViewport === false) parts.push('offscreen');
  if (el.disabled) parts.push('disabled');

  const desc = [];
  if (el.text) desc.push(`text="${truncate(el.text, 65)}"`);
  if (el.ariaLabel && el.ariaLabel !== el.text) desc.push(`aria="${truncate(el.ariaLabel, 55)}"`);
  if (el.placeholder) desc.push(`placeholder="${truncate(el.placeholder, 45)}"`);
  if (el.value) desc.push(`value="${truncate(el.value, 45)}"`);
  if (el.href) desc.push(`href="${truncate(el.href, 55)}"`);

  return `${parts.join(' ')} ${desc.join(' ')}`.trim();
}

function toGeminiTools() {
  const mapSchema = (schema) => {
    const out = {};
    if (schema.type) out.type = schema.type.toUpperCase();
    if (schema.description) out.description = schema.description;
    if (schema.enum) out.enum = schema.enum;
    if (schema.properties) {
      out.properties = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        out.properties[k] = mapSchema(v);
      }
    }
    if (schema.required) out.required = schema.required;
    return out;
  };

  return [
    {
      functionDeclarations: AGENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: mapSchema(tool.parameters)
      }))
    }
  ];
}

function toOpenAITools() {
  return AGENT_TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new ProviderError(`Request timed out after ${timeoutMs}ms`, {
        provider: 'unknown',
        status: 408,
        code: 'TIMEOUT',
        failoverEligible: true
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plan A (Cloud): Google Gemini API (Vision + DOM + Function Calling).
 */
export async function callGemini({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  screenshotBase64,
  timeoutMs = 30000
}) {
  if (!apiKey) {
    throw new ProviderError('Gemini API key is not configured.', {
      provider: 'gemini',
      status: 401,
      code: 'MISSING_KEY',
      failoverEligible: true
    });
  }

  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: userPrompt }];
  if (screenshotBase64) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: screenshotBase64
      }
    });
  }

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts }],
    tools: toGeminiTools(),
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
  };

  let res;
  try {
    res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      timeoutMs
    );
  } catch (err) {
    if (err instanceof ProviderError) {
      err.provider = 'gemini';
      throw err;
    }
    throw new ProviderError(`Gemini network error: ${err.message}`, {
      provider: 'gemini',
      status: 0,
      code: 'NETWORK_ERROR',
      failoverEligible: true
    });
  }

  const rawText = await res.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errMsg = data?.error?.message || rawText.slice(0, 240) || `HTTP ${res.status}`;
    const failoverEligible = [403, 408, 429, 500, 502, 503, 504].includes(res.status);
    throw new ProviderError(`Gemini API error (${res.status}): ${errMsg}`, {
      provider: 'gemini',
      status: res.status,
      code: data?.error?.status || `HTTP_${res.status}`,
      failoverEligible,
      details: errMsg
    });
  }

  const respParts = data?.candidates?.[0]?.content?.parts || [];
  let thought = '';
  let toolCall = null;

  for (const part of respParts) {
    if (part.text) thought += (thought ? '\n' : '') + part.text.trim();
    if (part.functionCall && !toolCall) {
      toolCall = { name: part.functionCall.name, args: part.functionCall.args || {} };
    }
  }

  if (!toolCall && thought) {
    const extracted = extractJsonToolCall(thought);
    if (extracted) {
      toolCall = extracted.toolCall;
      thought = extracted.thought || thought;
    } else {
      toolCall = { name: 'finish', args: { summary: thought, status: 'completed' } };
    }
  }

  if (!toolCall) {
    throw new ProviderError('Gemini returned an empty response with no tool call.', {
      provider: 'gemini',
      status: 502,
      code: 'EMPTY_RESPONSE',
      failoverEligible: true
    });
  }

  return {
    provider: 'gemini',
    model,
    thought: thought || toolCall.args?.reason || `Executing ${toolCall.name}`,
    toolCall
  };
}

/**
 * Plan A (Zero-Key Trial): Chrome Built-in Gemini Nano (On-Device Prompt API).
 */
export async function callChromeNano({ nanoRunner, systemPrompt, userPrompt }) {
  if (typeof nanoRunner !== 'function') {
    throw new ProviderError('Chrome Built-in Gemini Nano runner is unavailable.', {
      provider: 'chrome-nano',
      status: 503,
      code: 'NANO_UNAVAILABLE',
      failoverEligible: true
    });
  }

  let rawOutput = '';
  try {
    rawOutput = await nanoRunner({ systemPrompt, userPrompt });
  } catch (err) {
    throw new ProviderError(`Chrome Gemini Nano error: ${err.message}`, {
      provider: 'chrome-nano',
      status: 503,
      code: 'NANO_ERROR',
      failoverEligible: true,
      details: err.message
    });
  }

  const extracted = extractJsonToolCall(rawOutput);
  if (extracted) {
    return {
      provider: 'chrome-nano',
      model: 'gemini-nano (on-device)',
      thought: extracted.thought || extracted.toolCall.args?.reason || `Executing ${extracted.toolCall.name}`,
      toolCall: extracted.toolCall
    };
  }

  return {
    provider: 'chrome-nano',
    model: 'gemini-nano (on-device)',
    thought: rawOutput || 'Completed step on Gemini Nano.',
    toolCall: {
      name: 'finish',
      args: {
        summary: rawOutput || 'Chrome Gemini Nano returned no structured tool call.',
        status: 'needs_user_input'
      }
    }
  };
}

/**
 * Plan A (Custom / Local): Any OpenAI-Compatible Endpoint (Ollama, LM Studio, OpenRouter, Groq).
 */
export async function callCustomOpenAICompatible({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs = 45000
}) {
  const endpoint = String(baseUrl || '').trim();
  if (!endpoint) {
    throw new ProviderError('Custom / Local endpoint URL is not configured.', {
      provider: 'custom-openai',
      status: 400,
      code: 'MISSING_ENDPOINT',
      failoverEligible: true
    });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const sendPayload = async (withTools) => {
    const payload = {
      model: model || 'qwen2.5:7b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 1024
    };
    if (withTools) {
      payload.tools = toOpenAITools();
      payload.tool_choice = 'auto';
    }

    let res;
    try {
      res = await fetchWithTimeout(
        endpoint,
        { method: 'POST', headers, body: JSON.stringify(payload) },
        timeoutMs
      );
    } catch (err) {
      if (err instanceof ProviderError) {
        err.provider = 'custom-openai';
        throw err;
      }
      throw new ProviderError(`Custom/Local endpoint network error: ${err.message}`, {
        provider: 'custom-openai',
        status: 0,
        code: 'NETWORK_ERROR',
        failoverEligible: true
      });
    }

    const rawText = await res.text();
    let data = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!res.ok) {
      const errMsg = data?.error?.message || rawText.slice(0, 240) || `HTTP ${res.status}`;
      return { ok: false, status: res.status, errMsg };
    }
    return { ok: true, data };
  };

  // Try native OpenAI tool calling first; fall back cleanly to JSON-only prompt if local model rejects `tools`
  let response = await sendPayload(true);
  if (!response.ok && response.status === 400) {
    response = await sendPayload(false);
  }

  if (!response.ok) {
    throw new ProviderError(`Custom endpoint error (${response.status}): ${response.errMsg}`, {
      provider: 'custom-openai',
      status: response.status,
      code: `HTTP_${response.status}`,
      failoverEligible: true,
      details: response.errMsg
    });
  }

  const message = response.data?.choices?.[0]?.message || {};
  const contentText = (message.content || '').trim();
  const rawToolCalls = message.tool_calls || [];

  let thought = contentText;
  let toolCall = null;

  if (rawToolCalls.length > 0) {
    const first = rawToolCalls[0];
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(first.function?.arguments || '{}');
    } catch {
      parsedArgs = {};
    }
    toolCall = { name: first.function?.name, args: parsedArgs };
  } else if (contentText) {
    const extracted = extractJsonToolCall(contentText);
    if (extracted) {
      toolCall = extracted.toolCall;
      thought = extracted.thought || contentText;
    } else {
      toolCall = { name: 'finish', args: { summary: contentText, status: 'completed' } };
    }
  }

  if (!toolCall) {
    throw new ProviderError('Custom endpoint returned an empty response with no tool call.', {
      provider: 'custom-openai',
      status: 502,
      code: 'EMPTY_RESPONSE',
      failoverEligible: true
    });
  }

  return {
    provider: 'custom-openai',
    model: model || 'custom',
    thought: thought || toolCall.args?.reason || `Executing ${toolCall.name}`,
    toolCall
  };
}

/**
 * Plan B: DeepSeek API (Structured Interactive DOM Map + Tool Calling / Reasoner JSON fallback).
 */
export async function callDeepSeek({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs = 45000
}) {
  if (!apiKey) {
    throw new ProviderError('DeepSeek API key is not configured.', {
      provider: 'deepseek',
      status: 401,
      code: 'MISSING_KEY',
      failoverEligible: false
    });
  }

  const isReasoner = model === 'deepseek-reasoner';
  const jsonToolInstruction = isReasoner
    ? `\n\nAvailable tools (respond with a single JSON object {"thought":"...","tool":"<name>","args":{...}}):\n${JSON.stringify(
        AGENT_TOOLS.map((t) => ({ name: t.name, parameters: t.parameters }))
      )}`
    : '';

  const basePayload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt + jsonToolInstruction },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: isReasoner ? 2048 : 1024
  };

  if (!isReasoner) {
    basePayload.temperature = 0.2;
    basePayload.tools = toOpenAITools();
    basePayload.tool_choice = 'auto';
  }

  let res;
  try {
    res = await fetchWithTimeout(
      DEEPSEEK_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(basePayload)
      },
      timeoutMs
    );
  } catch (err) {
    if (err instanceof ProviderError) {
      err.provider = 'deepseek';
      throw err;
    }
    throw new ProviderError(`DeepSeek network error: ${err.message}`, {
      provider: 'deepseek',
      status: 0,
      code: 'NETWORK_ERROR',
      failoverEligible: false
    });
  }

  const rawText = await res.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errMsg = data?.error?.message || rawText.slice(0, 240) || `HTTP ${res.status}`;
    throw new ProviderError(`DeepSeek API error (${res.status}): ${errMsg}`, {
      provider: 'deepseek',
      status: res.status,
      code: data?.error?.code || `HTTP_${res.status}`,
      failoverEligible: false,
      details: errMsg
    });
  }

  const message = data?.choices?.[0]?.message || {};
  const reasoningContent = message.reasoning_content || '';
  const contentText = (message.content || '').trim();
  const rawToolCalls = message.tool_calls || [];

  let thought = contentText || (reasoningContent ? truncate(reasoningContent, 300) : '');
  let toolCall = null;

  if (rawToolCalls.length > 0) {
    const first = rawToolCalls[0];
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(first.function?.arguments || '{}');
    } catch {
      parsedArgs = {};
    }
    toolCall = { name: first.function?.name, args: parsedArgs };
  } else if (contentText) {
    const extracted = extractJsonToolCall(contentText);
    if (extracted) {
      toolCall = extracted.toolCall;
      thought = extracted.thought || (reasoningContent ? truncate(reasoningContent, 300) : '');
    } else {
      toolCall = { name: 'finish', args: { summary: contentText, status: 'completed' } };
    }
  }

  if (!toolCall) {
    throw new ProviderError('DeepSeek returned an empty response with no tool call.', {
      provider: 'deepseek',
      status: 502,
      code: 'EMPTY_RESPONSE',
      failoverEligible: false
    });
  }

  return {
    provider: 'deepseek',
    model,
    thought: thought || toolCall.args?.reason || `Executing ${toolCall.name}`,
    toolCall
  };
}

/**
 * Dual-provider + Zero-Key Trial orchestrator with seamless Plan A -> Plan B failover.
 */
export async function decideNextAction({
  settings,
  activeProvider,
  goal,
  step,
  maxSteps,
  observation,
  history,
  nanoRunner,
  onFailover
}) {
  const planAMode = settings.planAMode || 'chrome-nano';
  const canUseGemini = Boolean(settings.geminiApiKey && settings.geminiApiKey.trim());
  const canUseDeepSeek = Boolean(settings.deepseekApiKey && settings.deepseekApiKey.trim());

  const runDeepSeekPlanB = async () => {
    const userPrompt = formatObservationPrompt({ goal, step, maxSteps, observation, history, compact: false });
    const systemPrompt = buildSystemPrompt({
      userMemory: settings.userMemory,
      safetyMode: settings.safetyMode,
      providerLabel: `Plan B: DeepSeek Failsafe (${settings.planBModel})`
    });
    return await callDeepSeek({
      apiKey: settings.deepseekApiKey.trim(),
      model: settings.planBModel,
      systemPrompt,
      userPrompt,
      timeoutMs: Math.max(settings.requestTimeoutMs || 30000, 35000)
    });
  };

  // Already on sticky Plan B failsafe
  if (activeProvider === 'deepseek') {
    return await runDeepSeekPlanB();
  }

  let planAError = null;

  // Route based on selected Plan A mode
  if (planAMode === 'chrome-nano') {
    try {
      const compactPrompt = formatObservationPrompt({ goal, step, maxSteps, observation, history, compact: true });
      const nanoSystem = buildSystemPrompt({
        userMemory: settings.userMemory,
        safetyMode: settings.safetyMode,
        providerLabel: 'Zero-Key Trial: Chrome Built-in Gemini Nano',
        compactJsonMode: true
      });
      return await callChromeNano({
        nanoRunner,
        systemPrompt: nanoSystem,
        userPrompt: compactPrompt
      });
    } catch (err) {
      planAError = err;
    }
  } else if (planAMode === 'custom-openai') {
    try {
      const userPrompt = formatObservationPrompt({ goal, step, maxSteps, observation, history, compact: false });
      const customSystem = buildSystemPrompt({
        userMemory: settings.userMemory,
        safetyMode: settings.safetyMode,
        providerLabel: `Custom/Local Endpoint (${settings.customModel})`,
        compactJsonMode: true
      });
      return await callCustomOpenAICompatible({
        baseUrl: settings.customBaseUrl,
        apiKey: settings.customApiKey,
        model: settings.customModel,
        systemPrompt: customSystem,
        userPrompt,
        timeoutMs: Math.max(settings.requestTimeoutMs || 30000, 45000)
      });
    } catch (err) {
      planAError = err;
    }
  } else {
    // Standard Plan A: Google Gemini Cloud API
    if (!canUseGemini) {
      planAError = new ProviderError('Gemini API key is not configured.', {
        provider: 'gemini',
        status: 401,
        code: 'MISSING_KEY',
        failoverEligible: true
      });
    } else {
      const userPrompt = formatObservationPrompt({ goal, step, maxSteps, observation, history, compact: false });
      const geminiSystemPrompt = buildSystemPrompt({
        userMemory: settings.userMemory,
        safetyMode: settings.safetyMode,
        providerLabel: `Plan A: Gemini (${settings.planAModel})`
      });

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await callGemini({
            apiKey: settings.geminiApiKey.trim(),
            model: settings.planAModel,
            systemPrompt: geminiSystemPrompt,
            userPrompt,
            screenshotBase64: observation?.screenshotBase64 || null,
            timeoutMs: settings.requestTimeoutMs || 30000
          });
        } catch (err) {
          planAError = err;
          const isImmediateFailover = [403, 408, 429].includes(err.status) || err.code === 'TIMEOUT';
          if (isImmediateFailover || attempt === 2) break;
          await sleep(800);
        }
      }
    }
  }

  // Automatic Failover to Plan B: DeepSeek Failsafe
  if (planAError?.failoverEligible && canUseDeepSeek) {
    const reason = buildFailoverReason(planAError);
    if (onFailover) {
      onFailover({
        from: planAMode,
        to: 'deepseek',
        status: planAError.status,
        reason
      });
    }
    return await runDeepSeekPlanB();
  }

  throw planAError;
}

/**
 * Connectivity diagnostics for Dry-Run / Mock Test.
 */
export async function verifyGeminiKey(apiKey, model) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, skipped: true, status: 0, latencyMs: 0, message: 'Not configured' };
  }
  const start = Date.now();
  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }],
          generationConfig: { maxOutputTokens: 16, temperature: 0 }
        })
      },
      15000
    );
    const latencyMs = Date.now() - start;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        status: res.status,
        latencyMs,
        message: body?.error?.message || `HTTP ${res.status}`
      };
    }
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'OK';
    return { ok: true, skipped: false, status: res.status, latencyMs, message: `Connected (${text})` };
  } catch (err) {
    return { ok: false, skipped: false, status: err.status || 0, latencyMs: Date.now() - start, message: err.message };
  }
}

export async function verifyCustomEndpoint(baseUrl, apiKey, model) {
  const endpoint = String(baseUrl || '').trim();
  if (!endpoint) {
    return { ok: false, skipped: true, status: 0, latencyMs: 0, message: 'Not configured' };
  }
  const start = Date.now();
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || 'qwen2.5:7b',
          messages: [{ role: 'user', content: 'Reply with OK only.' }],
          max_tokens: 16,
          temperature: 0
        })
      },
      15000
    );
    const latencyMs = Date.now() - start;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        status: res.status,
        latencyMs,
        message: body?.error?.message || `HTTP ${res.status}`
      };
    }
    const text = body?.choices?.[0]?.message?.content?.trim() || 'OK';
    return { ok: true, skipped: false, status: res.status, latencyMs, message: `Connected (${truncate(text, 30)})` };
  } catch (err) {
    return { ok: false, skipped: false, status: err.status || 0, latencyMs: Date.now() - start, message: err.message };
  }
}

export async function verifyDeepSeekKey(apiKey, model) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, skipped: true, status: 0, latencyMs: 0, message: 'Not configured' };
  }
  const start = Date.now();
  try {
    const payload = {
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_tokens: 16
    };
    if (model !== 'deepseek-reasoner') {
      payload.temperature = 0;
    }
    const res = await fetchWithTimeout(
      DEEPSEEK_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(payload)
      },
      15000
    );
    const latencyMs = Date.now() - start;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        status: res.status,
        latencyMs,
        message: body?.error?.message || `HTTP ${res.status}`
      };
    }
    const text = body?.choices?.[0]?.message?.content?.trim() || 'OK';
    return { ok: true, skipped: false, status: res.status, latencyMs, message: `Connected (${text})` };
  } catch (err) {
    return { ok: false, skipped: false, status: err.status || 0, latencyMs: Date.now() - start, message: err.message };
  }
}

function extractJsonToolCall(text) {
  const validNames = new Set(AGENT_TOOLS.map((t) => t.name));
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw);
      const name = parsed.tool || parsed.name || parsed.action;
      if (name && validNames.has(name)) {
        return {
          thought: parsed.thought || parsed.reasoning || '',
          toolCall: {
            name,
            args: parsed.args || parsed.arguments || parsed.parameters || {}
          }
        };
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

function buildFailoverReason(err) {
  if (err.provider === 'chrome-nano') return `Chrome Gemini Nano unavailable (${err.details || err.message})`;
  if (err.provider === 'custom-openai') return `Custom/Local endpoint error (${err.status || err.code})`;
  if (err.status === 429) return 'Gemini HTTP 429 Rate Limit';
  if (err.status === 403) return 'Gemini HTTP 403 Quota / Billing';
  if (err.code === 'TIMEOUT' || err.status === 408) return 'Gemini Request Timeout';
  return `Plan A Error (${err.status || err.code})`;
}

function truncate(str, max) {
  const clean = String(str || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
