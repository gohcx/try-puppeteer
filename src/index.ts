import puppeteer from '@cloudflare/puppeteer';
import { Hono } from 'hono';

type BrowserBinding = unknown;

type Env = {
MYBROWSER: BrowserBinding;
EXAMPLES_KV: KVNamespace;
};

type LogEntry = [type: 'log' | 'warn' | 'error', message: string, at: string];

type RunResult = {
screenshot: string | null;
json: unknown;
logs: LogEntry[];
error: string | null;
};

const MAX_CODE_LENGTH = 10_000;
const EXECUTION_TIMEOUT_MS = 30_000;
const FORBIDDEN_PATTERNS = [
/require\s*\(/i,
/process\./i,
/__dirname/i,
/eval\s*\(/i,
/\bfs\b/i,
/child_process/i,
];

const EXAMPLES: Record<string, { id: string; name: string; code: string }> = {
	screenshot: {
		id: 'screenshot',
		name: 'Screenshot',
code: `await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });\nconst shot = await page.screenshot({ fullPage: true });\noutput.setScreenshot(shot);\noutput.setJson({ title: await page.title() });`,
},
	evaluate: {
		id: 'evaluate',
		name: 'Get Page Data',
code: `await page.goto('https://example.com');\nconst data = await page.evaluate(() => ({\n  title: document.title,\n  links: [...document.querySelectorAll('a')].map((a) => a.href),\n}));\noutput.setJson(data);`,
},
	click: {
		id: 'click',
		name: 'Form Interaction',
code: `await page.setContent('<form><input name="q" /><button type="submit">Go</button></form>');\nawait page.type('input[name="q"]', 'try puppeteer');\nawait page.click('button[type="submit"]');\noutput.setJson({ value: await page.$eval('input[name="q"]', (el) => el.value) });`,
},
	intercept: {
		id: 'intercept',
		name: 'Request Interception',
code: `await page.setRequestInterception(true);\npage.on('request', (req) => req.continue());\npage.on('response', (res) => console.log('response', res.status(), res.url()));\nawait page.goto('https://example.com');\noutput.setJson({ intercepted: true });`,
},
	pdf: {
		id: 'pdf',
		name: 'Generate PDF',
code: `await page.goto('https://example.com');\nconst pdf = await page.pdf({ format: 'A4' });\noutput.setJson({ pdfBase64: bytesToBase64(pdf), bytes: pdf.length });`,
},
	'wait-for': {
		id: 'wait-for',
		name: 'Wait For Element',
code: `await page.setContent('<div id="ready">loaded</div>');\nawait page.waitForSelector('#ready');\noutput.setJson({ ready: true });`,
},
	emulate: {
		id: 'emulate',
		name: 'Mobile Emulation',
code: `const devices = puppeteer.KnownDevices;\nawait page.emulate(devices['iPhone 15']);\nawait page.goto('https://example.com');\noutput.setJson({ ua: await page.evaluate(() => navigator.userAgent) });`,
},
	'network-idle': {
		id: 'network-idle',
		name: 'Wait For Network Idle',
code: `await page.goto('https://example.com', { waitUntil: 'networkidle0' });\noutput.setJson({ loadedAt: new Date().toISOString() });`,
},
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
await next();
c.res.headers.set('Access-Control-Allow-Origin', '*');
c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
c.res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
});

app.options('*', (c) => c.body(null, 204));

app.get('/', (c) => c.html(renderHtml()));

app.get('/examples', async (c) => {
const builtIn = Object.values(EXAMPLES).map(({ id, name }) => ({ id, name }));
return c.json({ examples: builtIn });
});

app.get('/examples/:id', async (c) => {
const id = c.req.param('id');
const inCode = EXAMPLES[id];
if (inCode) {
return c.json(inCode);
}

const kvCode = await c.env.EXAMPLES_KV.get(id);
if (!kvCode) {
return c.json({ error: 'Example not found' }, 404);
}

return c.json({ id, name: id, code: kvCode });
});

app.post('/run', async (c) => {
const body = await c.req.json<{ code?: string }>().catch(() => ({}));
const userCode = body.code;
if (!userCode || typeof userCode !== 'string') {
return c.json({ error: 'Missing `code` in request body', logs: [] }, 400);
}
	if (userCode.length > MAX_CODE_LENGTH) {
		return c.json({ error: 'Code too long. Max 10,000 characters.', logs: [] }, 400);
	}
if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(userCode))) {
return c.json({ error: 'Code contains blocked keywords/API usage.', logs: [] }, 400);
}

const logs: LogEntry[] = [];
const started = Date.now();
const result: RunResult = {
screenshot: null,
json: null,
logs,
error: null,
};

let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
browser = await puppeteer.launch(c.env.MYBROWSER as never);
const page = await browser.newPage();

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
...args: string[]
) => (
pageArg: unknown,
browserArg: unknown,
logsArg: LogEntry[],
outputArg: {
setJson: (value: unknown) => void;
setScreenshot: (value: string | Uint8Array | ArrayBuffer) => void;
},
bytesToBase64: (value: Uint8Array | ArrayBuffer) => string,
puppeteerLib: typeof puppeteer,
) => Promise<void>;

