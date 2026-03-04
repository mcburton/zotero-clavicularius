/**
 * Zotero Clavicularius
 * Generates and manages clavis citationum (citation keys) for Zotero items.
 *
 * Template tokens:
 *   {auth}        - first author last name, lowercase, no spaces
 *   {Auth}        - first author last name, capitalized
 *   {year}        - 4-digit year (or 'nd' if absent)
 *   {title}       - first N significant title words, CamelCase, no separators
 *   {title_lower} - first N significant title words, lowercase_underscored
 */

const PLUGIN_ID = 'clavicularius@mcburton.net';
const PREF_TEMPLATE = 'extensions.clavicularius.template';
const PREF_TITLE_WORDS = 'extensions.clavicularius.titleWords';

// Translator GUID - stable identifier for the pandoc cite key quick copy format
const PANDOC_TRANSLATOR_ID = 'a7f2e3b1-4c8d-4e9f-b123-5d6e7f8a9b0c';

const DEFAULT_TEMPLATE = '{auth}{year}';
const DEFAULT_TITLE_WORDS = 3;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
  'and', 'or', 'but', 'from', 'into', 'about', 'as', 'is', 'was', 'are',
  'were', 'be', 'been', 'that', 'this', 'it', 'its', 'via', 'de', 'du',
  'des', 'le', 'la', 'les', 'un', 'une'
]);

// --- Key generation ---

function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getAuth(item, capitalize) {
  const creators = item.getCreators();
  if (!creators.length) return '';
  const first = creators[0];
  const name = first.lastName || first.name || first.firstName || '';
  const clean = stripDiacritics(name).replace(/[^a-zA-Z]/g, '');
  if (!clean) return '';
  return capitalize
    ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase()
    : clean.toLowerCase();
}

function getTitleWords(item, n, style) {
  const title = item.getField('title') || '';
  const words = stripDiacritics(title)
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, n);

  if (style === 'camel') {
    return words
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  } else {
    return words.map(w => w.toLowerCase()).join('_');
  }
}

function getYear(item) {
  const date = item.getField('date') || '';
  return date.match(/\d{4}/)?.[0] || 'nd';
}

function generateKey(item) {
  const template = Zotero.Prefs.get(PREF_TEMPLATE) || DEFAULT_TEMPLATE;
  const n = parseInt(Zotero.Prefs.get(PREF_TITLE_WORDS) || DEFAULT_TITLE_WORDS);

  return template
    .replace(/{auth}/g, getAuth(item, false))
    .replace(/{Auth}/g, getAuth(item, true))
    .replace(/{year}/g, getYear(item))
    .replace(/{title}/g, getTitleWords(item, n, 'camel'))
    .replace(/{title_lower}/g, getTitleWords(item, n, 'lower'));
}

// --- Duplicate key resolution ---

// Returns a Set of all citation keys currently in the user library,
// optionally skipping the item with `excludeItemID`.
// Uses the synchronous overload of Zotero.Items.getAll (passing `true` as
// the last argument returns cached objects without awaiting a DB query).
function collectUsedKeys(excludeItemID = null) {
  const libraryID = Zotero.Libraries.userLibraryID;
  const usedKeys = new Set();
  const allItems = Zotero.Items.getAll(libraryID, true, false, true);
  for (const item of allItems) {
    if (!item.isRegularItem()) continue;
    if (excludeItemID !== null && item.id === excludeItemID) continue;
    const key = item.getField('citationKey');
    if (key) usedKeys.add(key);
  }
  return usedKeys;
}

// Given a base key and a Set of already-taken keys, returns the first
// available variant: baseKey, baseKey+'a', baseKey+'b', …
function disambiguateKey(baseKey, usedKeys) {
  if (!usedKeys.has(baseKey)) return baseKey;
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const letter of letters) {
    const candidate = baseKey + letter;
    if (!usedKeys.has(candidate)) return candidate;
  }
  // Extremely unlikely fallback: append numeric suffix
  let i = 2;
  while (usedKeys.has(baseKey + i)) i++;
  return baseKey + i;
}

// --- Item processing ---

// `usedKeys` is a Set of citation keys already committed in this batch.
// If omitted, it is built from the live library (excluding this item).
async function processItem(item, overwrite = false, usedKeys = null) {
  if (!item.isRegularItem()) return false;
  if (!overwrite && item.getField('citationKey')) return false;

  const baseKey = generateKey(item);
  if (!baseKey) return false;

  const keys = usedKeys ?? collectUsedKeys(item.id);
  const key = disambiguateKey(baseKey, keys);

  item.setField('citationKey', key);
  await item.saveTx();

  // Let the caller's usedKeys set know this key is now taken
  if (usedKeys !== null) usedKeys.add(key);

  return true;
}

