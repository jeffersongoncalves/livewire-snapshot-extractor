/**
 * Livewire Snapshot Extractor — Popup Script
 */

let extractedData = null;
let selectedIds = new Set();
let currentFormat = 'markdown';
let includeFullSnapshot = false;

// ── DOM refs ──────────────────────────────────────────────────────────
const elMain         = document.getElementById('main');
const elLoading      = document.getElementById('state-loading');
const elEmpty        = document.getElementById('state-empty');
const elError        = document.getElementById('state-error');
const elErrorDesc    = document.getElementById('error-desc');
const elList         = document.getElementById('component-list');
const elPageUrl      = document.getElementById('page-url');
const elVersionBadge = document.getElementById('version-badge');
const elSelectedCount = document.getElementById('selected-count');
const elStatTotal    = document.getElementById('stat-total');
const elStatRoots    = document.getElementById('stat-roots');
const elStatProps    = document.getElementById('stat-props');
const elStatsBar     = document.getElementById('stats-bar');
const elToast        = document.getElementById('toast');
const elToggleKnob   = document.getElementById('toggle-full-knob');

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set page URL immediately
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.url) {
      elPageUrl.textContent = tab.url;
    }
  });

  // Start extraction
  runExtraction();

  // Buttons
  document.getElementById('btn-extract').addEventListener('click', runExtraction);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('btn-select-all').addEventListener('click', toggleSelectAll);

  // Format tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFormat = tab.dataset.fmt;
    });
  });

  // Full snapshot toggle
  document.getElementById('toggle-full').addEventListener('click', () => {
    includeFullSnapshot = !includeFullSnapshot;
    elToggleKnob.classList.toggle('on', includeFullSnapshot);
  });
});

// ── Extraction ────────────────────────────────────────────────────────
async function runExtraction() {
  showState('loading');
  selectedIds.clear();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

    elPageUrl.textContent = tab.url || '';

    // Inject content script if needed, then message it
    let response = null;

    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extractSnapshots' });
    } catch {
      // Content script not loaded — inject and retry
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content.js']
      });
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extractSnapshots' });
    }

    if (!response?.success) {
      throw new Error(response?.error || 'Extraction failed');
    }

    extractedData = response.data;

    if (!extractedData.components || extractedData.components.length === 0) {
      showState('empty');
      return;
    }

    // Update version badge
    updateVersionBadge(extractedData.version);

    // Render component list
    renderComponents(extractedData.components);

    // Select all by default
    extractedData.components.forEach(c => selectedIds.add(c.id));
    updateSelectedCount();
    updateStats();

    showState('list');

  } catch (err) {
    elErrorDesc.textContent = err.message || String(err);
    showState('error');
  }
}

// ── Rendering ─────────────────────────────────────────────────────────
function renderComponents(components) {
  elList.innerHTML = '';

  // Build component map
  const compMap = {};
  components.forEach(c => { compMap[c.id] = c; });

  // Find roots (no parent in this set)
  const roots = components.filter(c => !c.parentId || !compMap[c.parentId]);

  function renderCard(comp, depth = 0) {
    const card = createComponentCard(comp, depth);
    elList.appendChild(card);

    // Render children
    if (comp.children?.length > 0) {
      comp.children.forEach(childId => {
        const child = compMap[childId];
        if (child) renderCard(child, depth + 1);
      });
    }
  }

  roots.forEach(r => renderCard(r, 0));
}

