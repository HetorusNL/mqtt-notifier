const el = (id) => document.getElementById(id);

let timer = null;
let remaining = 0;
let paused = false;

async function render() {
  const { lastAlert } = await chrome.storage.session.get('lastAlert');
  const { config = {} } = await chrome.storage.local.get('config');
  if (!lastAlert) return;

  const rule = (config.rules ?? []).find((r) => r.id === lastAlert.ruleId);
  const gif = el('gif');
  gif.hidden = !rule?.gif;
  if (rule?.gif && gif.src !== rule.gif) gif.src = rule.gif;

  document.title = lastAlert.title;
  el('title').textContent = lastAlert.title;
  el('payload').textContent = lastAlert.payload;
  el('meta').textContent = `${lastAlert.topic} · ${new Date(lastAlert.at).toLocaleString()}`;

  startCountdown(config.popupSeconds ?? 15);
}

function startCountdown(seconds) {
  clearInterval(timer);
  remaining = seconds;
  if (!seconds) {
    el('countdown').textContent = '';
    return;
  }
  updateCountdown();
  timer = setInterval(() => {
    if (paused) return;
    remaining--;
    if (remaining <= 0) window.close();
    updateCountdown();
  }, 1000);
}

function updateCountdown() {
  el('countdown').textContent = paused ? 'Paused' : `Closes in ${remaining} s`;
}

// Pause auto-close while the user is looking at / hovering the window.
document.body.addEventListener('mouseenter', () => { paused = true; updateCountdown(); });
document.body.addEventListener('mouseleave', () => { paused = false; updateCountdown(); });

el('dismiss').addEventListener('click', () => window.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.lastAlert) render();
});

render();
