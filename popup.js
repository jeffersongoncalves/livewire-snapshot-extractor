/**
 * Livewire Snapshot Extractor — Popup Script v2
 * slim mode + payload size display + depth/array controls
 */

let extractedData  = null;
let selectedIds    = new Set();
let currentFormat  = 'markdown';
let slimMode       = true;
let includeRaw     = false;
let pruneOpts      = { maxDepth: 3, maxArrayLen: 5, maxStrLen: 120, maxObjKeys: 15 };

// ── DOM refs ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const elLoading       = $('state-loading');
const elEmpty         = $('state-empty');
const elNoLw          = $('state-no-lw');
const elError         = $('state-error');
const elErrorDesc     = $('error-desc');
const elList          = $('component-list');
const elPageUrl       = $('page-url');
const elPageDot       = document.querySelector('.page-dot');
const elVersionBadge  = $('version-badge');
const elSelectedCount = $('selected-count');
const elStatTotal     = $('stat-total');
const elStatRoots     = $('stat-roots');
const elStatProps     = $('stat-props');
const elStatsBar      = $('stats-bar');
const elToast         = $('toast');
const elToggleSlim    = $('toggle-slim-knob');
const elToggleFull    = $('toggle-full-knob');
const elSizeInfo      = $('size-info');
const elSizeRaw       = $('size-raw');
const elSizeOut       = $('size-out');
const elLoadingTitle  = $('loading-title');
const elSignalList    = $('signal-list');

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.url) elPageUrl.textContent = tab.url;
  });

  // Init slim ON by default
  elToggleSlim.classList.add('on');
  $('toggle-full').style.opacity = '0.35';

  runExtraction();

  $('btn-extract').addEventListener('click', runExtraction);
  $('btn-copy').addEventListener('click', copyToClipboard);
  $('btn-select-all').addEventListener('click', toggleSelectAll);

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFormat = tab.dataset.fmt;
      updateSizeOut();
    });
  });

  $('toggle-slim').addEventListener('click', () => {
    slimMode = !slimMode;
    elToggleSlim.classList.toggle('on', slimMode);
    if (slimMode) { includeRaw = false; elToggleFull.classList.remove('on'); }
    $('toggle-full').style.opacity = slimMode ? '0.35' : '1';
    runExtraction();
  });

  $('toggle-full').addEventListener('click', () => {
    if (slimMode) return;
    includeRaw = !includeRaw;
    elToggleFull.classList.toggle('on', includeRaw);
    updateSizeOut();
  });

  $('depth-range').addEventListener('input', e => {
    pruneOpts.maxDepth = parseInt(e.target.value);
    $('depth-val').textContent = pruneOpts.maxDepth;
    if (extractedData) { rerenderList(); updateSizeOut(); }
  });

  $('arr-range').addEventListener('input', e => {
    pruneOpts.maxArrayLen = parseInt(e.target.value);
    $('arr-val').textContent = pruneOpts.maxArrayLen;
    if (extractedData) { rerenderList(); updateSizeOut(); }
  });

  $('str-range').addEventListener('input', e => {
    pruneOpts.maxStrLen = parseInt(e.target.value);
    $('str-val').textContent = pruneOpts.maxStrLen;
    if (extractedData) updateSizeOut();
  });
});

// ── Livewire detection probe (runs before full injection) ─────────────
// Returns { detected: bool, signals: [{label, found}] }
function probeFunc() {
  const signals = [
    { label: 'window.Livewire',       found: typeof window.Livewire !== 'undefined' },
    { label: 'wire:snapshot in DOM',  found: document.querySelector('[wire\\:snapshot]') !== null },
    { label: 'wire:id in DOM',        found: document.querySelector('[wire\\:id]') !== null },
    { label: 'Livewire script tag',   found: Array.from(document.querySelectorAll('script[src]'))
        .some(s => /livewire/i.test(s.src)) },
    { label: '@livewireScripts',      found: document.querySelector('script[data-livewire-scripts]') !== null
        || /livewire\/livewire\.js/i.test(document.documentElement.innerHTML) },
  ];
  return { detected: signals.some(s => s.found), signals };
}

