# Argon-DeepSeek Autonomous Browser Agent

A production-ready **Manifest V3 Chrome Side Panel Extension** that acts as an autonomous browser operator with **Zero-Key Trial Mode** and a **dual-provider failover architecture**:

- **Zero-Key Trial Mode (Chrome Built-in Gemini Nano):** Uses Chrome's official on-device Prompt API (`LanguageModel`) with **no API key or billing required**.
- **Custom / Local Endpoint Mode:** One-click presets for **Ollama (local, free)**, **LM Studio**, **OpenRouter Free Tier**, and **Groq Free Tier** (any OpenAI-compatible `/chat/completions` endpoint).
- **Plan A (Cloud — Google Gemini API):** `gemini-4-hydrogen`, `gemini-2.5-flash` (free-tier compatible), `gemini-4-argon`, and `gemini-4-carbon` with **Viewport Vision + Interactive DOM Map + Function Calling**.
- **Plan B (Automatic Failsafe — DeepSeek):** `deepseek-chat` (fast structured DOM navigation & tool calling) and `deepseek-reasoner` (deep multi-step planning).
- **Zero-Loss Auto-Failover:** If Plan A fails (`429` rate limit, `403` quota/billing, timeout, or unavailable), the service worker catches the error, displays `"Switched to Plan B: DeepSeek Failsafe"` in the Side Panel, and seamlessly resumes execution from the exact current step without losing task state.
- **Human-in-the-Loop Safety Gate:** Automatically pauses before high-risk clicks matching `/submit|send|post|apply|delete|pay|confirm/i` unless **Full Auto Mode** is toggled on.

---

## Project Structure

```text
argon-deepseek-agent/
├── manifest.json       # Chrome Manifest V3 config (sidePanel, scripting, tabs, storage, debugger)
├── background.js       # MV3 Service Worker: ReAct loop, failover orchestrator, safety gate, diagnostics
├── content.js          # DOM Perception & SPA Action Engine (Shadow DOM, React/Ember/LinkedIn/Gmail)
├── sidepanel.html      # Persistent Side Panel UI markup
├── sidepanel.css       # High-contrast dark & light theme styling
├── sidepanel.js        # Side Panel controller, / shortcuts, live log, Nano bridge, Dry-Run test
├── lib/
│   ├── config.js       # Model catalogs, trial presets, slash shortcuts, chrome.storage.local helpers
│   ├── chrome_nano.js  # Chrome Built-in Gemini Nano (LanguageModel / ai.languageModel) adapter
│   ├── safety.js       # High-risk action classifier & confirmation payload builder
│   └── providers.js    # Plan A (Nano / Gemini / Custom-Local) + Plan B (DeepSeek) failover engine
└── icons/              # 16px, 48px, and 128px extension icons
```

---

## Installation (Load Unpacked in Chrome)

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this repository folder (`argon-deepseek-agent`).
4. Pin **Argon-DeepSeek Autonomous Browser Agent** to your toolbar and click it to open the persistent Side Panel.

---

## Running Without a Gemini API Key (Zero-Key Trial Mode)

### Option A: Chrome Built-in Gemini Nano (On-Device, Free)
1. In Chrome, open `chrome://flags/#prompt-api-for-gemini-nano` and set it to **Enabled**.
2. Open `chrome://flags/#optimization-guide-on-device-model` and set it to **Enabled BypassPerfRequirement**.
3. Restart Chrome and check `chrome://components` → click **Check for update** on **Optimization Guide On Device Model** if needed.
4. In the extension's **⚙️ Settings**, keep **Plan A — Primary Engine Mode** set to **Zero-Key Trial: Chrome Built-in Gemini Nano** and click **🧪 Dry-Run / Mock Test**.

### Option B: Local Ollama / LM Studio or Free-Tier OpenRouter / Groq
1. In **⚙️ Settings**, set **Plan A — Primary Engine Mode** to **Custom / Local Endpoint**.
2. Click one of the presets (**Ollama Local**, **LM Studio**, **OpenRouter Free**, or **Groq Free**).
   - For local **Ollama**, leave the API key blank and start Ollama with CORS allowed for Chrome extensions:
     ```bash
     OLLAMA_ORIGINS="chrome-extension://*" ollama serve
     ```
3. Click **Save Settings** and run **🧪 Dry-Run / Mock Test**.

### Option C: Cloud Gemini (Plan A) + DeepSeek Failsafe (Plan B)
1. In **⚙️ Settings**, switch **Plan A — Primary Engine Mode** to **Plan A: Google Gemini API** and enter your `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey).
2. Add your `DEEPSEEK_API_KEY` from [DeepSeek Platform](https://platform.deepseek.com/api_keys) for automatic Plan B failover (or run DeepSeek-only by leaving the Gemini key blank).

---

## Testing Workflows

- **`/linkedin-replies`**: Open a LinkedIn post, keep **🛡️ Ask Before Submitting** active, click `/linkedin-replies`, and run. The agent drafts replies in LinkedIn's `contenteditable` reply box and pauses at the Safety Confirmation Card before posting.
- **`/research-and-gmail`**: Open any company/profile page, click `/research-and-gmail`, and run. The agent extracts key page info, opens Gmail compose, drafts the outreach email using your saved Persona Memory, and pauses before clicking **Send**.
- **`/fill-application`**: Open a form or job application, click `/fill-application`, and run. The agent populates inputs/selects/textareas using your saved Persona Memory and pauses before clicking **Submit** or **Apply**.
