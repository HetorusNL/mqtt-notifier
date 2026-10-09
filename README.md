# MQTT Notifier

Browser extension (Manifest V3) for Chrome, Edge and Firefox that subscribes to an MQTT broker over WebSockets and, when a message matches a rule, shows:

- a system notification (static image), and/or
- a small, focused alert window in the bottom-right corner that can play an **animated GIF**.

From the toolbar icon you can also **send** a real MQTT message to one of the configured topics, with optional message text.

Runs on Windows, macOS, Linux and ChromeOS — anywhere Chrome, Edge or Firefox (140+) runs. No tab needs to be open; the browser just has to be running.

## Install

### Chrome / Edge (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Click the extension icon → **Open settings**.

### Firefox

- **Quick try (temporary):** open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `manifest.json` in this folder. Firefox removes it again when it restarts.
- **Permanent:** release Firefox only installs signed add-ons. Sign it for free as an *unlisted* (self-distributed) add-on on [addons.mozilla.org](https://addons.mozilla.org/developers/) — e.g. `npx web-ext sign --channel=unlisted --api-key=… --api-secret=…` — and install the resulting `.xpi`. Alternatively, Firefox Developer Edition / Nightly / ESR accept unsigned add-ons after setting `xpinstall.signatures.required` to `false` in `about:config`.

The settings page opens via the toolbar popup (**Open settings**) or `about:addons` → MQTT Notifier → **Preferences**.

The single `manifest.json` serves both browsers, so each one logs a harmless warning for the other's keys (Chrome: `background.scripts`, `browser_specific_settings`; Firefox: `background.service_worker`, `system.display`).

## Configure

- **WebSocket URL** — e.g. `wss://broker.example.com:8884/mqtt` or `ws://192.168.1.10:9001`.
- **Rules** — topic filter (`+`/`#` wildcards), a **type**, title template (`{topic}`, `{type}`, `{message}`, `{payload}` = raw) and a GIF (URL or uploaded file). First matching rule wins.
- **Save & test** on a rule fires a fake alert for that rule.

## Message format

Messages are JSON with a `type` and a `message`:

```json
{"type": "nyan_surf", "message": "something something"}
```

- A rule's **type** must match the message's `type` exactly (a regex such as `alarm|fault` also works; empty = every message).
- The `message` is what the notification and alert window show.
- Plain-text or other messages (without `type`/`message`) still work: the rule's type is then searched in the whole text, and the whole text is shown.

Example from the command line:

```
mosquitto_pub -h broker.hivemq.com -t machine/alarm -m '{"type":"1337","message":"hello"}'
```

## Sending messages

Click the toolbar icon, pick a rule, type a message and press **Send** (or Ctrl+Enter). The rule's topic and type are sent along automatically, so everyone with the same rule gets the alert with your message. Messages are published with QoS 1, so "Sent" means the broker acknowledged it. Wildcard topics are made concrete: `+` becomes `notifier` (`machine/+/status` → `machine/notifier/status`) and a trailing `/#` is dropped (`fun/#` → `fun`). The popup remembers the last rule and message.

The toolbar badge shows the connection state: empty = connected, `…` = connecting, `off` = offline, `!` = error, `?` = not configured.

## Broker requirements

The broker must expose MQTT over WebSockets. For Mosquitto:

```
listener 9001
protocol websockets
```

If the broker uses `wss://` with a self-signed certificate, the certificate must be trusted by the OS/browser, otherwise the connection silently fails. Open `https://<broker>:<port>` once in a tab to check.

## Notes

- Credentials are stored unencrypted in `chrome.storage.local`. Use a read-only broker account.
- Retained messages are ignored by default so old alarms don't re-trigger on every reconnect.
- A burst of messages reuses the single alert window; it shows the latest message. Hovering it pauses auto-close; `Esc` closes it.
- The MQTT keepalive is 20 s: Chrome keeps an MV3 service worker alive only while its WebSocket has traffic at least every 30 s. A 1-minute alarm reconnects if the worker was stopped anyway.
- Firefox runs the background as an event page that unloads after 30 s without extension API calls; WebSocket traffic doesn't count there. A `runtime.getPlatformInfo()` call every 20 s keeps it loaded.
- Firefox differences: notifications show no priority, and the alert window is positioned with `screen` instead of `system.display` (not available in Firefox).
- Firefox's default MV3 policy upgrades `ws://` to `wss://`; the manifest overrides it so plain `ws://` brokers on the LAN keep working.

## Third-party

`lib/mqtt.min.js` — [MQTT.js](https://github.com/mqttjs/MQTT.js) 5.16.0, MIT license. Bundled locally because MV3 extensions may not load remote code.
