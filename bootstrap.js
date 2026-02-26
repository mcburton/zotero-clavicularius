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

// --- Item processing ---

async function processItem(item, overwrite = false) {
  if (!item.isRegularItem()) return false;
  if (!overwrite && item.getField('citationKey')) return false;

  const key = generateKey(item);
  if (!key) return false;

  item.setField('citationKey', key);
  await item.saveTx();
  return true;
}

// --- Backfill ---

async function backfill(overwrite = false) {
  const libraryID = Zotero.Libraries.userLibraryID;
  const items = await Zotero.Items.getAll(libraryID);
  let count = 0;
  for (const item of items) {
    const changed = await processItem(item, overwrite);
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
          if (item) processItem(item, false);
        }
      }
    },
    ['item']
  );
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

function shutdown() {
  Zotero.Notifier.unregisterObserver(notifierID);
  delete Zotero.Clavicularius;
}

function install() {}
function uninstall() {}