// --- Backfill ---

async function backfill(overwrite = false) {
  const libraryID = Zotero.Libraries.userLibraryID;
  const allItems = await Zotero.Items.getAll(libraryID);

  // Sort regular items by dateAdded ascending so the earliest item wins the
  // bare key and later items get the a/b/c suffix.
  const items = allItems
    .filter(i => i.isRegularItem())
    .sort((a, b) => {
      const da = a.getField('dateAdded') || '';
      const db = b.getField('dateAdded') || '';
      return da < db ? -1 : da > db ? 1 : a.id - b.id;
    });

  // When overwriting we rebuild all keys from scratch with a clean slate.
  // When backfilling we seed the used-keys set with existing keys so we
  // don't clobber them.
  const usedKeys = new Set();
  if (!overwrite) {
    for (const item of items) {
      const existing = item.getField('citationKey');
      if (existing) usedKeys.add(existing);
    }
  }

  let count = 0;
  for (const item of items) {
    const changed = await processItem(item, overwrite, usedKeys);
    if (changed) count++;
  }
  return count;
}

// --- Notifier (watches for new/modified items) ---

var notifierID;

function registerNotifier() {
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify(event, type, ids) {
        if (type !== 'item' || event !== 'add') return;
        for (const id of ids) {
          const item = Zotero.Items.get(id);
          if (!item) continue;
          // Build the used-keys set once per batch, excluding the new items
          // themselves so they don't block each other unnecessarily.
          const usedKeys = collectUsedKeys(item.id);
          processItem(item, false, usedKeys);
        }
      }
    },
    ['item']
  );
}

// --- Context menu: Regenerate citation key ---

var menuObservers = [];

function registerContextMenu() {
  // Zotero may have multiple windows; register in each one that exists now
  // and in any that open later via the windowMediator observer.
  for (const win of Zotero.getMainWindows()) {
    addMenuItemToWindow(win);
  }

  const observer = {
    observe(subject) {
      addMenuItemToWindow(subject);
    }
  };
  Services.wm.addListener(observer);
  menuObservers.push(observer);
}

function addMenuItemToWindow(win) {
  const doc = win.document;
  if (!doc || doc.getElementById('clavicularius-regen-key')) return;

  const menuitem = doc.createXULElement('menuitem');
  menuitem.id = 'clavicularius-regen-key';
  menuitem.setAttribute('label', 'Regenerate citation key');
  menuitem.addEventListener('command', async () => {
    const items = Zotero.getActiveZoteroPane()
      ?.getSelectedItems()
      ?.filter(i => i.isRegularItem());
    if (!items?.length) return;

    // Build a used-keys set that excludes all selected items so they can
    // freely take each other's base keys (ordered by dateAdded).
    const selectedIDs = new Set(items.map(i => i.id));
    const usedKeys = new Set();
    const libraryID = Zotero.Libraries.userLibraryID;
    const allItems = Zotero.Items.getAll(libraryID, true, false, true);
    for (const item of allItems) {
      if (!item.isRegularItem()) continue;
      if (selectedIDs.has(item.id)) continue;
      const key = item.getField('citationKey');
      if (key) usedKeys.add(key);
    }

    // Process selected items sorted by dateAdded so earlier items win bare keys
    const sorted = [...items].sort((a, b) => {
      const da = a.getField('dateAdded') || '';
      const db = b.getField('dateAdded') || '';
      return da < db ? -1 : da > db ? 1 : a.id - b.id;
    });
    for (const item of sorted) {
      await processItem(item, true, usedKeys);
    }
  });

  const itemmenu = doc.getElementById('zotero-itemmenu');
  if (itemmenu) itemmenu.appendChild(menuitem);
}

function unregisterContextMenu() {
  for (const observer of menuObservers) {
    Services.wm.removeListener(observer);
  }
  menuObservers = [];

  for (const win of Zotero.getMainWindows()) {
    win.document.getElementById('clavicularius-regen-key')?.remove();
  }
}

// --- Pandoc quick copy translator ---

