/**
 * Formats extracted Livewire snapshot data into Claude Code context blocks
 */

export function formatForClaudeCode(extractedData, options = {}) {
  const {
    includeFullSnapshot = false,
    selectedIds = null,
    format = 'markdown' // 'markdown' | 'json' | 'compact'
  } = options;

  const components = selectedIds
    ? extractedData.components.filter(c => selectedIds.includes(c.id))
    : extractedData.components;

  if (components.length === 0) {
    return '// No Livewire components found on this page.';
  }

  if (format === 'json') {
    const output = {
      _meta: {
        source: 'Livewire Snapshot Extractor',
        url: extractedData.url,
        title: extractedData.title,
        extractedAt: extractedData.timestamp,
        livewireVersion: extractedData.version,
        componentCount: components.length
      },
      components: components.map(c => includeFullSnapshot ? c : stripSnapshot(c))
    };
    return JSON.stringify(output, null, 2);
  }

  if (format === 'compact') {
    return formatCompact(components, extractedData);
  }

  return formatMarkdown(components, extractedData, includeFullSnapshot);
}

function stripSnapshot(component) {
  const { snapshot, ...rest } = component;
  return rest;
}

function formatMarkdown(components, meta, includeFullSnapshot) {
  const lines = [];

  lines.push('## Livewire Screen Context');
  lines.push('');
  lines.push(`**Page:** ${meta.title}`);
  lines.push(`**URL:** ${meta.url}`);
  lines.push(`**Livewire:** v${meta.version || '?'}`);
  lines.push(`**Components:** ${components.length}`);
  lines.push(`**Extracted at:** ${meta.timestamp}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Build component tree
  const roots = components.filter(c => !c.parentId || !components.find(p => p.id === c.parentId));

  function renderComponent(comp, depth = 0) {
    const indent = '  '.repeat(depth);
    const prefix = depth > 0 ? '└─ ' : '';

    lines.push(`${indent}${prefix}### \`${comp.name}\``);
    lines.push(`${indent}   **ID:** \`${comp.id}\``);

    if (comp.domInfo?.tagName) {
      lines.push(`${indent}   **Element:** \`<${comp.domInfo.tagName}>\``);
    }

    // Data / Properties
    const dataKeys = Object.keys(comp.data || {});
    if (dataKeys.length > 0) {
      lines.push(`${indent}   **Properties:**`);
      lines.push(`${indent}   \`\`\`json`);
      lines.push(indent + '   ' + JSON.stringify(comp.data, null, 2).split('\n').join('\n' + indent + '   '));
      lines.push(`${indent}   \`\`\``);
    } else {
      lines.push(`${indent}   **Properties:** *(none)*`);
    }

    // Memo info (routes, methods, locale, etc.)
    const memoKeys = ['path', 'method', 'locale', 'children'];
    const relevantMemo = {};
    memoKeys.forEach(k => {
      if (comp.memo[k] !== undefined && comp.memo[k] !== null) {
        relevantMemo[k] = comp.memo[k];
      }
    });

    if (Object.keys(relevantMemo).length > 0) {
      lines.push(`${indent}   **Memo:**`);
      lines.push(`${indent}   \`\`\`json`);
      lines.push(indent + '   ' + JSON.stringify(relevantMemo, null, 2).split('\n').join('\n' + indent + '   '));
      lines.push(`${indent}   \`\`\``);
    }

    // Effects
    if (comp.effects?.path) {
      lines.push(`${indent}   **Route:** \`${comp.effects.path}\``);
    }

    if (includeFullSnapshot && comp.snapshot) {
      lines.push(`${indent}   **Full Snapshot:**`);
      lines.push(`${indent}   \`\`\`json`);
      lines.push(indent + '   ' + JSON.stringify(comp.snapshot, null, 2).split('\n').join('\n' + indent + '   '));
      lines.push(`${indent}   \`\`\``);
    }

    lines.push('');

    // Render children
    if (comp.children?.length > 0) {
      comp.children.forEach(childId => {
        const child = components.find(c => c.id === childId);
        if (child) renderComponent(child, depth + 1);
      });
    }
  }

  roots.forEach(root => renderComponent(root, 0));

  return lines.join('\n');
}

function formatCompact(components, meta) {
  const lines = [];
  lines.push(`[Livewire Context | ${meta.url} | ${components.length} component(s)]`);
  lines.push('');

  components.forEach(comp => {
    lines.push(`Component: ${comp.name} (${comp.id})`);
    const dataStr = JSON.stringify(comp.data || {});
    lines.push(`Data: ${dataStr.length > 200 ? dataStr.slice(0, 200) + '...' : dataStr}`);
    lines.push('');
  });

  return lines.join('\n');
}
