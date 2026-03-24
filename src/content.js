/**
 * Livewire Snapshot Extractor — Content Script
 * Runs in the page context to extract Livewire v3 component snapshots.
 */

function extractLivewireSnapshots() {
  const results = {
    version: null,
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    components: [],
    errors: []
  };

  try {
    // Detect Livewire version
    if (window.Livewire) {
      results.version = window.Livewire.version || '3.x';
    }

    // --- Livewire v3: wire:snapshot attribute ---
    const v3Elements = document.querySelectorAll('[wire\\:snapshot]');

    v3Elements.forEach((el, index) => {
      try {
        const snapshotRaw = el.getAttribute('wire:snapshot');
        const snapshot = JSON.parse(snapshotRaw);

        const wireId = el.getAttribute('wire:id') || snapshot?.memo?.id || `component-${index}`;
        const componentName = snapshot?.memo?.name || 'Unknown';
        const effects = snapshot?.effects || {};

        // Extract data/properties
        const data = snapshot?.data || {};

        // Extract child component IDs
        const children = [];
        const childEls = el.querySelectorAll('[wire\\:id]');
        childEls.forEach(child => {
          const childId = child.getAttribute('wire:id');
          if (childId && childId !== wireId) {
            children.push(childId);
          }
        });

        // Build hierarchy path
        let parent = el.parentElement;
        let parentId = null;
        while (parent) {
          if (parent.hasAttribute && parent.hasAttribute('wire:id')) {
            parentId = parent.getAttribute('wire:id');
            break;
          }
          parent = parent.parentElement;
        }

        results.components.push({
          id: wireId,
          name: componentName,
          parentId,
          children,
          data,
          memo: snapshot?.memo || {},
          effects: {
            returns: effects.returns || null,
            dispatches: effects.dispatches || [],
            path: effects.path || null,
            method: effects.method || null,
          },
          snapshot: snapshot,
          domInfo: {
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            classes: Array.from(el.classList).slice(0, 5),
          }
        });
      } catch (err) {
        results.errors.push({
          index,
          message: err.message,
          element: el.tagName
        });
      }
    });

    // --- Livewire v2: window.livewire_app or __livewire_data ---
    if (results.components.length === 0) {
      // Try v2 approach via data attributes
      const v2Elements = document.querySelectorAll('[wire\\:id]');
      v2Elements.forEach((el, index) => {
        try {
          const wireId = el.getAttribute('wire:id');
          const initialData = el.getAttribute('wire:initial-data');

          if (initialData) {
            const parsed = JSON.parse(initialData);
            results.components.push({
              id: wireId,
              name: parsed?.fingerprint?.name || 'Unknown',
              parentId: null,
              children: [],
              data: parsed?.serverMemo?.data || parsed?.data || {},
              memo: parsed?.serverMemo || {},
              effects: {},
              snapshot: parsed,
              domInfo: {
                tagName: el.tagName.toLowerCase(),
                id: el.id || null,
                classes: Array.from(el.classList).slice(0, 5),
              }
            });
            results.version = results.version || '2.x';
          }
        } catch (err) {
          results.errors.push({ index, message: err.message });
        }
      });
    }

    // Try to get Livewire store data if available
    if (window.Livewire && window.Livewire.all) {
      try {
        const allComponents = window.Livewire.all();
        results.runtimeCount = allComponents.length;
      } catch (_) {}
    }

  } catch (err) {
    results.errors.push({ message: err.message, fatal: true });
  }

  return results;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractSnapshots') {
    try {
      const data = extractLivewireSnapshots();
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true; // keep channel open for async
});

// Expose for direct injection fallback
window.__livewireExtractor = extractLivewireSnapshots;
