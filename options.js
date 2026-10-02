const el = (id) => document.getElementById(id);
const FIELDS = ['brokerUrl', 'username', 'password', 'clientId', 'popupSeconds', 'popupWidth', 'popupHeight'];
const CHECKS = ['showNotification', 'showPopup', 'ignoreRetained'];
const DEFAULTS = {
  brokerUrl: '', username: '', password: '', clientId: '',
  ignoreRetained: true, showNotification: true, showPopup: true,
  popupSeconds: 15, popupWidth: 380, popupHeight: 440,
  rules: [],
};

let rules = [];

function newRule() {
  return { id: crypto.randomUUID(), topic: '', match: '', title: '', gif: '' };
}

async function load() {
  const { config } = await chrome.storage.local.get('config');
  const cfg = { ...DEFAULTS, ...config };
  for (const f of FIELDS) el(f).value = cfg[f];
  for (const c of CHECKS) el(c).checked = cfg[c];
  rules = cfg.rules.length ? cfg.rules : [newRule()];
  renderRules();
}

function renderRules() {
  const container = el('rules');
  container.replaceChildren();
  for (const rule of rules) {
    const node = el('ruleTemplate').content.firstElementChild.cloneNode(true);
    const input = (name) => node.querySelector(`[data-field="${name}"]`);
    const preview = node.querySelector('.preview');

    for (const f of ['topic', 'match', 'title']) {
      input(f).value = rule[f];
      input(f).addEventListener('input', () => { rule[f] = input(f).value; });
    }

    // Uploaded files are stored as data URLs; keep those out of the URL box.
    const isUpload = rule.gif.startsWith('data:');
    input('gifUrl').value = isUpload ? '' : rule.gif;
    input('gifUrl').placeholder = isUpload ? `(uploaded file, ${Math.round(rule.gif.length * 0.75 / 1024)} KB)` : 'https://… or choose a file';
    preview.src = rule.gif;
    preview.hidden = !rule.gif;
    input('gifUrl').addEventListener('change', () => { rule.gif = input('gifUrl').value.trim(); renderRules(); });

    node.querySelector('.gifFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { rule.gif = reader.result; renderRules(); };
      reader.readAsDataURL(file);
    });
    node.querySelector('.clearGif').addEventListener('click', () => { rule.gif = ''; renderRules(); });

    node.querySelector('.test').addEventListener('click', async () => {
      await save();
      chrome.runtime.sendMessage({ type: 'test', ruleId: rule.id, payload: 'Test message from the settings page' });
    });
    node.querySelector('.remove').addEventListener('click', () => {
      rules = rules.filter((r) => r !== rule);
      renderRules();
    });

    container.append(node);
  }
}

function collectConfig() {
  const config = { rules: rules.map((r) => ({ ...r, topic: r.topic.trim() })) };
  for (const f of FIELDS) {
    const input = el(f);
    config[f] = input.type === 'number' ? Number(input.value) || 0 : input.value.trim();
  }
  for (const c of CHECKS) config[c] = el(c).checked;
  return config;
}

async function save() {
  // Saving the config makes the service worker reconnect with the new settings.
  await chrome.storage.local.set({ config: collectConfig() });
  flash('Saved');
}

function flash(text, isError = false, target = 'saved') {
  const saved = el(target);
  saved.textContent = text;
  saved.classList.toggle('error', isError);
  clearTimeout(flash[target]);
  flash[target] = setTimeout(() => { saved.textContent = ''; }, isError ? 6000 : 2500);
}

function exportSettings() {
  const config = collectConfig();
  if (!el('exportPassword').checked) delete config.password;
  const file = { app: 'mqtt-notifier', version: 1, exportedAt: new Date().toISOString(), config };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `mqtt-notifier-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function parseImport(text) {
  const data = JSON.parse(text);
  // Accept both the export wrapper and a bare config object.
  const config = data?.app === 'mqtt-notifier' ? data.config : data;
  if (!config || typeof config !== 'object' || !Array.isArray(config.rules)) {
    throw new Error('Not an MQTT Notifier settings file.');
  }

  const result = {};
  for (const f of FIELDS) {
    if (f in config) result[f] = typeof DEFAULTS[f] === 'number' ? Number(config[f]) || 0 : String(config[f] ?? '');
  }
  for (const c of CHECKS) {
    if (c in config) result[c] = Boolean(config[c]);
  }
  result.rules = config.rules.map((r) => ({
    id: typeof r?.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    topic: String(r?.topic ?? ''),
    match: String(r?.match ?? ''),
    title: String(r?.title ?? ''),
    gif: String(r?.gif ?? ''),
  }));
  return result;
}

async function importSettings(file) {
  try {
    const imported = parseImport(await file.text());
    if (!confirm(`Replace the current settings with "${file.name}" (${imported.rules.length} rule(s))?`)) return;
    const { config: current } = await chrome.storage.local.get('config');
    // Exports leave the password out by default; keep the current one in that case.
    const config = { ...DEFAULTS, ...current, ...imported };
    await chrome.storage.local.set({ config });
    await load();
    flash(`Imported ${imported.rules.length} rule(s)`, false, 'backupMsg');
  } catch (err) {
    flash(`Import failed: ${err.message}`, true, 'backupMsg');
  }
}

async function showStatus() {
  const { status } = await chrome.storage.session.get('status');
  const box = el('status');
  box.dataset.state = status?.state ?? '';
  box.textContent = status ? `${status.state}${status.detail ? `: ${status.detail}` : ''}` : 'Status unknown';
}

el('addRule').addEventListener('click', () => { rules.push(newRule()); renderRules(); });
el('save').addEventListener('click', save);
el('reconnect').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'reconnect' }));
el('export').addEventListener('click', exportSettings);
el('import').addEventListener('click', () => el('importFile').click());
el('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importSettings(file);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.status) showStatus();
});

load();
showStatus();
