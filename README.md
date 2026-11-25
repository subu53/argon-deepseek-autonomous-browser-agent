# Argon-DeepSeek Autonomous Browser Agent

A production-ready **Manifest V3 Chrome Side Panel Extension** that acts as an autonomous browser operator using a **dual-provider failover architecture**:

- **Plan A (Primary — Google Gemini):** `gemini-4-hydrogen`, `gemini-2.5-flash` (free-tier compatible), `gemini-4-argon`, and `gemini-4-carbon` with **Viewport Vision + Interactive DOM Map + Function Calling**.
- **Plan B (Automatic Failsafe — DeepSeek):** `deepseek-chat` (fast structured DOM navigation & tool calling) and `deepseek-reasoner` (deep multi-step planning).
- **Zero-Loss Auto-Failover:** If Plan A returns HTTP `429` (rate limit), `403` (quota/billing), or times out mid-task, the service worker catches the error, displays `"Switched to Plan B: DeepSeek Failsafe"` in the Side Panel, and resumes execution from the exact current step without losing ReAct history or task state.
- **Human-in-the-Loop Safety Gate:** Automatically pauses before high-risk clicks matching `/submit|send|post|apply|delete|pay|confirm/i` (such as posting a LinkedIn comment or sending a Gmail draft) unless you explicitly switch to **Full Auto Mode**.

---

## Project Structure

```text
argon-deepseek-agent/
├── manifest.json       # Chrome Manifest V3 config (sidePanel, scripting, tabs, storage, debugger)
├── background.js       # MV3 Service Worker: ReAct loop, failover orchestrator, safety gate, diagnostics
├── content.js          # DOM Perception & SPA Action Engine (Shadow DOM, React/Ember/LinkedIn/Gmail)
├── sidepanel.html      # Persistent Side Panel UI markup
├── sidepanel.css       # High-contrast dark & light theme styling
├── sidepanel.js        # Side Panel controller, / shortcuts, live log, confirmation cards, Dry-Run test
├── lib/
│   ├── config.js       # Model catalogs, slash command templates, chrome.storage.local helpers
│   ├── safety.js       # High-risk action classifier & confirmation payload builder
│   └── providers.js    # Plan A (Gemini) + Plan B (DeepSeek) API clients & auto-failover engine
└── icons/              # 16px, 48px, and 128px extension icons
```

---

## Installation (Load Unpacked in Chrome)

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select this repository folder (`argon-deepseek-agent`).
5. Pin **Argon-DeepSeek Autonomous Browser Agent** to your Chrome toolbar and click the extension icon to open the persistent Side Panel.

---

## Configuration & API Keys

1. In the Side Panel, click the **⚙️ Settings** icon in the top-right corner.
2. **Plan A (Google Gemini API):**
   - Get a free-tier API key from [Google AI Studio](https://aistudio.google.com/apikey).
   - Paste it into **Plan A — Google Gemini API Key (`GEMINI_API_KEY`)**.
   - Select `gemini-2.5-flash` or `gemini-4-hydrogen` (or `gemini-4-argon` / `gemini-4-carbon`).
3. **Plan B (DeepSeek Failsafe API):**
   - Get an API key from the [DeepSeek Platform](https://platform.deepseek.com/api_keys).
   - Paste it into **Plan B — DeepSeek Failsafe Key (`DEEPSEEK_API_KEY`)**.
   - Select `deepseek-chat` for fast DOM navigation or `deepseek-reasoner` for complex multi-step planning.
4. **User Profile / Persona Memory:**
   - Add your name, role, company, email, LinkedIn URL, tone of voice, and standard application details.
   - All keys and persona memory are stored exclusively on your machine in `chrome.storage.local`.
5. Click **Save Settings**, then click **🧪 Dry-Run / Mock Test** while viewing a normal webpage (not `chrome://`) to verify:
   - Gemini API connectivity & latency
   - DeepSeek API connectivity & latency
   - Live Interactive DOM Map element indexing on the active tab

---

## Testing Workflows

### 1. LinkedIn Comment Replies (`/linkedin-replies`)
1. Open any LinkedIn post containing comments.
2. Ensure **🛡️ Ask Before Submitting** is selected (default).
3. Click the `/linkedin-replies` chip in the Side Panel and click **▶ Run Agent**.
4. The agent inspects the post & comments, clicks Reply on an unanswered comment, types a persona-aligned draft into LinkedIn's `contenteditable` composer, and pauses at the **Safety Confirmation Card** before clicking Post/Reply.

### 2. Company Research & Gmail Outreach (`/research-and-gmail`)
1. Open a prospect's website or LinkedIn profile.
2. Click `/research-and-gmail` (optionally append extra instructions, e.g., `/research-and-gmail focus on their new API launch`) and click **▶ Run Agent**.
3. The agent extracts key page text, opens or switches to Gmail compose, fills the Subject and `contenteditable` Message Body, and pauses before clicking **Send**.

### 3. Form & Application Filling (`/fill-application`)
1. Open a job or onboarding application form.
2. Click `/fill-application` and click **▶ Run Agent**.
3. The agent maps inputs, textareas, and `<select>` dropdowns to your saved **User Profile / Persona Memory** and pauses before clicking **Submit** or **Apply**.

### 4. Testing Automatic Plan A → Plan B Failover
- To observe failover live, run a task when Gemini returns `429` (rate limit), `403` (quota/billing), or times out.
- The Side Panel badge will immediately flip from **Plan A: Gemini** to **Plan B: DeepSeek**, display **`Switched to Plan B: DeepSeek Failsafe`**, and continue the exact current ReAct step seamlessly.