const wrapped = `
const console = {
  log: (...args) => __logs.push(['log', args.map(String).join(' '), new Date().toISOString()]),
  warn: (...args) => __logs.push(['warn', args.map(String).join(' '), new Date().toISOString()]),
  error: (...args) => __logs.push(['error', args.map(String).join(' '), new Date().toISOString()]),
};
${userCode}
`;

const fn = new AsyncFunction(
'page',
'browser',
'__logs',
'output',
'bytesToBase64',
'puppeteer',
wrapped,
);

const timeoutPromise = new Promise<never>((_, reject) => {
setTimeout(() => reject(new Error('Execution timed out after 30 seconds')), EXECUTION_TIMEOUT_MS);
});

await Promise.race([
fn(
page,
browser,
logs,
{
setJson: (value: unknown) => {
result.json = value;
},
setScreenshot: (value: string | Uint8Array | ArrayBuffer) => {
if (typeof value === 'string') {
result.screenshot = value.startsWith('data:image/') ? value : `data:image/png;base64,${value}`;
return;
}
result.screenshot = `data:image/png;base64,${bytesToBase64(value)}`;
},
},
bytesToBase64,
puppeteer,
),
timeoutPromise,
]);

if (!result.screenshot) {
const screenshotBuffer = await page.screenshot({ fullPage: true });
result.screenshot = `data:image/png;base64,${bytesToBase64(screenshotBuffer)}`;
}

return c.json({ ...result, durationMs: Date.now() - started });
} catch (error) {
const message = error instanceof Error ? error.message : String(error);
logs.push(['error', message, new Date().toISOString()]);
return c.json({ error: message, logs, durationMs: Date.now() - started }, 500);
} finally {
	if (browser) {
		await browser.close();
	}
}
});

function bytesToBase64(value: Uint8Array | ArrayBuffer): string {
const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
let binary = '';
for (const byte of bytes) binary += String.fromCharCode(byte);
return btoa(binary);
}

function renderJsonTree(value: unknown, key = 'root'): string {
if (value === null || typeof value !== 'object') {
return `<div class="json-leaf"><span class="json-key">${escapeHtml(key)}</span>: <span class="json-value">${escapeHtml(
JSON.stringify(value),
)}</span></div>`;
}
const entries = Array.isArray(value)
? value.map((item, idx) => [String(idx), item] as const)
: Object.entries(value as Record<string, unknown>);
const children = entries.map(([childKey, childValue]) => renderJsonTree(childValue, childKey)).join('');
return `<details open><summary>${escapeHtml(key)}</summary><div class="json-children">${children}</div></details>`;
}

function escapeHtml(input: string): string {
return input
.replaceAll('&', '&amp;')
.replaceAll('<', '&lt;')
.replaceAll('>', '&gt;')
.replaceAll('"', '&quot;')
.replaceAll("'", '&#39;');
}