// ── Extraction ────────────────────────────────────────────────────────
async function runExtraction() {
  showState('loading');
  setDot('scanning');
  elLoadingTitle.textContent = 'Detecting Livewire...';
  selectedIds.clear();
  extractedData = null;
  elSizeInfo.style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');
    elPageUrl.textContent = tab.url || '';

    // ── Step 1: fast probe — no full script injection yet ──────────────
    const [{ result: probe }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: probeFunc,
    });

    if (!probe.detected) {
      setDot('no-lw');
      renderSignals(probe.signals);
      showState('no-lw');
      return;
    }

    // ── Step 2: Livewire confirmed — run full extraction ───────────────
    elLoadingTitle.textContent = 'Extracting components...';

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content.js'],
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (slim) => window.__livewireExtractor?.(slim) ?? null,
      args: [slimMode],
    });

    if (!result) throw new Error('Extractor not available on this page');
    if (result.errors?.some(e => e.fatal)) throw new Error(result.errors[0].message);

    extractedData = result;

    if (!extractedData.components?.length) {
      setDot('no-lw');
      showState('empty');
      return;
    }

    setDot('found');
    updateVersionBadge(extractedData.version);
    renderComponents(extractedData.components);
    extractedData.components.forEach(c => selectedIds.add(c.id));
    updateSelectedCount();
    updateStats();
    updateSizeInfo();
    showState('list');
  } catch (err) {
    setDot('no-lw');
    elErrorDesc.textContent = err.message || String(err);
    showState('error');
  }
}

function setDot(state) {
  elPageDot.className = 'page-dot ' + state;
}

function renderSignals(signals) {
  elSignalList.innerHTML = '';
  signals.forEach(({ label, found }) => {
    const row = document.createElement('div');
    row.className = 'signal-row';
    const dot = document.createElement('span');
    dot.className = 'signal-dot ' + (found ? 'found' : 'missing');
    const txt = document.createElement('span');
    txt.textContent = label;
    txt.style.color = found ? 'var(--green)' : 'var(--text3)';
    row.append(dot, txt);
    elSignalList.appendChild(row);
  });
}

function rerenderList() {
  if (!extractedData) return;
  // Remember which were selected
  const wasSelected = new Set(selectedIds);
  renderComponents(extractedData.components);
  // Restore checkboxes
  elList.querySelectorAll('.component-card').forEach(card => {
    const id = card.dataset.id;
    const cb = card.querySelector('.card-checkbox');
    const sel = wasSelected.has(id);
    if (cb) cb.checked = sel;
    card.classList.toggle('selected', sel);
  });
  updateStats();
}

// ── Rendering ─────────────────────────────────────────────────────────
function renderComponents(components) {
  elList.innerHTML = '';
  const compMap = {};
  components.forEach(c => { compMap[c.id] = c; });
  const roots = components.filter(c => !c.parentId || !compMap[c.parentId]);

  function render(comp, depth) {
    elList.appendChild(createCard(comp, depth));
    comp.children?.forEach(cid => {
      if (compMap[cid]) render(compMap[cid], depth + 1);
    });
  }

  roots.forEach(r => render(r, 0));
}