function createComponentCard(comp, depth) {
  const propCount = Object.keys(comp.data || {}).length;
  const isChild = depth > 0;

  const card = document.createElement('div');
  card.className = `component-card${isChild ? ' child' : ''} selected`;
  card.dataset.id = comp.id;

  // Header
  const header = document.createElement('div');
  header.className = 'card-header';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'card-checkbox';
  checkbox.checked = true;
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    toggleComponent(comp.id, e.target.checked, card);
  });

  const icon = document.createElement('div');
  icon.className = `card-icon ${isChild ? 'card-icon-child' : 'card-icon-lw'}`;
  icon.textContent = isChild ? '◦' : '⚡';

  const nameWrap = document.createElement('div');
  nameWrap.style.flex = '1';
  nameWrap.style.overflow = 'hidden';

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = formatComponentName(comp.name);

  const idEl = document.createElement('div');
  idEl.className = 'card-id';
  idEl.textContent = `#${comp.id.slice(0, 8)}`;

  nameWrap.appendChild(name);
  nameWrap.appendChild(idEl);

  const propsCount = document.createElement('span');
  propsCount.className = 'card-props-count';
  propsCount.textContent = `${propCount} prop${propCount !== 1 ? 's' : ''}`;

  const expand = document.createElement('span');
  expand.className = 'card-expand';
  expand.textContent = '▶';

  header.appendChild(checkbox);
  header.appendChild(icon);
  header.appendChild(nameWrap);
  header.appendChild(propsCount);
  header.appendChild(expand);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';

  // Data section
  if (propCount > 0) {
    const dataSection = document.createElement('div');
    dataSection.className = 'card-section';

    const label = document.createElement('div');
    label.className = 'section-label';
    label.innerHTML = '⬡ Properties';
    dataSection.appendChild(label);

    const tree = document.createElement('div');
    tree.className = 'data-tree';
    tree.innerHTML = renderDataTree(comp.data);
    dataSection.appendChild(tree);
    body.appendChild(dataSection);
  }

  // Memo section
  const memoItems = buildMemoItems(comp);
  if (memoItems.length > 0) {
    const memoSection = document.createElement('div');
    memoSection.className = 'card-section';

    const label = document.createElement('div');
    label.className = 'section-label';
    label.innerHTML = '⊡ Component Info';
    memoSection.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'memo-grid';

    memoItems.forEach(([key, val, cls]) => {
      const k = document.createElement('div');
      k.className = 'memo-key';
      k.textContent = key;

      const v = document.createElement('div');
      v.className = `memo-val${cls ? ' ' + cls : ''}`;
      v.textContent = val;

      grid.appendChild(k);
      grid.appendChild(v);
    });

    memoSection.appendChild(grid);
    body.appendChild(memoSection);
  }

  // Toggle expand
  header.addEventListener('click', (e) => {
    if (e.target === checkbox) return;
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    expand.classList.toggle('open', !isOpen);
  });

  card.appendChild(header);
  card.appendChild(body);

  return card;
}

function formatComponentName(name) {
  if (!name) return 'UnknownComponent';
  // App\Livewire\Dashboard\UserStats → UserStats
  const parts = name.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || name;
}

function buildMemoItems(comp) {
  const items = [];
  const m = comp.memo || {};

  if (m.name) items.push(['Component', m.name, null]);
  if (m.path) items.push(['Route', m.path, null]);
  if (m.method) items.push(['Method', m.method, 'method']);
  if (m.locale) items.push(['Locale', m.locale, null]);
  if (comp.domInfo?.tagName) items.push(['Element', `<${comp.domInfo.tagName}>`, null]);
  if (comp.children?.length > 0) items.push(['Children', comp.children.length.toString(), null]);

  return items;
}

