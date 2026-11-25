/**
 * Chrome Built-in Gemini Nano Adapter (Zero-API-Key On-Device Trial Mode)
 *
 * Uses Chrome's official Prompt API (`LanguageModel` in Chrome 138+ or legacy `ai.languageModel`).
 * Runs locally on-device with zero API keys or billing required.
 */

const NANO_SETUP_HINT =
  'Enable chrome://flags/#prompt-api-for-gemini-nano and chrome://flags/#optimization-guide-on-device-model (Enabled BypassPerfRequirement), restart Chrome, and wait for Gemini Nano to download in chrome://components ("Optimization Guide On Device Model").';

/**
 * Detect which official Chrome Prompt API surface exists in the current JS context.
 */
export function getLocalNanoApi() {
  if (typeof globalThis.LanguageModel !== 'undefined' && typeof globalThis.LanguageModel.create === 'function') {
    return { kind: 'modern', api: globalThis.LanguageModel };
  }
  if (globalThis.ai?.languageModel && typeof globalThis.ai.languageModel.create === 'function') {
    return { kind: 'legacy', api: globalThis.ai.languageModel };
  }
  return null;
}

/**
 * Check availability of Chrome Built-in Gemini Nano in the current JS context.
 */
export async function checkLocalNanoAvailability() {
  const found = getLocalNanoApi();
  if (!found) {
    return {
      available: false,
      state: 'api_missing',
      message: `Chrome Prompt API not exposed in this context. ${NANO_SETUP_HINT}`
    };
  }

  try {
    if (found.kind === 'modern') {
      const status = await found.api.availability();
      if (status === 'available' || status === 'readily') {
        return { available: true, state: 'available', message: 'Chrome Built-in Gemini Nano is ready (on-device, no API key).' };
      }
      if (status === 'downloadable' || status === 'after-download' || status === 'downloading') {
        return {
          available: true,
          state: status,
          message: `Gemini Nano is ${status}. Running a prompt or Dry-Run will trigger/finish the on-device download.`
        };
      }
      return { available: false, state: status || 'unavailable', message: `Gemini Nano unavailable (${status}). ${NANO_SETUP_HINT}` };
    }

    const caps = await found.api.capabilities();
    const state = caps?.available || 'no';
    if (state === 'readily' || state === 'after-download') {
      return {
        available: true,
        state: state === 'readily' ? 'available' : 'downloadable',
        message:
          state === 'readily'
            ? 'Chrome Built-in Gemini Nano (legacy ai.languageModel) is ready.'
            : 'Gemini Nano is downloadable on-device.'
      };
    }
    return { available: false, state: 'unavailable', message: `Gemini Nano unavailable (${state}). ${NANO_SETUP_HINT}` };
  } catch (err) {
    return { available: false, state: 'error', message: `Gemini Nano check error: ${err.message}` };
  }
}

/**
 * Execute a single prompt on Chrome Built-in Gemini Nano inside the current JS context.
 */
export async function runLocalNanoPrompt({ systemPrompt, userPrompt }) {
  const found = getLocalNanoApi();
  if (!found) {
    throw new Error(`Chrome Prompt API not available in this context. ${NANO_SETUP_HINT}`);
  }

  let session = null;
  try {
    if (found.kind === 'modern') {
      const status = await found.api.availability();
      if (status === 'unavailable' || status === 'no') {
        throw new Error(`Gemini Nano unavailable (${status}). ${NANO_SETUP_HINT}`);
      }
      session = await found.api.create({
        initialPrompts: systemPrompt ? [{ role: 'system', content: systemPrompt }] : undefined
      });
    } else {
      session = await found.api.create({
        systemPrompt: systemPrompt || undefined
      });
    }

    const output = await session.prompt(userPrompt);
    return String(output || '').trim();
  } finally {
    if (session && typeof session.destroy === 'function') {
      try {
        session.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