function createCard(comp, depth) {
  const data      = clientPrune(comp.data || {}, 0);
  const propCount = Object.keys(data).length;
  const rawKB     = comp._meta?.rawBytes ? (comp._meta.rawBytes / 1024).toFixed(1) : null;
  const isChild   = depth > 0;

  const card = document.createElement('div');
  card.className = `component-card${isChild ? ' child' : ''} selected`;
  card.dataset.id = comp.id;

  const header = document.createElement('div');
  header.className = 'card-header';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'card-checkbox';
  checkbox.checked = true;
  checkbox.addEventListener('change', e => {
    e.stopPropagation();
    toggleComponent(comp.id, e.target.checked, card);
  });

  const icon = document.createElement('div');
  icon.className = `card-icon ${isChild ? 'card-icon-child' : 'card-icon-lw'}`;
  icon.textContent = isChild ? '◦' : '⚡';

  const nw = document.createElement('div');
  nw.style.cssText = 'flex:1;overflow:hidden;min-width:0';

  const nm = document.createElement('div');
  nm.className = 'card-name';
  nm.textContent = shortName(comp.name);

  const idEl = document.createElement('div');
  idEl.className = 'card-id';
  idEl.textContent = `#${comp.id.slice(0, 8)}`;

  nw.append(nm, idEl);

  const pc = document.createElement('span');
  pc.className = 'card-props-count';
  pc.textContent = `${propCount}p`;

  header.append(checkbox, icon, nw, pc);

  if (rawKB) {
    const sz = document.createElement('span');
    const kb = parseFloat(rawKB);
    sz.className = `card-props-count${kb > 20 ? ' size-big' : kb > 5 ? ' size-med' : ''}`;
    sz.title = 'Raw snapshot size before slimming';
    sz.textContent = `${rawKB}KB`;
    header.appendChild(sz);
  }

  const expand = document.createElement('span');
  expand.className = 'card-expand';
  expand.textContent = '▶';
  header.appendChild(expand);

  const body = document.createElement('div');
  body.className = 'card-body';

  if (propCount > 0) {
    const sec = makeSec('⬡ Properties');
    const tree = document.createElement('div');
    tree.className = 'data-tree';
    tree.innerHTML = renderTree(data);
    sec.appendChild(tree);
    body.appendChild(sec);
  }

  const memoItems = buildMemoItems(comp);
  if (memoItems.length > 0) {
    const sec = makeSec('⊡ Info');
    const grid = document.createElement('div');
    grid.className = 'memo-grid';
    memoItems.forEach(([k, v, cls]) => {
      const ke = document.createElement('div'); ke.className = 'memo-key'; ke.textContent = k;
      const ve = document.createElement('div'); ve.className = `memo-val${cls ? ' '+cls : ''}`; ve.textContent = v;
      grid.append(ke, ve);
    });
    sec.appendChild(grid);
    body.appendChild(sec);
  }

  header.addEventListener('click', e => {
    if (e.target === checkbox) return;
    const open = body.classList.toggle('open');
    expand.classList.toggle('open', open);
  });

  card.append(header, body);
  return card;
}

function makeSec(label) {
  const s = document.createElement('div');
  s.className = 'card-section';
  const l = document.createElement('div');
  l.className = 'section-label';
  l.textContent = label;
  s.appendChild(l);
  return s;
}

function buildMemoItems(comp) {
  const items = [];
  const m = comp.memo || {};
  if (m.name) items.push(['Class', m.name, null]);
  const route = comp.memo?.path || comp.effects?.path;
  if (route) items.push(['Route', route, null]);
  const method = comp.memo?.method || comp.effects?.method;
  if (method) items.push(['Method', method.toUpperCase(), 'method']);
  if (m.locale) items.push(['Locale', m.locale, null]);
  if (comp.domInfo?.tagName) items.push(['Tag', `<${comp.domInfo.tagName}>`, null]);
  if (comp.children?.length > 0) items.push(['Children', String(comp.children.length), null]);
  return items;
}

// ── Client-side pruning (mirrors content.js logic) ────────────────────
function clientPrune(val, depth) {
  const { maxDepth, maxArrayLen, maxStrLen, maxObjKeys } = pruneOpts;
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val.length > maxStrLen ? val.slice(0, maxStrLen) + `…[+${val.length - maxStrLen}]` : val;
  }
  if (typeof val !== 'object') return val;
  if (depth >= maxDepth) {
    return Array.isArray(val) ? `[Array(${val.length})]` : `{Object(${Object.keys(val).length} keys)}`;
  }
  if (Array.isArray(val)) {
    const t = val.slice(0, maxArrayLen).map(v => clientPrune(v, depth + 1));
    if (val.length > maxArrayLen) t.push(`…+${val.length - maxArrayLen} more`);
    return t;
  }
  const keys = Object.keys(val);
  const r = {}; let c = 0;
  for (const k of keys) {
    if (c >= maxObjKeys) { r['…'] = `+${keys.length - c} more`; break; }
    r[k] = clientPrune(val[k], depth + 1);
    c++;
  }
  return r;
}