function renderDataTree(data, depth = 0) {
  if (data === null || data === undefined) {
    return `<span class="prop-null">null</span>`;
  }

  if (typeof data === 'string') {
    const escaped = escapeHtml(JSON.stringify(data));
    return `<span class="prop-string">${escaped}</span>`;
  }

  if (typeof data === 'number') {
    return `<span class="prop-number">${data}</span>`;
  }

  if (typeof data === 'boolean') {
    return `<span class="prop-bool">${data}</span>`;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return `<span class="prop-arr">[]</span>`;
    if (depth > 1) return `<span class="prop-arr">[Array(${data.length})]</span>`;
    const items = data.slice(0, 5).map((v, i) =>
      `<div style="padding-left:${(depth + 1) * 12}px"><span class="prop-number">${i}</span>: ${renderDataTree(v, depth + 1)}</div>`
    ).join('');
    const more = data.length > 5 ? `<div style="padding-left:${(depth + 1) * 12}px"><span class="prop-null">... ${data.length - 5} more</span></div>` : '';
    return `<span class="prop-arr">[</span>${items}${more}<span class="prop-arr">]</span>`;
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) return `<span class="prop-obj">{}</span>`;
    if (depth > 1) return `<span class="prop-obj">{Object(${keys.length})}</span>`;
    const items = keys.slice(0, 10).map(k =>
      `<div style="padding-left:${(depth + 1) * 12}px"><span class="prop-key">${escapeHtml(k)}</span>: ${renderDataTree(data[k], depth + 1)}</div>`
    ).join('');
    const more = keys.length > 10 ? `<div style="padding-left:${(depth + 1) * 12}px"><span class="prop-null">... ${keys.length - 10} more keys</span></div>` : '';
    return `<span class="prop-obj">{</span>${items}${more}<span class="prop-obj">}</span>`;
  }

  return escapeHtml(String(data));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Selection ─────────────────────────────────────────────────────────
function toggleComponent(id, checked, card) {
  if (checked) {
    selectedIds.add(id);
    card.classList.add('selected');
  } else {
    selectedIds.delete(id);
    card.classList.remove('selected');
  }
  updateSelectedCount();
}

let allSelected = true;
function toggleSelectAll() {
  allSelected = !allSelected;
  const cards = elList.querySelectorAll('.component-card');
  cards.forEach(card => {
    const id = card.dataset.id;
    const cb = card.querySelector('.card-checkbox');
    if (allSelected) {
      selectedIds.add(id);
      card.classList.add('selected');
      if (cb) cb.checked = true;
    } else {
      selectedIds.delete(id);
      card.classList.remove('selected');
      if (cb) cb.checked = false;
    }
  });
  updateSelectedCount();
  document.getElementById('btn-select-all').textContent = allSelected ? 'None' : 'All';
}

function updateSelectedCount() {
  elSelectedCount.textContent = selectedIds.size;
}

function updateStats() {
  if (!extractedData) return;
  const comps = extractedData.components;
  const roots = comps.filter(c => !c.parentId || !comps.find(p => p.id === c.parentId));
  const totalProps = comps.reduce((acc, c) => acc + Object.keys(c.data || {}).length, 0);

  elStatTotal.textContent = comps.length;
  elStatRoots.textContent = roots.length;
  elStatProps.textContent = totalProps;
  elStatsBar.style.display = 'flex';
}

// ── Copy ──────────────────────────────────────────────────────────────
async function copyToClipboard() {
  if (!extractedData || selectedIds.size === 0) {
    showToast('No components selected!', true);
    return;
  }

  const output = formatForClaudeCode(extractedData, {
    includeFullSnapshot,
    selectedIds: Array.from(selectedIds),
    format: currentFormat
  });

  try {
    await navigator.clipboard.writeText(output);
    showToast('✓ Copied to clipboard!');
  } catch {
    // Fallback
    const el = document.createElement('textarea');
    el.value = output;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('✓ Copied!');
  }
}

function showToast(msg, error = false) {
  elToast.textContent = msg;
  elToast.style.background = error ? 'var(--red)' : 'var(--green)';
  elToast.classList.add('show');
  setTimeout(() => elToast.classList.remove('show'), 2000);
}

