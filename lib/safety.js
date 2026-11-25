/**
 * Human-in-the-Loop Safety Gate
 * Detects high-risk browser actions before execution unless Full Auto Mode is enabled.
 */

export const HIGH_RISK_CLICK_REGEX = /submit|send|post|apply|delete|pay|confirm/i;

export const SECONDARY_RISK_REGEX = /purchase|checkout|place\s+order|remove\s+account|publish|transfer|authorize/i;

/**
 * Evaluate whether a proposed agent tool call requires human confirmation.
 *
 * @param {object} toolCall - { name: string, args: object }
 * @param {Array<object>} domElements - Indexed interactive elements from the active page
 * @param {string} safetyMode - 'ask' | 'auto'
 * @returns {{ requiresApproval: boolean, riskLevel: 'none'|'high', matchedRule: string|null, targetSummary: string, element: object|null }}
 */
export function evaluateActionSafety(toolCall, domElements = [], safetyMode = 'ask') {
  if (safetyMode === 'auto') {
    return {
      requiresApproval: false,
      riskLevel: 'none',
      matchedRule: null,
      targetSummary: '',
      element: null
    };
  }

  const name = toolCall?.name || '';
  const args = toolCall?.args || {};

  const targetElement =
    args.agent_id !== undefined && args.agent_id !== null
      ? domElements.find((el) => String(el.id) === String(args.agent_id)) || null
      : null;

  const targetSummary = describeTarget(name, args, targetElement);

  if (name === 'click') {
    const candidateFields = [
      targetElement?.text,
      targetElement?.ariaLabel,
      targetElement?.title,
      targetElement?.placeholder,
      targetElement?.name,
      targetElement?.value,
      targetElement?.inputType,
      targetElement?.role,
      args.reason
    ]
      .filter(Boolean)
      .join(' | ');

    const primaryMatch = candidateFields.match(HIGH_RISK_CLICK_REGEX);
    if (primaryMatch) {
      return {
        requiresApproval: true,
        riskLevel: 'high',
        matchedRule: `Matched high-risk action keyword "${primaryMatch[0]}"`,
        targetSummary,
        element: targetElement
      };
    }

    const secondaryMatch = candidateFields.match(SECONDARY_RISK_REGEX);
    if (secondaryMatch) {
      return {
        requiresApproval: true,
        riskLevel: 'high',
        matchedRule: `Matched sensitive action keyword "${secondaryMatch[0]}"`,
        targetSummary,
        element: targetElement
      };
    }

    if (targetElement && targetElement.tag === 'button' && targetElement.inputType === 'submit') {
      return {
        requiresApproval: true,
        riskLevel: 'high',
        matchedRule: 'Form submit button (type="submit")',
        targetSummary,
        element: targetElement
      };
    }
  }

  // Also guard typing with press_enter=true when the reason implies sending/posting/submitting
  if (name === 'type' && args.press_enter === true) {
    const reasonText = `${args.reason || ''} ${targetElement?.ariaLabel || ''} ${targetElement?.placeholder || ''}`;
    const match = reasonText.match(HIGH_RISK_CLICK_REGEX);
    if (match) {
      return {
        requiresApproval: true,
        riskLevel: 'high',
        matchedRule: `Typing with Enter key on high-risk context "${match[0]}"`,
        targetSummary,
        element: targetElement
      };
    }
  }

  return {
    requiresApproval: false,
    riskLevel: 'none',
    matchedRule: null,
    targetSummary,
    element: targetElement
  };
}

function describeTarget(name, args, el) {
  if (el) {
    const label = el.text || el.ariaLabel || el.placeholder || el.title || el.name || el.tag;
    return `${name} on #${el.id} <${el.tag}> "${truncate(label, 72)}"`;
  }
  if (args.agent_id !== undefined) {
    return `${name} on element #${args.agent_id}`;
  }
  if (args.url) {
    return `${name} -> ${args.url}`;
  }
  return name;
}

function truncate(str, max) {
  const clean = String(str || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
