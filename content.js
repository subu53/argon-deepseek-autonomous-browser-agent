/**
 * Argon-DeepSeek Autonomous Browser Agent
 * Content Script: DOM Perception & SPA-Safe Action Engine
 *
 * - Injects temporary, invisible `data-agent-id` attributes onto interactive elements
 * - Produces a compact, token-efficient Interactive DOM Map (supports Shadow DOM)
 * - Executes reliable actions on modern SPAs (React, Ember, LinkedIn, Gmail)
 */

(() => {
  if (window.__ARGON_DEEPSEEK_CONTENT_READY__) {
    return;
  }
  window.__ARGON_DEEPSEEK_CONTENT_READY__ = true;

  const AGENT_ATTR = 'data-agent-id';
  const MAX_DOM_ITEMS = 160;
  let elementRegistry = new Map();

  const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'textarea', 'select', 'summary', 'option']);
  const INTERACTIVE_ROLES = new Set([
    'button',
    'link',
    'textbox',
    'combobox',
    'menuitem',
    'tab',
    'checkbox',
    'radio',
    'switch',
    'option',
    'searchbox',
    'spinbutton',
    'slider'
  ]);

  function cleanText(str, maxLen = 100) {
    if (!str) return '';
    const collapsed = String(str).replace(/\s+/g, ' ').trim();
    return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}…` : collapsed;
  }

  function isContentEditableEl(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.isContentEditable) return true;
    const attr = el.getAttribute('contenteditable');
    return attr === '' || attr === 'true' || attr === 'plaintext-only';
  }

  function isVisibleElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.hidden) return false;

    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return false;
    }
    return true;
  }

  function isInteractiveElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName.toLowerCase();

    if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') {
      return false;
    }

    if (INTERACTIVE_TAGS.has(tag)) return true;
    if (isContentEditableEl(el)) return true;

    const role = (el.getAttribute('role') || '').toLowerCase().trim();
    if (role && INTERACTIVE_ROLES.has(role)) return true;

    const tabIndex = el.getAttribute('tabindex');
    if (tabIndex !== null && tabIndex !== '-1' && (el.getAttribute('aria-label') || el.onclick)) {
      return true;
    }

    if (el.hasAttribute('onclick') || el.getAttribute('data-control-name')) {
      return true;
    }

    return false;
  }

  function collectElementsRecursive(root, out) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (isInteractiveElement(node) && isVisibleElement(node)) {
        out.push(node);
      }
      if (node.shadowRoot) {
        collectElementsRecursive(node.shadowRoot, out);
      }
      node = walker.nextNode();
    }
  }

  function getAccessibleText(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) {
        return cleanText(el.value || el.getAttribute('aria-label') || '');
      }
      // Check associated <label>
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return cleanText(label.innerText || label.textContent || '');
      }
      const parentLabel = el.closest('label');
      if (parentLabel) {
        return cleanText(parentLabel.innerText || parentLabel.textContent || '');
      }
      return '';
    }

    if (tag === 'textarea' || tag === 'select') {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return cleanText(label.innerText || label.textContent || '');
      }
      return '';
    }

    if (isContentEditableEl(el)) {
      return cleanText(el.innerText || el.textContent || '', 80);
    }

    return cleanText(el.innerText || el.textContent || '', 90);
  }

  function getElementValue(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'password') return el.value ? '••••••' : '';
      if (type === 'checkbox' || type === 'radio') return el.checked ? 'checked' : 'unchecked';
      return cleanText(el.value || '', 60);
    }
    if (tag === 'textarea') {
      return cleanText(el.value || '', 60);
    }
    if (tag === 'select') {
      const selected = el.options?.[el.selectedIndex];
      return cleanText(selected?.text || el.value || '', 60);
    }
    return '';
  }

  /**
   * Scan the active page, assign invisible `data-agent-id` attributes,
   * and return a compact Interactive DOM Map prioritized by viewport visibility.
   */
  function indexDom() {
    clearAgentIds();
    elementRegistry = new Map();

    const rawElements = [];
    if (document.body) {
      collectElementsRecursive(document.body, rawElements);
    }

    const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;

    // Deduplicate nested redundant interactive containers (keep innermost contenteditable or direct controls)
    const filtered = [];
    for (const el of rawElements) {
      if (el.parentElement && isContentEditableEl(el.parentElement) && isContentEditableEl(el)) {
        continue;
      }
      filtered.push(el);
    }

    const scored = filtered.map((el) => {
      const rect = el.getBoundingClientRect();
      const inViewport = rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
      const distFromViewport = inViewport
        ? 0
        : Math.min(Math.abs(rect.top), Math.abs(rect.bottom - vh));
      return { el, rect, inViewport, distFromViewport };
    });

    // Prioritize visible viewport elements first, then nearby elements in document order
    scored.sort((a, b) => {
      if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1;
      if (a.distFromViewport !== b.distFromViewport) return a.distFromViewport - b.distFromViewport;
      return a.rect.top - b.rect.top || a.rect.left - b.rect.left;
    });

    const selected = scored.slice(0, MAX_DOM_ITEMS);
    const domMap = [];

    selected.forEach((item, idx) => {
      const id = idx + 1;
      const { el, rect, inViewport } = item;
      el.setAttribute(AGENT_ATTR, String(id));
      elementRegistry.set(id, el);

      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase().trim();
      const inputType = tag === 'input' || tag === 'button' ? (el.getAttribute('type') || '').toLowerCase() : '';
      const ariaLabel = cleanText(
        el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || '',
        80
      );
      const placeholder = cleanText(
        el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
        70
      );
      const title = cleanText(el.getAttribute('title') || '', 70);
      const name = cleanText(el.getAttribute('name') || '', 50);
      const text = getAccessibleText(el);
      const value = getElementValue(el);
      const href = tag === 'a' ? cleanText(el.getAttribute('href') || '', 80) : '';
      const contentEditable = isContentEditableEl(el);
      const disabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');

      domMap.push({
        id,
        tag,
        role: role || undefined,
        inputType: inputType || undefined,
        contentEditable: contentEditable || undefined,
        text: text || undefined,
        ariaLabel: ariaLabel || undefined,
        placeholder: placeholder || undefined,
        title: title || undefined,
        name: name || undefined,
        value: value || undefined,
        href: href || undefined,
        disabled: disabled || undefined,
        inViewport,
        bbox: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        }
      });
    });

    return {
      ok: true,
      url: window.location.href,
      title: document.title,
      domMap,
      pageMeta: {
        viewportWidth: vw,
        viewportHeight: vh,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        scrollHeight: Math.round(document.documentElement.scrollHeight || document.body?.scrollHeight || 0),
        totalIndexed: filtered.length,
        returnedCount: domMap.length
      }
    };
  }

  function clearAgentIds() {
    for (const el of elementRegistry.values()) {
      try {
        el.removeAttribute(AGENT_ATTR);
      } catch {
        // Detached node
      }
    }
    document.querySelectorAll(`[${AGENT_ATTR}]`).forEach((el) => {
      el.removeAttribute(AGENT_ATTR);
    });
    elementRegistry.clear();
  }

  function resolveElement(agentId) {
    const numId = Number(agentId);
    const fromMap = elementRegistry.get(numId);
    if (fromMap && fromMap.isConnected) {
      return fromMap;
    }
    const fromDom = document.querySelector(`[${AGENT_ATTR}="${CSS.escape(String(agentId))}"]`);
    if (fromDom) return fromDom;
    return null;
  }

  function flashHighlight(el, color = '#38bdf8') {
    try {
      const prevOutline = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      el.style.outline = `2px solid ${color}`;
      el.style.outlineOffset = '2px';
      setTimeout(() => {
        try {
          el.style.outline = prevOutline;
          el.style.outlineOffset = prevOffset;
        } catch {
          // Ignore detached element
        }
      }, 650);
    } catch {
      // Ignore non-stylable node
    }
  }

  function dispatchPointerClick(el) {
    const rect = el.getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: 1
    };

    try {
      el.dispatchEvent(new PointerEvent('pointerover', { ...common, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseover', common));
      el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mousedown', common));
    } catch {
      el.dispatchEvent(new MouseEvent('mousedown', common));
    }

    if (typeof el.focus === 'function') {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }

    try {
      el.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { ...common, buttons: 0 }));
    } catch {
      el.click();
    }

    return { clientX, clientY };
  }

  async function actionClick({ agent_id }) {
    const el = resolveElement(agent_id);
    if (!el) {
      return { ok: false, error: `Element #${agent_id} not found. Re-observe the page for updated IDs.` };
    }
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    await sleep(60);
    flashHighlight(el, '#38bdf8');
    const coords = dispatchPointerClick(el);
    return {
      ok: true,
      message: `Clicked #${agent_id} <${el.tagName.toLowerCase()}>`,
      coords
    };
  }

  function setNativeInputValue(el, value) {
    const proto =
      el.tagName.toLowerCase() === 'textarea'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function dispatchEnterKey(el) {
    const opts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  async function actionType({ agent_id, text = '', clear_first = true, press_enter = false }) {
    const el = resolveElement(agent_id);
    if (!el) {
      return { ok: false, error: `Editable element #${agent_id} not found.` };
    }

    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    await sleep(50);
    flashHighlight(el, '#34d399');

    dispatchPointerClick(el);
    await sleep(40);

    const tag = el.tagName.toLowerCase();
    const textStr = String(text);

    if (isContentEditableEl(el)) {
      el.focus();
      if (clear_first) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const deleted = document.execCommand('delete', false);
        if (!deleted) {
          el.textContent = '';
        }
      }

      // Use execCommand('insertText') first — works cleanly with Gmail, LinkedIn Quill/ProseMirror, and React Draft.js
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, textStr);
      } catch {
        inserted = false;
      }

      const currentText = (el.innerText || el.textContent || '').trim();
      if (!inserted || (!currentText && textStr.trim())) {
        el.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: textStr
          })
        );
        el.textContent = clear_first ? textStr : `${el.textContent || ''}${textStr}`;
      }

      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: textStr
        })
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (tag === 'input' || tag === 'textarea') {
      el.focus();
      const nextValue = clear_first ? textStr : `${el.value || ''}${textStr}`;
      setNativeInputValue(el, nextValue);
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: textStr
        })
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      return {
        ok: false,
        error: `Element #${agent_id} <${tag}> is neither an input/textarea nor contenteditable.`
      };
    }

    if (press_enter) {
      await sleep(40);
      dispatchEnterKey(el);
    }

    return {
      ok: true,
      message: `Typed ${textStr.length} chars into #${agent_id} <${tag}>${press_enter ? ' and pressed Enter' : ''}`
    };
  }

  async function actionSelectOption({ agent_id, value = '' }) {
    const el = resolveElement(agent_id);
    if (!el || el.tagName.toLowerCase() !== 'select') {
      return { ok: false, error: `Select element #${agent_id} not found.` };
    }
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    flashHighlight(el, '#a78bfa');

    const target = String(value).trim().toLowerCase();
    const options = Array.from(el.options || []);
    const match =
      options.find((o) => o.value.toLowerCase() === target || o.text.trim().toLowerCase() === target) ||
      options.find((o) => o.text.trim().toLowerCase().includes(target));

    if (!match) {
      return {
        ok: false,
        error: `Option "${value}" not found in select #${agent_id}. Available: ${options
          .slice(0, 10)
          .map((o) => o.text.trim())
          .join(', ')}`
      };
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, match.value);
    } else {
      el.value = match.value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      ok: true,
      message: `Selected "${match.text.trim()}" on #${agent_id}`
    };
  }

  function actionScroll({ direction = 'down', amount = 600, agent_id }) {
    const px = Math.max(100, Math.min(Number(amount) || 600, 3000));
    const container = agent_id ? resolveElement(agent_id) : null;

    if (container && container.scrollHeight > container.clientHeight) {
      if (direction === 'top') container.scrollTo({ top: 0, behavior: 'smooth' });
      else if (direction === 'bottom') container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      else if (direction === 'up') container.scrollBy({ top: -px, behavior: 'smooth' });
      else container.scrollBy({ top: px, behavior: 'smooth' });
      return { ok: true, message: `Scrolled container #${agent_id} ${direction}` };
    }

    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -px, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: px, behavior: 'smooth' });
    }

    return {
      ok: true,
      message: `Scrolled page ${direction}${direction === 'up' || direction === 'down' ? ` by ${px}px` : ''}`
    };
  }

  function actionExtractPageText({ max_chars = 6000 } = {}) {
    const cap = Math.max(500, Math.min(Number(max_chars) || 6000, 12000));
    const primary = document.querySelector('main, article, [role="main"]') || document.body;
    const raw = (primary?.innerText || document.body?.innerText || '').trim();
    const normalized = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');

    return {
      ok: true,
      title: document.title,
      url: window.location.href,
      text: normalized.slice(0, cap),
      truncated: normalized.length > cap,
      totalChars: normalized.length
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    (async () => {
      try {
        switch (message.type) {
          case 'CONTENT_PING':
            sendResponse({ ok: true, ready: true, url: window.location.href });
            break;
          case 'CONTENT_INDEX_DOM':
            sendResponse(indexDom());
            break;
          case 'CONTENT_CLICK':
            sendResponse(await actionClick(message.payload || {}));
            break;
          case 'CONTENT_TYPE':
            sendResponse(await actionType(message.payload || {}));
            break;
          case 'CONTENT_SELECT':
            sendResponse(await actionSelectOption(message.payload || {}));
            break;
          case 'CONTENT_SCROLL':
            sendResponse(actionScroll(message.payload || {}));
            break;
          case 'CONTENT_EXTRACT_TEXT':
            sendResponse(actionExtractPageText(message.payload || {}));
            break;
          case 'CONTENT_CLEAR_IDS':
            clearAgentIds();
            sendResponse({ ok: true });
            break;
          default:
            sendResponse({ ok: false, error: `Unknown content message type: ${message.type}` });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();

    return true;
  });
})();
