// A headless Chrome driven over the DevTools protocol, for the page's
// screenshots and tours. No browser package: Chrome itself, and the WebSocket
// Node ships with.
//
//   const page = await openPage('file:///…/page.html#map', { width: 1280, height: 800 });
//   await page.png('out.png'); await page.close();
//
// CHROME names the browser when it is not where macOS puts Google Chrome.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const portOf = async (profile) => {
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(file)) {
      const [port, path] = readFileSync(file, 'utf8').split('\n');
      if (port && path) return { port, path };
    }
    await wait(100);
  }
  throw new Error('Chrome did not open its DevTools port');
};

/** One CDP session on one page target. */
const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let next = 0;
    const waiting = new Map();
    const listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && waiting.has(message.id)) {
        const { ok, fail } = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error) fail(new Error(message.error.message)); else ok(message.result);
      } else if (message.method) {
        for (const listener of listeners) listener(message);
      }
    });
    socket.addEventListener('open', () =>
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((ok, fail) => {
            next += 1;
            waiting.set(next, { ok, fail });
            socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
          }),
        on: (listener) => listeners.add(listener),
        close: () => socket.close(),
      }),
    );
    socket.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)));
  });

export const openPage = async (url, { width = 1280, height = 800, scale = 1, dark = true } = {}) => {
  const profile = mkdtempSync(join(tmpdir(), 'flowatlas-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--allow-file-access-from-files', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });
  const { port, path } = await portOf(profile);
  const browser = await connect(`ws://127.0.0.1:${port}${path}`);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const loaded = new Promise((done) => browser.on((m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId && done()));
  await send('Page.navigate', { url });
  await loaded;
  await wait(800);

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  const mouse = async (type, x, y) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });

  return {
    evaluate,
    /**
     * The middle of the first shown element a selector names, or of the one
     * whose text is `text` (`*text`: holds it).
     */
    centre: async (selector, text = null) => {
      const box = await evaluate(`(() => {
        const all = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
        const want = ${JSON.stringify(text)};
        const holds = (e) => want.startsWith('*') ?e.textContent.includes(want.slice(1)) : e.textContent.trim() === want;
        const el = all.find((e) => want === null || holds(e));
        if (!el) return null;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (box === null) throw new Error(`nothing matches ${selector}${text ? ` holding "${text}"` : ''}`);
      return box;
    },
    move: (x, y) => mouse('mouseMoved', x, y),
    click: async (x, y) => {
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y);
      await mouse('mouseReleased', x, y);
    },
    type: (text) => send('Input.insertText', { text }),
    key: async (key) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
    },
    png: async (file) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
    wait,
    close: async () => {
      browser.close();
      chrome.kill();
      await wait(300);
      rmSync(profile, { recursive: true, force: true });
    },
  };
};
