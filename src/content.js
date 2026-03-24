/**
 * Livewire Snapshot Extractor — Content Script
 * Runs in the page context to extract Livewire v2/v3/v4 component snapshots.
 *
 * Wrapped in a once-guard so repeated executeScript calls (re-extract) never
 * throw "Identifier already declared" errors for top-level const declarations.
 */
if (!window.__livewireExtractorLoaded) {
window.__livewireExtractorLoaded = true;

// ─── Livewire-internal keys that add noise and no AI value ───────────
const MEMO_NOISE_KEYS = new Set([
  'checksum', 'htmlHash', 'dataMeta', 'bindings', '__checksum',
  'updates', 'listeners', 'lazyLoaded', 'navigate', 'rules',
  'messages', 'attributes'
]);

// Properties whose names suggest they are internal Livewire tracking state
const DATA_SKIP_PATTERNS = [
  /^__/,           // __dispatch__, __listeners, etc.
  /^_livewire/,
  /^wire:/,
];

// ─── Slim data pruner ─────────────────────────────────────────────────
/**
 * Recursively prune and truncate a value for context output.
 * @param {*}      val
 * @param {number} depth     current nesting depth
 * @param {object} opts
 * @param {number} opts.maxDepth     stop nesting below this (default 4)
 * @param {number} opts.maxArrayLen  truncate arrays longer than this (default 8)
 * @param {number} opts.maxStrLen    truncate strings longer than this (default 200)
 * @param {number} opts.maxObjKeys   show at most this many object keys (default 20)
 */
function pruneValue(val, depth = 0, opts = {}) {
  const {
    maxDepth    = 4,
    maxArrayLen = 8,
    maxStrLen   = 200,
    maxObjKeys  = 20,
  } = opts;

  if (val === null || val === undefined) return val;

  if (typeof val === 'string') {
    return val.length > maxStrLen ? val.slice(0, maxStrLen) + `…[+${val.length - maxStrLen} chars]` : val;
  }

  if (typeof val !== 'object') return val; // number, bool, etc.

  if (depth >= maxDepth) {
    if (Array.isArray(val)) return `[Array(${val.length})]`;
    const k = Object.keys(val).length;
    return `{Object(${k} key${k !== 1 ? 's' : ''})}`;
  }

  if (Array.isArray(val)) {
    const trimmed = val.slice(0, maxArrayLen).map(v => pruneValue(v, depth + 1, opts));
    if (val.length > maxArrayLen) trimmed.push(`…[+${val.length - maxArrayLen} more]`);
    return trimmed;
  }

  // Plain object
  const keys = Object.keys(val);
  const result = {};
  let count = 0;
  for (const k of keys) {
    if (DATA_SKIP_PATTERNS.some(p => p.test(k))) continue;
    if (count >= maxObjKeys) {
      result[`…`] = `+${keys.length - count} more keys`;
      break;
    }
    result[k] = pruneValue(val[k], depth + 1, opts);
    count++;
  }
  return result;
}

/**
 * Strip Livewire memo to only the fields useful for AI context.
 */
function slimMemo(memo) {
  const keep = {};
  const useful = ['name', 'path', 'method', 'locale', 'children', 'childrenCount'];
  for (const k of useful) {
    if (memo[k] !== undefined && memo[k] !== null && memo[k] !== '') {
      keep[k] = memo[k];
    }
  }
  return keep;
}

// ─── Main extractor ───────────────────────────────────────────────────
function extractLivewireSnapshots(slimMode = true) {
  const results = {
    version: null,
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    components: [],
    errors: [],
  };

  const pruneOpts = slimMode
    ? { maxDepth: 3, maxArrayLen: 5, maxStrLen: 120, maxObjKeys: 15 }
    : { maxDepth: 6, maxArrayLen: 20, maxStrLen: 500, maxObjKeys: 50 };

  try {
    if (window.Livewire) {
      results.version = window.Livewire.version || '3.x';
    }

    // ── Livewire v3 / v4 (wire:snapshot) ────────────────────────────
    const v3Elements = document.querySelectorAll('[wire\\:snapshot]');

    v3Elements.forEach((el, index) => {
      try {
        const snapshotRaw = el.getAttribute('wire:snapshot');
        const rawBytes = new Blob([snapshotRaw]).size;
        const snapshot = JSON.parse(snapshotRaw);

        const wireId   = el.getAttribute('wire:id') || snapshot?.memo?.id || `component-${index}`;
        const memo     = snapshot?.memo || {};
        const effects  = snapshot?.effects || {};
        const rawData  = snapshot?.data || {};

        // Direct child wire:id elements (immediate children only)
        const children = [];
        const childEls = el.querySelectorAll('[wire\\:id]');
        childEls.forEach(child => {
          const childId = child.getAttribute('wire:id');
          if (childId && childId !== wireId) children.push(childId);
        });

        // Parent detection
        let parent = el.parentElement;
        let parentId = null;
        while (parent) {
          if (parent.hasAttribute?.('wire:id')) {
            parentId = parent.getAttribute('wire:id');
            break;
          }
          parent = parent.parentElement;
        }

        const data = slimMode ? pruneValue(rawData, 0, pruneOpts) : rawData;

        results.components.push({
          id:       wireId,
          name:     memo.name || 'Unknown',
          parentId,
          children,
          data,
          memo:     slimMode ? slimMemo(memo) : memo,
          effects:  slimMode ? {
            path:   effects.path   || memo.path   || null,
            method: effects.method || memo.method || null,
          } : effects,
          // raw snapshot only kept when NOT in slim mode
          ...(slimMode ? {} : { snapshot }),
          _meta: {
            rawBytes,
            slimmed: slimMode,
          },
          domInfo: {
            tagName: el.tagName.toLowerCase(),
            id:      el.id || null,
          },
        });
      } catch (err) {
        results.errors.push({ index, message: err.message, element: el.tagName });
      }
    });

    // ── Livewire v2 fallback (wire:initial-data) ─────────────────────
    if (results.components.length === 0) {
      const v2Elements = document.querySelectorAll('[wire\\:id]');
      v2Elements.forEach((el, index) => {
        try {
          const wireId      = el.getAttribute('wire:id');
          const initialData = el.getAttribute('wire:initial-data');
          if (!initialData) return;

          const rawBytes = new Blob([initialData]).size;
          const parsed   = JSON.parse(initialData);
          const rawData  = parsed?.serverMemo?.data || parsed?.data || {};

          results.components.push({
            id:       wireId,
            name:     parsed?.fingerprint?.name || 'Unknown',
            parentId: null,
            children: [],
            data:     slimMode ? pruneValue(rawData, 0, pruneOpts) : rawData,
            memo:     slimMode ? slimMemo(parsed?.serverMemo || {}) : (parsed?.serverMemo || {}),
            effects:  {},
            ...(slimMode ? {} : { snapshot: parsed }),
            _meta: { rawBytes, slimmed: slimMode },
            domInfo: { tagName: el.tagName.toLowerCase(), id: el.id || null },
          });
          results.version = results.version || '2.x';
        } catch (err) {
          results.errors.push({ index, message: err.message });
        }
      });
    }

  } catch (err) {
    results.errors.push({ message: err.message, fatal: true });
  }

  return results;
}

// Expose extractor for direct call via scripting.executeScript
window.__livewireExtractor = extractLivewireSnapshots;

} // end once-guard
