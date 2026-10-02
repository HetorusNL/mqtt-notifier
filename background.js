// Background: holds the MQTT connection and raises alerts for matching messages.
// Chrome runs this as a service worker; Firefox runs it as an event page (manifest "background.scripts",
// which already loads mqtt.min.js, and has no importScripts).
// Chrome keeps an MV3 service worker alive while its WebSocket has traffic at least every 30 s,
// which is why the MQTT keepalive below is 20 s.
if (typeof importScripts === 'function') importScripts('lib/mqtt.min.js');

// Firefox unloads the event page after 30 s without extension API activity and ignores WebSocket
// traffic; any API call resets that idle timer.
setInterval(() => chrome.runtime.getPlatformInfo(), 20000);

const DEFAULT_CONFIG = {
  brokerUrl: '',
  username: '',
  password: '',
  clientId: '',
  ignoreRetained: true,
  showNotification: true,
  showPopup: true,
  popupSeconds: 15,
  popupWidth: 380,
  popupHeight: 440,
  rules: [],
};

const isFirefox = navigator.userAgent.includes('Firefox');

let client = null;
let connectSeq = 0;
let popupTask = Promise.resolve();

async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...config };
}

function setStatus(state, detail = '') {
  chrome.storage.session.set({ status: { state, detail, at: Date.now() } });
  const badge = { connected: '', connecting: '…', offline: 'off', error: '!', unconfigured: '?' }[state] ?? '';
  chrome.action.setBadgeText({ text: badge });
  chrome.action.setBadgeBackgroundColor({ color: state === 'error' ? '#c0392b' : '#7f8c8d' });
}

async function connect() {
  const seq = ++connectSeq;
  if (client) {
    client.removeAllListeners();
    client.end(true);
    client = null;
  }

  const cfg = await getConfig();
  // A newer connect() started while we were reading the config; let that one win.
  if (seq !== connectSeq) return;

  const topics = [...new Set(cfg.rules.map((r) => r.topic.trim()).filter(Boolean))];
  if (!cfg.brokerUrl || topics.length === 0) {
    setStatus('unconfigured', 'Set a broker URL and at least one rule in the settings.');
    return;
  }

  setStatus('connecting', cfg.brokerUrl);
  const c = mqtt.connect(cfg.brokerUrl, {
    username: cfg.username || undefined,
    password: cfg.password || undefined,
    clientId: cfg.clientId || `mqtt-notifier-${crypto.randomUUID().slice(0, 8)}`,
    keepalive: 20,
    // 'auto' runs the keepalive timer in a blob: Web Worker when in a page (Firefox's event page),
    // which the extension CSP blocks, so pings would silently never be sent.
    timerVariant: 'native',
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clean: true,
  });
  client = c;

  c.on('connect', () => {
    c.subscribe(topics, { qos: 0 }, (err) => {
      if (err) setStatus('error', `Subscribe failed: ${err.message}`);
      else setStatus('connected', `${cfg.brokerUrl}\n${topics.join('\n')}`);
    });
  });
  c.on('reconnect', () => setStatus('connecting', `Reconnecting to ${cfg.brokerUrl}…`));
  c.on('offline', () => setStatus('offline', 'Connection lost, retrying…'));
  c.on('error', (err) => setStatus('error', err.message));
  c.on('message', (topic, payload, packet) => onMessage(cfg, topic, payload, packet));
}

function onMessage(cfg, topic, payload, packet) {
  // Retained messages arrive on every (re)connect; alerting on them would repeat old alarms.
  if (packet.retain && cfg.ignoreRetained) return;

  const text = payload.toString();
  const rule = cfg.rules.find((r) => topicMatches(r.topic.trim(), topic) && payloadMatches(r.match, text));
  if (rule) showAlert(cfg, rule, topic, text);
}

function topicMatches(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

function payloadMatches(pattern, text) {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(text);
  } catch {
    // Not a valid regex: fall back to a plain substring match.
    return text.includes(pattern);
  }
}

function fillTemplate(template, topic, text) {
  return template.replaceAll('{topic}', topic).replaceAll('{payload}', text);
}

async function showAlert(cfg, rule, topic, text) {
  const title = fillTemplate(rule.title || 'MQTT: {topic}', topic, text);
  // Only the rule id is stored; the alert window reads the (possibly large) GIF from the config.
  await chrome.storage.session.set({ lastAlert: { ruleId: rule.id, title, topic, payload: text, at: Date.now() } });

  if (cfg.showNotification) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message: text.slice(0, 250),
      // Firefox rejects any option besides type, title, message and iconUrl.
      ...(isFirefox ? {} : { priority: 2 }),
    });
  }
  if (cfg.showPopup) openPopup(cfg);
}

function openPopup(cfg) {
  // Serialize so a burst of messages reuses one window instead of opening several.
  popupTask = popupTask.then(() => openPopupNow(cfg)).catch((err) => console.error('Alert window failed', err));
  return popupTask;
}

async function openPopupNow(cfg) {
  const { popupWindowId } = await chrome.storage.session.get('popupWindowId');
  if (popupWindowId != null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true, drawAttention: true });
      return;
    } catch {
      // Window was closed; open a new one.
    }
  }

  const width = cfg.popupWidth;
  const height = cfg.popupHeight;
  let left;
  let top;
  try {
    const area = await primaryWorkArea();
    left = area.left + area.width - width - 16;
    top = area.top + area.height - height - 16;
  } catch {
    // Let the browser choose the position.
  }

  const win = await chrome.windows.create({ url: 'alert.html', type: 'popup', width, height, left, top, focused: true });
  await chrome.storage.session.set({ popupWindowId: win.id });
}

async function primaryWorkArea() {
  if (chrome.system?.display) {
    const displays = await chrome.system.display.getInfo();
    return (displays.find((d) => d.isPrimary) ?? displays[0]).workArea;
  }
  // Firefox has no system.display, but its event page is a document with a screen object.
  return { left: screen.availLeft ?? 0, top: screen.availTop ?? 0, width: screen.availWidth, height: screen.availHeight };
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { popupWindowId } = await chrome.storage.session.get('popupWindowId');
  if (windowId === popupWindowId) await chrome.storage.session.remove('popupWindowId');
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  openPopup(await getConfig());
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.config) connect();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'reconnect') connect();
  if (msg.type === 'test') {
    getConfig().then((cfg) => {
      const rule = cfg.rules.find((r) => r.id === msg.ruleId);
      if (rule) showAlert(cfg, rule, rule.topic.replace(/[+#]/g, 'test'), msg.payload ?? 'Test message');
    });
  }
});

// Registering these makes Chrome start the worker when the browser starts / the extension updates;
// the connection itself is opened by the top-level connect() below.
chrome.runtime.onStartup.addListener(() => {});
chrome.runtime.onInstalled.addListener(() => {});

// Watchdog: if the worker was ever stopped anyway, the alarm wakes it and reconnects.
chrome.alarms.get('watchdog').then((alarm) => {
  if (!alarm) chrome.alarms.create('watchdog', { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'watchdog' && !client) connect();
});

connect();
