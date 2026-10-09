const el = (id) => document.getElementById(id);

let rules = [];

async function init() {
  const { config = {} } = await chrome.storage.local.get('config');
  rules = (config.rules ?? []).filter((r) => r.topic?.trim());
  if (!rules.length) {
    el('empty').hidden = false;
    return;
  }

  for (const rule of rules) {
    const option = document.createElement('option');
    option.value = rule.id;
    option.textContent = ruleLabel(rule);
    el('rule').append(option);
  }
  el('form').hidden = false;

  // Restore what was typed last time, so repeated sends are one click.
  const { sendDraft } = await chrome.storage.local.get('sendDraft');
  if (rules.some((r) => r.id === sendDraft?.ruleId)) {
    el('rule').value = sendDraft.ruleId;
    el('payload').value = sendDraft.payload ?? '';
  }
  el('payload').focus();
}

function ruleLabel(rule) {
  // A title with placeholders ("{type}: {message}") reads badly as a name; fall back to the type, then the topic.
  if (rule.title && !rule.title.includes('{')) return rule.title;
  return rule.match || rule.topic;
}

function selectedRule() {
  return rules.find((r) => r.id === el('rule').value);
}

// A topic filter can't be published to, so wildcards become a concrete topic that still matches the filter:
// "machine/+/status" -> "machine/notifier/status", "fun/#" -> "fun" ("#" also matches its parent level).
function sendTopic(filter) {
  const levels = filter.trim().split('/');
  if (levels.at(-1) === '#' && levels.length > 1) levels.pop();
  return levels.map((level) => (level === '+' || level === '#' ? 'notifier' : level)).join('/');
}

function onEdit() {
  showResult('', '');
  saveDraft();
}

function saveDraft() {
  chrome.storage.local.set({ sendDraft: { ruleId: el('rule').value, payload: el('payload').value } });
}

function showResult(text, kind) {
  el('result').textContent = text;
  el('result').className = kind;
}

async function send(e) {
  e.preventDefault();
  const rule = selectedRule();
  if (!rule || el('send').disabled) return;
  el('send').disabled = true;
  showResult('Sending…', '');
  saveDraft();
  const result = await chrome.runtime.sendMessage({
    // The rule's type is sent along, so receivers with the same rule show this message.
    type: 'publish', topic: sendTopic(rule.topic), msgType: rule.match ?? '', message: el('payload').value,
  });
  if (result?.ok) showResult('Sent', 'ok');
  else showResult(result?.error ?? 'Sending failed.', 'error');
  el('send').disabled = false;
}

async function showStatus() {
  const { status } = await chrome.storage.session.get('status');
  el('status').dataset.state = status?.state ?? '';
  el('status').textContent = status?.state ?? 'unknown';
  el('status').title = status?.detail ?? '';
}

el('rule').addEventListener('change', onEdit);
el('payload').addEventListener('input', onEdit);
el('payload').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e);
});
el('form').addEventListener('submit', send);
el('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.status) showStatus();
});

showStatus();
init();