function renderHtml(): string {
const defaultCode = EXAMPLES.screenshot.code;
const jsonTreePlaceholder = renderJsonTree({ message: 'JSON output appears here' });
return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>try-puppeteer</title>
    <style>
      :root { color-scheme: light dark; --bg:#111827; --panel:#1f2937; --line:#374151; --fg:#f3f4f6; --muted:#9ca3af; }
      @media (prefers-color-scheme: light) {
        :root { --bg:#f5f7fb; --panel:#ffffff; --line:#d1d5db; --fg:#111827; --muted:#6b7280; }
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
      #app { display:grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr auto; height: 100vh; gap: 12px; padding: 12px; }
      .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow:hidden; min-height: 0; }
      #editor { height: 100%; }
      #right { display:grid; grid-template-rows: 1fr 1fr; gap: 12px; min-height:0; }
      .section { display:flex; flex-direction: column; min-height:0; }
      .tabs { display:flex; gap: 8px; border-bottom: 1px solid var(--line); padding: 8px; }
      .tab { border: 1px solid var(--line); background: transparent; color: inherit; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
      .tab.active { background:#2563eb; border-color:#2563eb; color:#fff; }
      .view { flex: 1; overflow:auto; padding: 12px; }
      #shot { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; cursor: zoom-in; }
      .placeholder { color: var(--muted); }
      #logs { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; }
      .log-line { margin-bottom: 6px; white-space: pre-wrap; word-break: break-word; }
      .log-line.error { color: #f87171; }
      .log-line.warn { color: #fbbf24; }
      .timestamp { color: var(--muted); margin-right: 8px; }
      .toolbar { grid-column: 1 / -1; display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background: var(--panel); }
      button, select { background:transparent; color:inherit; border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
      button[disabled] { opacity:0.6; }
      .status { color: var(--muted); margin-left:auto; }
      .links { display:flex; gap: 10px; }
      a { color: #60a5fa; text-decoration: none; }
      details { margin-left: 10px; }
      .json-leaf { margin-left: 10px; }
      @media (max-width: 900px) { #app { grid-template-columns: 1fr; grid-template-rows: 40vh 1fr auto; } }
    </style>
  </head>
  <body>
    <div id="app">
      <section class="panel"><div id="editor"></div></section>
      <section id="right">
        <div class="panel section">
          <div class="tabs">
            <button class="tab active" data-tab="shot">Screenshot</button>
            <button class="tab" data-tab="json">JSON</button>
          </div>
          <div class="view" id="preview"><p class="placeholder">Run code to see screenshot or JSON output.</p></div>
        </div>
        <div class="panel section">
          <div class="tabs"><button id="clearLogs">Clear Logs</button></div>
          <div class="view" id="logs"><p class="placeholder">Console logs will appear here.</p></div>
        </div>
      </section>
      <footer class="toolbar">
        <button id="runBtn">▶ Run</button>
        <select id="exampleSelect"></select>
        <span id="status" class="status">Ready</span>
        <span class="links"><a href="https://github.com/gohcx/try-puppeteer" target="_blank" rel="noopener noreferrer">GitHub</a><a href="https://developers.cloudflare.com/browser-rendering/" target="_blank" rel="noopener noreferrer">Cloudflare Docs</a></span>
      </footer>
    </div>

    <script>
      window.__DEFAULT_CODE__ = ${JSON.stringify(defaultCode)};
      window.__JSON_PLACEHOLDER__ = ${JSON.stringify(jsonTreePlaceholder)};
    </script>
    <script type="module">
      import { EditorState } from 'https://esm.sh/@codemirror/state@6.5.2';
      import { EditorView, keymap, lineNumbers, drawSelection } from 'https://esm.sh/@codemirror/view@6.36.10';
      import { defaultHighlightStyle, syntaxHighlighting } from 'https://esm.sh/@codemirror/language@6.11.3';
      import { defaultKeymap, history, historyKeymap } from 'https://esm.sh/@codemirror/commands@6.8.1';
      import { javascript } from 'https://esm.sh/@codemirror/lang-javascript@6.2.4';

      const runBtn = document.getElementById('runBtn');
      const statusEl = document.getElementById('status');
      const logsEl = document.getElementById('logs');
      const previewEl = document.getElementById('preview');
      const selectEl = document.getElementById('exampleSelect');
      const clearLogs = document.getElementById('clearLogs');
      let currentTab = 'shot';
      let inflight = null;
      let latest = { screenshot: null, json: null };

      const runAction = () => runCode();
      const editor = new EditorView({
        state: EditorState.create({
          doc: window.__DEFAULT_CODE__,
          extensions: [
            lineNumbers(),
            drawSelection(),
            history(),
            javascript(),
            syntaxHighlighting(defaultHighlightStyle),
            keymap.of([...defaultKeymap, ...historyKeymap, {
              key: 'Mod-Enter',
              run: () => { runAction(); return true; },
            }]),
          ],
        }),
        parent: document.getElementById('editor'),
      });

      function setStatus(text) { statusEl.textContent = text; }
      function addLog(type, message, at = new Date().toISOString()) {
        if (logsEl.querySelector('.placeholder')) logsEl.innerHTML = '';
        const line = document.createElement('div');
        line.className = 'log-line ' + type;
        const icon = type === 'error' ? '⛔' : type === 'warn' ? '⚠️' : '•';
        line.innerHTML = '<span class="timestamp">[' + new Date(at).toLocaleTimeString() + ']</span>' + icon + ' ' + message;
        logsEl.appendChild(line);
        logsEl.scrollTop = logsEl.scrollHeight;
      }

      function escapeHtml(input) {
        return String(input)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('\"', '&quot;')
          .replaceAll(\"'\", '&#39;');
      }

      function renderJsonTree(value, key = 'root') {
        if (value === null || typeof value !== 'object') {
          return '<div class="json-leaf"><span class="json-key">' + escapeHtml(key) + '</span>: <span class="json-value">' + escapeHtml(JSON.stringify(value)) + '</span></div>';
        }
        const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
        return '<details open><summary>' + escapeHtml(key) + '</summary><div class="json-children">' + entries.map(([k, v]) => renderJsonTree(v, k)).join('') + '</div></details>';
      }

      function renderPreview() {
        if (currentTab === 'shot') {
          if (!latest.screenshot) {
            previewEl.innerHTML = '<p class="placeholder">No screenshot yet.</p>';
            return;
          }
          previewEl.innerHTML = '<img id="shot" alt="screenshot preview" src="' + latest.screenshot + '" />';
          document.getElementById('shot').addEventListener('click', () => window.open(latest.screenshot, '_blank'));
          return;
        }
        previewEl.innerHTML = latest.json === null ? window.__JSON_PLACEHOLDER__ : renderJsonTree(latest.json, 'result');
      }

      document.querySelectorAll('.tab').forEach((el) => {
        el.addEventListener('click', () => {
          currentTab = el.dataset.tab;
          document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
          el.classList.add('active');
          renderPreview();
        });
      });

      clearLogs.addEventListener('click', () => {
        logsEl.innerHTML = '<p class="placeholder">Console logs will appear here.</p>';
      });

      async function loadExamples() {
        const r = await fetch('/examples');
        const data = await r.json();
        data.examples.forEach((ex) => {
          const opt = document.createElement('option');
          opt.value = ex.id;
          opt.textContent = ex.name + ' (' + ex.id + ')';
          selectEl.appendChild(opt);
        });
        selectEl.value = 'screenshot';
      }

      selectEl.addEventListener('change', async () => {
        const id = selectEl.value;
        const r = await fetch('/examples/' + id);
        const ex = await r.json();
        if (!ex.code) return;
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: ex.code } });
      });

      async function runCode() {
        const code = editor.state.doc.toString();
        if (code.length > 10000) {
          setStatus('Error: code exceeds 10,000 characters');
          return;
        }
        if (inflight) {
          inflight.abort();
          inflight = null;
          runBtn.textContent = '▶ Run';
          setStatus('Stopped');
          return;
        }
        inflight = new AbortController();
        runBtn.textContent = '◼ Stop';
        setStatus('Running...');
        const start = performance.now();
        try {
          const response = await fetch('/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
            signal: inflight.signal,
          });
          const data = await response.json();
          if (Array.isArray(data.logs)) {
            data.logs.forEach((line) => addLog(line[0], line[1], line[2]));
          }
          if (data.screenshot) latest.screenshot = data.screenshot;
          if (data.json !== undefined) latest.json = data.json;
          renderPreview();
          if (data.error) {
            addLog('error', data.error);
            setStatus('Error');
          } else {
            setStatus('Done in ' + ((performance.now() - start) / 1000).toFixed(2) + 's');
          }
        } catch (e) {
          const msg = e && e.name === 'AbortError' ? 'Request aborted' : String(e);
          addLog('error', msg);
          setStatus('Error');
        } finally {
          inflight = null;
          runBtn.textContent = '▶ Run';
        }
      }

      runBtn.addEventListener('click', runCode);
      await loadExamples();
      renderPreview();
    </script>
  </body>
</html>`;
}

export default app;
