window.ClaviculariusPrefs = {
  PREF_TEMPLATE: 'extensions.clavicularius.template',
  PREF_TITLE_WORDS: 'extensions.clavicularius.titleWords',
  DEFAULT_TEMPLATE: '{auth}{year}',
  DEFAULT_TITLE_WORDS: 3,

  init() {
    // Load saved prefs into inputs
    const templateInput = document.getElementById('citekey-template');
    const titleWordsInput = document.getElementById('citekey-title-words');

    templateInput.value =
      Zotero.Prefs.get(this.PREF_TEMPLATE) || this.DEFAULT_TEMPLATE;
    titleWordsInput.value =
      Zotero.Prefs.get(this.PREF_TITLE_WORDS) || this.DEFAULT_TITLE_WORDS;

    // Save to prefs and update preview on change
    templateInput.addEventListener('input', () => {
      Zotero.Prefs.set(this.PREF_TEMPLATE, templateInput.value);
      this.updatePreview();
    });
    titleWordsInput.addEventListener('input', () => {
      Zotero.Prefs.set(this.PREF_TITLE_WORDS, parseInt(titleWordsInput.value));
      this.updatePreview();
    });

    document.getElementById('citekey-backfill')
      .addEventListener('click', () => this.runBackfill(false));
    document.getElementById('citekey-rebuild')
      .addEventListener('click', () => this.runRebuild());

    this.updatePreview();
  },

  updatePreview() {
    const preview = document.getElementById('citekey-preview');
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
      preview.textContent = Zotero.Clavicularius.generateKey(item);
    } catch (e) {
      preview.textContent = '(error generating preview)';
    }
  },

  setStatus(msg) {
    document.getElementById('citekey-status').textContent = msg;
  },

  async runBackfill(overwrite) {
    const btn = document.getElementById('citekey-backfill');
    btn.disabled = true;
    this.setStatus('Running…');
    try {
      const count = await Zotero.Clavicularius.backfill(overwrite);
      this.setStatus(`Done — ${count} key${count !== 1 ? 's' : ''} generated.`);
    } catch (e) {
      this.setStatus('Error: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  },

  async runRebuild() {
    const confirmed = Services.prompt.confirm(
      window,
      'Rebuild all citation keys?',
      'This will overwrite existing citation keys for every item in your library. Continue?'
    );
    if (!confirmed) return;

    const btn = document.getElementById('citekey-rebuild');
    btn.disabled = true;
    this.setStatus('Running…');
    try {
      const count = await Zotero.Clavicularius.backfill(true);
      this.setStatus(`Done — ${count} key${count !== 1 ? 's' : ''} updated.`);
    } catch (e) {
      this.setStatus('Error: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  },
};