async function registerPandocTranslator(rootURI) {
  // Read the bundled translator file (works with both jar: and file: URIs)
  const response = await fetch(rootURI + 'pandoc-citekey.js');
  const text = await response.text();
  const destPath = PathUtils.join(Zotero.getTranslatorsDirectory().path, 'pandoc-citekey.js');
  await IOUtils.writeUTF8(destPath, text);
  await Zotero.Translators.reinit();
}

async function unregisterPandocTranslator() {
  const destPath = PathUtils.join(Zotero.getTranslatorsDirectory().path, 'pandoc-citekey.js');
  await IOUtils.remove(destPath, { ignoreAbsent: true });
  await Zotero.Translators.reinit();
}

// --- Lifecycle ---

async function startup({ id, version, rootURI }) {
  // Set defaults if prefs are missing or were previously corrupted
  const tmpl = Zotero.Prefs.get(PREF_TEMPLATE);
  if (!tmpl || tmpl === 'undefined') {
    Zotero.Prefs.set(PREF_TEMPLATE, DEFAULT_TEMPLATE);
  }
  const words = Zotero.Prefs.get(PREF_TITLE_WORDS);
  if (!words || words === 'undefined') {
    Zotero.Prefs.set(PREF_TITLE_WORDS, DEFAULT_TITLE_WORDS);
  }

  registerNotifier();
  registerContextMenu();
  await registerPandocTranslator(rootURI);

  // Register preferences pane
  Zotero.PreferencePanes.register({
    pluginID: PLUGIN_ID,
    src: rootURI + 'prefs.xhtml',
    label: 'Clavicularius',
  });

  // Expose API for use from the preferences pane and elsewhere
  Zotero.Clavicularius = {
    backfill,
    generateKey,
    onPrefLoad(event) {
      const win = event.target.ownerGlobal;
      const doc = win.document;

      // Update preview when preference-bound inputs change
      const templateInput = doc.getElementById('citekey-template');
      const titleWordsInput = doc.getElementById('citekey-title-words');

      function updatePreview() {
        const preview = doc.getElementById('citekey-preview');
        try {
          const selected = Zotero.getActiveZoteroPane()?.getSelectedItems();
          if (!selected?.length) {
            preview.textContent = '(select an item to preview)';
            return;
          }
          const item = selected[0];
          if (!item.isRegularItem()) {
            preview.textContent = '(select a regular item to preview)';
            return;
          }
          preview.textContent = generateKey(item);
        } catch (e) {
          preview.textContent = '(error generating preview)';
        }
      }


      // 'syncfrompreference' fires after Zotero populates inputs from prefs (via setTimeout in _syncFromPref)
      // 'input' fires when the user edits the field
      templateInput?.addEventListener('syncfrompreference', updatePreview);
      templateInput?.addEventListener('input', updatePreview);
      titleWordsInput?.addEventListener('syncfrompreference', updatePreview);
      titleWordsInput?.addEventListener('input', updatePreview);

      doc.getElementById('citekey-backfill')
        ?.addEventListener('click', async () => {
          const btn = doc.getElementById('citekey-backfill');
          const status = doc.getElementById('citekey-status');
          btn.disabled = true;
          status.textContent = 'Running\u2026';
          try {
            const count = await backfill(false);
            status.textContent = `Done \u2014 ${count} key${count !== 1 ? 's' : ''} generated.`;
          } catch (e) {
            status.textContent = 'Error: ' + e.message;
          } finally {
            btn.disabled = false;
          }
        });

      doc.getElementById('citekey-rebuild')
        ?.addEventListener('click', async () => {
          const confirmed = Services.prompt.confirm(
            win,
            'Rebuild all citation keys?',
            'This will overwrite existing citation keys for every item in your library. Continue?'
          );
          if (!confirmed) return;

          const btn = doc.getElementById('citekey-rebuild');
          const status = doc.getElementById('citekey-status');
          btn.disabled = true;
          status.textContent = 'Running\u2026';
          try {
            const count = await backfill(true);
            status.textContent = `Done \u2014 ${count} key${count !== 1 ? 's' : ''} updated.`;
          } catch (e) {
            status.textContent = 'Error: ' + e.message;
          } finally {
            btn.disabled = false;
          }
        });

      updatePreview();
    },
  };
}

async function shutdown() {
  Zotero.Notifier.unregisterObserver(notifierID);
  unregisterContextMenu();
  await unregisterPandocTranslator();
  delete Zotero.Clavicularius;
}

function install() {}
function uninstall() {}