function renderTree(data, depth = 0) {
  if (data === null || data === undefined) return `<span class="prop-null">null</span>`;
  if (typeof data === 'string') return `<span class="prop-string">${esc(JSON.stringify(data))}</span>`;
  if (typeof data === 'number') return `<span class="prop-number">${data}</span>`;
  if (typeof data === 'boolean') return `<span class="prop-bool">${data}</span>`;
  if (Array.isArray(data)) {
    if (!data.length) return `<span class="prop-arr">[]</span>`;
    const items = data.map((v, i) =>
      `<div style="padding-left:${(depth+1)*10}px"><span class="prop-number">${i}</span>: ${renderTree(v, depth+1)}</div>`
    ).join('');
    return `<span class="prop-arr">[</span>${items}<span class="prop-arr">]</span>`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (!keys.length) return `<span class="prop-obj">{}</span>`;
    const items = keys.map(k =>
      `<div style="padding-left:${(depth+1)*10}px"><span class="prop-key">${esc(k)}</span>: ${renderTree(data[k], depth+1)}</div>`
    ).join('');
    return `<span class="prop-obj">{</span>${items}<span class="prop-obj">}</span>`;
  }
  return esc(String(data));
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shortName(name) {
  if (!name) return 'Unknown';
  return name.replace(/\\/g, '/').split('/').pop() || name;
}

// ── Selection ─────────────────────────────────────────────────────────
function toggleComponent(id, checked, card) {
  checked ? selectedIds.add(id) : selectedIds.delete(id);
  card.classList.toggle('selected', checked);
  updateSelectedCount();
  updateSizeOut();
}

let allSelected = true;
function toggleSelectAll() {
  allSelected = !allSelected;
  elList.querySelectorAll('.component-card').forEach(card => {
    const id = card.dataset.id;
    const cb = card.querySelector('.card-checkbox');
    allSelected ? selectedIds.add(id) : selectedIds.delete(id);
    card.classList.toggle('selected', allSelected);
    if (cb) cb.checked = allSelected;
  });
  updateSelectedCount();
  updateSizeOut();
  $('btn-select-all').textContent = allSelected ? 'None' : 'All';
}

function updateSelectedCount() { elSelectedCount.textContent = selectedIds.size; }

function updateStats() {
  if (!extractedData) return;
  const c = extractedData.components;
  const roots = c.filter(x => !x.parentId || !c.find(p => p.id === x.parentId));
  const props = c.reduce((a, x) => a + Object.keys(x.data || {}).length, 0);
  elStatTotal.textContent = c.length;
  elStatRoots.textContent = roots.length;
  elStatProps.textContent = props;
  elStatsBar.style.display = 'flex';
}

function updateSizeInfo() {
  if (!extractedData?.components?.length) return;
  const raw = extractedData.components.reduce((a, c) => a + (c._meta?.rawBytes || 0), 0);
  elSizeRaw.textContent = formatBytes(raw);
  elSizeInfo.style.display = 'flex';
  updateSizeOut();
}

function updateSizeOut() {
  if (!extractedData) return;
  const out = buildOutput();
  const bytes = new Blob([out]).size;
  elSizeOut.textContent = formatBytes(bytes);

  // Color coding
  const wrap = $('size-out-wrap');
  if (wrap) {
    wrap.className = 'size-val ' + (bytes > 60000 ? 'size-big' : bytes > 20000 ? 'size-med' : 'size-ok');
  }
}

function formatBytes(b) {
  if (!b) return '0B';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)}KB`;
  return `${(b/1048576).toFixed(2)}MB`;
}

// ── Output formatting ─────────────────────────────────────────────────
async function copyToClipboard() {
  if (!extractedData || !selectedIds.size) {
    showToast('No components selected!', true); return;
  }
  const output = buildOutput();
  try {
    await navigator.clipboard.writeText(output);
    showToast(`✓ ${formatBytes(new Blob([output]).size)} copiado!`);
  } catch {
    const el = document.createElement('textarea');
    el.value = output;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('✓ Copiado!');
  }
}

function showToast(msg, err = false) {
  elToast.textContent = msg;
  elToast.style.background = err ? 'var(--red)' : 'var(--green)';
  elToast.classList.add('show');
  setTimeout(() => elToast.classList.remove('show'), 2200);
}

function buildOutput() {
  if (!extractedData) return '';
  const components = extractedData.components.filter(c => selectedIds.has(c.id));
  if (!components.length) return '// No components selected.';

  const compMap = {};
  extractedData.components.forEach(c => { compMap[c.id] = c; });

  if (currentFormat === 'json') {
    return JSON.stringify({
      _meta: {
        source: 'Livewire Snapshot Extractor',
        url: extractedData.url,
        title: extractedData.title,
        extractedAt: extractedData.timestamp,
        livewireVersion: extractedData.version,
        slimMode,
        pruneOpts: slimMode ? pruneOpts : null,
        componentCount: components.length,
      },
      components: components.map(c => {
        const { snapshot, _meta, ...rest } = c;
        const data = slimMode ? clientPrune(c.data || {}, 0) : c.data || {};
        const out = { ...rest, data };
        if (includeRaw && snapshot) out.snapshot = snapshot;
        return out;
      }),
    }, null, 2);
  }

  if (currentFormat === 'compact') {
    const lines = [`[Livewire | ${extractedData.url} | ${components.length} component(s)]`, ''];
    components.forEach(c => {
      const d = JSON.stringify(slimMode ? clientPrune(c.data || {}, 0) : c.data || {});
      lines.push(`${shortName(c.name)} (${c.id.slice(0,8)}): ${d.length > 200 ? d.slice(0,200)+'…' : d}`);
    });
    return lines.join('\n');
  }

  // ── Markdown ──
  const roots = components.filter(c => !c.parentId || !compMap[c.parentId]);
  const lines = [
    '## Livewire Screen Context',
    '',
    `> **Page:** ${extractedData.title}  `,
    `> **URL:** \`${extractedData.url}\`  `,
    `> **Livewire:** v${extractedData.version || '?'} · **Components:** ${components.length}${slimMode ? ' · slim mode' : ''}`,
    '',
    '---',
    '',
  ];

  function renderMD(comp, depth) {
    const ind   = '  '.repeat(depth);
    const hLvl  = depth === 0 ? '###' : '####';
    const sn    = shortName(comp.name);
    const data  = slimMode ? clientPrune(comp.data || {}, 0) : comp.data || {};
    const keys  = Object.keys(data);
    const route = comp.memo?.path || comp.effects?.path;
    const meth  = (comp.memo?.method || comp.effects?.method || 'GET').toUpperCase();

    lines.push(`${ind}${hLvl} \`${sn}\``);
    lines.push('');
    if (comp.memo?.name && comp.memo.name !== sn) lines.push(`${ind}**Class:** \`${comp.memo.name}\``);
    lines.push(`${ind}**ID:** \`${comp.id}\``);
    if (route) lines.push(`${ind}**Route:** \`${meth} ${route}\``);
    lines.push('');

    if (keys.length) {
      lines.push(`${ind}**Properties:**`);
      lines.push(`${ind}\`\`\`json`);
      JSON.stringify(data, null, 2).split('\n').forEach(l => lines.push(ind + l));
      lines.push(`${ind}\`\`\``);
    } else {
      lines.push(`${ind}**Properties:** *(none)*`);
    }
    lines.push('');

    comp.children?.forEach(cid => {
      if (compMap[cid] && components.find(c => c.id === cid)) renderMD(compMap[cid], depth + 1);
    });
  }

  roots.forEach(r => renderMD(r, 0));
  return lines.join('\n');
}

// ── States ────────────────────────────────────────────────────────────
function showState(state) {
  elLoading.style.display = 'none';
  elEmpty.style.display   = 'none';
  elNoLw.style.display    = 'none';
  elError.style.display   = 'none';
  elList.style.display    = 'none';

  ({ loading: () => elLoading.style.display = 'flex',
     empty:   () => elEmpty.style.display   = 'flex',
     'no-lw': () => elNoLw.style.display    = 'flex',
     error:   () => elError.style.display   = 'flex',
     list:    () => { elList.style.display = 'flex'; elList.style.flexDirection = 'column'; }
  })[state]?.();
}

function updateVersionBadge(version) {
  elVersionBadge.textContent = version ? `LW v${version}` : 'Livewire';
  const cls = version?.startsWith('2') ? 'badge-v2'
            : version?.startsWith('4') ? 'badge-v4'
            : 'badge-lw';
  elVersionBadge.className = 'badge ' + cls;
}
