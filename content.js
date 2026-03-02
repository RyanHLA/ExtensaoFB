/**
 * FB Ad Library — Creative Highlighter v2
 *
 * Strategy (based on real DOM inspection):
 * The "X anúncios usam esse criativo e esse texto" text is structured as:
 *
 *   <span>
 *     <strong>5 anúncios</strong> usam esse criativo e esse texto
 *   </span>
 *
 * So the number + "anúncios" is already isolated in a <strong> tag.
 * We simply find the parent <span> whose text matches our pattern,
 * then color its <strong> child red.
 *
 * Also supports English: "X ads use this creative and this text"
 * and handles dynamically loaded cards via MutationObserver.
 */

// ── Patterns ──────────────────────────────────────────────────────────────────

// Matches the FULL text of the container element
const CONTAINER_PATTERNS = [
  // Portuguese (Brazil) — "esse" variant
  /anúncios?\s+usam\s+ess[ae]\s+criativo/i,
  // Portuguese — "este" variant
  /anúncios?\s+usam\s+este\s+criativo/i,
  // Portuguese — plural noun first
  /usam\s+ess[ae]\s+criativo/i,
  // English
  /ads?\s+use\s+this\s+creative/i,
];

// Matches the text inside the <strong> (just the count + unit)
const STRONG_PATTERNS = [
  /^\d+\s+anúncios?$/i,   // e.g. "5 anúncios"
  /^\d+\s+ads?$/i,         // e.g. "7 ads"
];

// Fallback: if there's no <strong>, match number+unit inside a text node
const TEXT_NODE_PATTERN = /(\d+\s+anúncios?|\d+\s+ads?)/i;

// ── Highlight style ────────────────────────────────────────────────────────────

const STYLE = 'color:#e00 !important; font-weight:700 !important;';
const DONE_ATTR = 'data-fbhl';
const CARD_ATTR = 'data-fbhl-card';
const CARD_BORDER_STYLE = '2px solid #e00 !important';
const CARD_BG_STYLE = 'rgba(220,0,0,0.04) !important';

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Walk up the DOM from `el` to find the outermost card-like ancestor.
 * We keep climbing and track the last valid candidate, so we get the FULL
 * card container rather than stopping at the first inner section.
 *
 * A valid candidate is a block-level element (div/article/li/section) that is:
 *   - at least 200px wide and 100px tall (real container, not a tiny wrapper)
 *   - no wider than 90% of the viewport (to avoid selecting the page shell)
 *
 * We stop after 30 levels or when we hit document.body.
 */
function findCardAncestor(el) {
  const maxWidth = window.innerWidth * 0.90;
  let node = el.parentElement;
  let depth = 0;
  let best = null;

  while (node && node !== document.body && depth < 30) {
    const tag = node.tagName;
    if (tag === 'DIV' || tag === 'ARTICLE' || tag === 'LI' || tag === 'SECTION') {
      const rect = node.getBoundingClientRect();
      if (rect.width >= 200 && rect.height >= 100 && rect.width <= maxWidth) {
        best = node; // keep climbing — we want the outermost valid ancestor
      }
    }
    node = node.parentElement;
    depth++;
  }
  return best;
}

/**
 * Apply a red border + faint red background tint to the ad card element.
 */
function applyCardBorder(cardEl) {
  if (!cardEl || cardEl.hasAttribute(CARD_ATTR)) return;
  cardEl.setAttribute(CARD_ATTR, '1');
  cardEl.style.setProperty('outline', CARD_BORDER_STYLE.replace(' !important', ''), 'important');
  cardEl.style.setProperty('background-color', CARD_BG_STYLE.replace(' !important', ''), 'important');
  cardEl.style.setProperty('border-radius', '8px', 'important');
}

/**
 * Given an element whose full textContent matches one of CONTAINER_PATTERNS,
 * apply red styling to the "X anúncios / X ads" part,
 * and apply a red border to the enclosing ad card.
 */
function applyHighlight(el) {
  if (el.hasAttribute(DONE_ATTR)) return;
  el.setAttribute(DONE_ATTR, '1');

  // Always try to border the card, regardless of text highlight strategy
  const card = findCardAncestor(el);
  applyCardBorder(card);

  // Strategy 1: find a <strong> child with content like "5 anúncios"
  const strongs = el.querySelectorAll('strong, b');
  for (const strong of strongs) {
    const txt = strong.textContent.trim();
    if (STRONG_PATTERNS.some(p => p.test(txt))) {
      strong.style.cssText = STYLE;
      return;
    }
  }

  // Strategy 2: walk text nodes and wrap the matching portion
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  for (const textNode of textNodes) {
    const text = textNode.textContent;
    const match = TEXT_NODE_PATTERN.exec(text);
    if (!match) continue;

    const before = text.slice(0, match.index);
    const highlighted = match[0];
    const after = text.slice(match.index + highlighted.length);

    const parent = textNode.parentNode;
    if (!parent) continue;

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));

    const span = document.createElement('span');
    span.setAttribute(DONE_ATTR, '1');
    span.style.cssText = STYLE;
    span.textContent = highlighted;
    frag.appendChild(span);

    if (after) frag.appendChild(document.createTextNode(after));
    parent.replaceChild(frag, textNode);
    return; // one match per container is enough
  }
}

/**
 * Scan a root element and all its descendants for ad creative containers.
 */
function scan(root) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

  // Gather all elements (including root) whose textContent matches
  const candidates = [root, ...root.querySelectorAll('*')];

  for (const el of candidates) {
    if (el.hasAttribute(DONE_ATTR)) continue;

    const text = el.textContent;
    if (CONTAINER_PATTERNS.some(p => p.test(text))) {
      // Only act on the INNERMOST matching element to avoid redundant work.
      // An element is "innermost" if none of its children also match.
      const childMatches = [...el.children].some(child =>
        CONTAINER_PATTERNS.some(p => p.test(child.textContent))
      );
      if (!childMatches) {
        applyHighlight(el);
      }
    }
  }
}

// ── Initial scans (with delays for React render) ────────────────────────────

scan(document.body);
setTimeout(() => scan(document.body), 1500);
setTimeout(() => scan(document.body), 4000);

// ── MutationObserver for infinite scroll / lazy-loaded cards ─────────────────

let debounceTimer = null;
const pendingNodes = new Set();

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        pendingNodes.add(node);
      }
    }
  }

  // Debounce: batch process after DOM settles (50 ms quiet window)
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    for (const node of pendingNodes) scan(node);
    pendingNodes.clear();
  }, 50);
});

observer.observe(document.body, { childList: true, subtree: true });