// ── Formatting ────────────────────────────────────────────────────────
function formatForClaudeCode(data, options = {}) {
  const { includeFullSnapshot = false, selectedIds = null, format = 'markdown' } = options;

  const components = selectedIds
    ? data.components.filter(c => selectedIds.includes(c.id))
    : data.components;

  if (components.length === 0) return '// No Livewire components selected.';

  if (format === 'json') {
    return JSON.stringify({
      _meta: {
        source: 'Livewire Snapshot Extractor',
        url: data.url,
        title: data.title,
        extractedAt: data.timestamp,
        livewireVersion: data.version,
        componentCount: components.length
      },
      components: components.map(c => includeFullSnapshot ? c : withoutSnapshot(c))
    }, null, 2);
  }

  if (format === 'compact') {
    const lines = [
      `[Livewire Context | ${data.url} | ${components.length} component(s)]`,
      ''
    ];
    components.forEach(c => {
      lines.push(`Component: ${c.name} (${c.id})`);
      const d = JSON.stringify(c.data || {});
      lines.push(`Data: ${d.length > 300 ? d.slice(0, 300) + '...' : d}`);
      lines.push('');
    });
    return lines.join('\n');
  }

  // Markdown
  const lines = [
    '## Livewire Screen Context',
    '',
    `> **Page:** ${data.title}`,
    `> **URL:** \`${data.url}\``,
    `> **Livewire:** v${data.version || '?'} | **Components:** ${components.length} | **Extracted:** ${data.timestamp}`,
    '',
    '---',
    ''
  ];

  const compMap = {};
  data.components.forEach(c => { compMap[c.id] = c; });
  const roots = components.filter(c => !c.parentId || !compMap[c.parentId]);

  function renderMD(comp, depth = 0) {
    const indent = '  '.repeat(depth);
    const hLevel = depth === 0 ? '###' : '####';
    const shortName = formatComponentName(comp.name);

    lines.push(`${indent}${hLevel} \`${shortName}\``);
    lines.push('');

    if (comp.memo?.name && comp.memo.name !== shortName) {
      lines.push(`${indent}**Class:** \`${comp.memo.name}\``);
    }

    lines.push(`${indent}**ID:** \`${comp.id}\``);

    if (comp.memo?.path) {
      lines.push(`${indent}**Route:** \`${comp.memo.method?.toUpperCase() || 'GET'} ${comp.memo.path}\``);
    }

    lines.push('');

    const propKeys = Object.keys(comp.data || {});
    if (propKeys.length > 0) {
      lines.push(`${indent}**Properties:**`);
      lines.push('');
      lines.push(`${indent}\`\`\`json`);
      lines.push(JSON.stringify(comp.data, null, 2).split('\n').map(l => indent + l).join('\n'));
      lines.push(`${indent}\`\`\``);
    } else {
      lines.push(`${indent}**Properties:** *(none)*`);
    }

    lines.push('');

    if (includeFullSnapshot && comp.snapshot) {
      lines.push(`${indent}<details>`);
      lines.push(`${indent}<summary>Full Snapshot</summary>`);
      lines.push('');
      lines.push(`${indent}\`\`\`json`);
      lines.push(JSON.stringify(comp.snapshot, null, 2).split('\n').map(l => indent + l).join('\n'));
      lines.push(`${indent}\`\`\``);
      lines.push(`${indent}</details>`);
      lines.push('');
    }

    if (comp.children?.length > 0) {
      comp.children.forEach(childId => {
        const child = compMap[childId];
        if (child && components.find(c => c.id === childId)) {
          renderMD(child, depth + 1);
        }
      });
    }
  }

  roots.forEach(r => renderMD(r, 0));

  return lines.join('\n');
}

function withoutSnapshot(comp) {
  const { snapshot, ...rest } = comp;
  return rest;
}

function formatComponentName(name) {
  if (!name) return 'UnknownComponent';
  const parts = name.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || name;
}

// ── States ────────────────────────────────────────────────────────────
function showState(state) {
  elLoading.style.display = 'none';
  elEmpty.style.display = 'none';
  elError.style.display = 'none';
  elList.style.display = 'none';

  if (state === 'loading') elLoading.style.display = 'flex';
  else if (state === 'empty') elEmpty.style.display = 'flex';
  else if (state === 'error') elError.style.display = 'flex';
  else if (state === 'list') elList.style.display = 'flex', elList.style.flexDirection = 'column';
}

function updateVersionBadge(version) {
  elVersionBadge.textContent = version ? `LW v${version}` : 'Livewire';
  elVersionBadge.className = 'badge';
  if (!version) {
    elVersionBadge.classList.add('badge-lw');
  } else if (version.startsWith('2')) {
    elVersionBadge.classList.add('badge-v2');
  } else {
    elVersionBadge.classList.add('badge-lw');
  }
}
