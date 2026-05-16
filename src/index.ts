import puppeteer from '@cloudflare/puppeteer';
import { Hono } from 'hono';
import Sval from 'sval';

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
  /process\./i,
  /__dirname/i,
  /eval\s*\(/i,
  /\bfs\b/i,
  /child_process/i,
];

const EDITOR_PREFIX = `const puppeteer = require('puppeteer');`;

const EXAMPLES: Record<string, { id: string; name: string; code: string }> = {
  screenshot: {
    id: 'screenshot',
    name: 'Tutorial: Take a basic screenshot',
    code: `const puppeteer = require('puppeteer');\n\n(async () => {\n  const browser = await puppeteer.launch();\n  const page = await browser.newPage();\n  \n  // Navigate to a website\n  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });\n  \n  // Take a full page screenshot\n  const shot = await page.screenshot({ fullPage: true });\n  \n  // Send screenshot back to the UI\n  output.setScreenshot(shot);\n  \n  await browser.close();\n})();`,
  },
  evaluate: {
    id: 'evaluate',
    name: 'Tutorial: Extract SEO Data to JSON',
    code: `const puppeteer = require('puppeteer');\n\n(async () => {\n  const browser = await puppeteer.launch();\n  const page = await browser.newPage();\n  \n  // Load the page\n  await page.goto('https://example.com');\n  \n  // Run JavaScript inside the browser to extract SEO data\n  const seoData = await page.evaluate(() => ({\n    title: document.title,\n    h1: document.querySelector('h1') ? document.querySelector('h1').innerText : 'No H1',\n    links: [...document.querySelectorAll('a')].map((a) => a.href),\n  }));\n  \n  // Send the extracted JSON back to the UI\n  output.setJson(seoData);\n  \n  await browser.close();\n})();`,
  },
  click: {
    id: 'click',
    name: 'Tutorial: Interact with Forms',
    code: `const puppeteer = require('puppeteer');\n\n(async () => {\n  const browser = await puppeteer.launch();\n  const page = await browser.newPage();\n  \n  // Set up a fake form for testing\n  await page.setContent('<form><input name="q" /><button type="submit">Go</button></form>');\n  \n  // Type text into the input field\n  await page.type('input[name="q"]', 'Cloudflare Workers');\n  \n  // Click the submit button\n  await page.click('button[type="submit"]');\n  \n  // Retrieve the updated value to verify\n  const val = await page.$eval('input[name="q"]', (el) => el.value);\n  output.setJson({ inputValue: val, success: true });\n  \n  await browser.close();\n})();`,
  },
  intercept: {
    id: 'intercept',
    name: 'Tutorial: Block Network Requests',
    code: `const puppeteer = require('puppeteer');\n\n(async () => {\n  const browser = await puppeteer.launch();\n  const page = await browser.newPage();\n  \n  // Enable request interception\n  await page.setRequestInterception(true);\n  \n  // Block all images from loading to save bandwidth\n  page.on('request', (req) => {\n    if (req.resourceType() === 'image') req.abort();\n    else req.continue();\n  });\n  \n  await page.goto('https://example.com');\n  output.setJson({ message: 'Images successfully blocked!' });\n  \n  await browser.close();\n})();`,
  },
  pdf: {
    id: 'pdf',
    name: 'Tutorial: Export page as PDF',
    code: `const puppeteer = require('puppeteer');\n\n(async () => {\n  const browser = await puppeteer.launch();\n  const page = await browser.newPage();\n  \n  await page.goto('https://example.com');\n  \n  // Generate a PDF buffer\n  const pdf = await page.pdf({ format: 'A4' });\n  \n  // Output PDF directly to the new PDF tab\n  output.setPdf(pdf);\n  output.setJson({ message: 'PDF generated successfully!' });\n  \n  await browser.close();\n})();`,
  },
  'wait-for': {
    id: 'wait-for',
    name: 'Tutorial: Wait for Elements',
    code: `const puppeteer = require('puppeteer');\n\n(async () => {\n  const browser = await puppeteer.launch();\n  const page = await browser.newPage();\n  \n  // Inject an element that appears after 2 seconds\n  await page.setContent('<script>setTimeout(() => document.body.innerHTML="<div id=\\'ready\\'>loaded</div>", 2000)</script>');\n  \n  console.log('Waiting for #ready element to appear...');\n  \n  // Pauses script execution until #ready is found in the DOM\n  await page.waitForSelector('#ready');\n  \n  console.log('Element found!');\n  output.setJson({ ready: true });\n  \n  await browser.close();\n})();`,
  },
  emulate: {
    id: 'emulate',
    name: 'Tutorial: Emulate Mobile Device',
    code: `const puppeteer = require('puppeteer');\n\n(async () => {\n  const browser = await puppeteer.launch();\n  const page = await browser.newPage();\n  \n  // Manually configure device emulation (e.g. iPhone 15 Pro)\n  await page.setViewport({ width: 393, height: 852, isMobile: true, hasTouch: true });\n  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');\n  \n  await page.goto('https://example.com');\n  \n  // Take a mobile-sized screenshot\n  const shot = await page.screenshot({ fullPage: true });\n  output.setScreenshot(shot);\n  \n  await browser.close();\n})();`,
  },
  'network-idle': {
    id: 'network-idle',
    name: 'Tutorial: Wait for fully loaded',
    code: `const puppeteer = require('puppeteer');\n\n(async () => {\n  const browser = await puppeteer.launch();\n  const page = await browser.newPage();\n  \n  // networkidle0 waits until there are no more than 0 network connections for at least 500 ms.\n  // Extremely useful for modern SPAs (React/Vue sites)\n  await page.goto('https://example.com', { waitUntil: 'networkidle0' });\n  \n  output.setJson({ loadedAt: new Date().toISOString() });\n  \n  await browser.close();\n})();`,
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
  const userCode = 'code' in body ? body.code : undefined;
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
    
    // Ensure we close the browser if the user clicks "Stop" (aborts the fetch request)
    c.req.raw.signal.addEventListener('abort', () => {
      if (browser) {
        browser.close().catch(() => {});
      }
    });

    const page = await browser.newPage();

    const interpreter = new Sval({ sandBox: true, ecmaVer: 10, async: true });

    // AST transformation to preserve source code for page.evaluate calls
    let processedCode = userCode;
    try {
      const ast = interpreter.parse(userCode);
      const evaluateCalls: any[] = [];
      const walk = (node: any) => {
        if (!node) return;
        if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'evaluate') {
          evaluateCalls.push(node);
        }
        for (const key in node) {
          if (node[key] && typeof node[key] === 'object') {
            walk(node[key]);
          }
        }
      };
      walk(ast);
      
      // Replace backwards to avoid shifting offsets
      for (let i = evaluateCalls.length - 1; i >= 0; i--) {
        const arg = evaluateCalls[i].arguments[0];
        if (arg && (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression')) {
          const fnSource = userCode.slice(arg.start, arg.end);
          const replacement = `Object.assign(${fnSource}, { toString: () => ${JSON.stringify(fnSource)} })`;
          processedCode = processedCode.slice(0, arg.start) + replacement + processedCode.slice(arg.end);
        }
      }
    } catch (e) {
      // If parsing fails, just let Sval fail natively during execution
    }

    // Ensure the main export returns the promise from the user's IIFE
    processedCode = processedCode.replace(/\(async\s*\(\)\s*=>\s*\{/, 'return (async () => {');

    const wrapped = `
const console = {
  log: (...args) => __logs.push(['log', args.map(String).join(' '), new Date().toISOString()]),
  warn: (...args) => __logs.push(['warn', args.map(String).join(' '), new Date().toISOString()]),
  error: (...args) => __logs.push(['error', args.map(String).join(' '), new Date().toISOString()]),
};
const require = (name) => {
  if (name === 'puppeteer') {
    return {
      ...__puppeteerLib,
      launch: async () => {
        // Use a Proxy so we don't mutate the original browser object and cause memory leaks
        return new Proxy(__browser, {
          get(target, prop) {
            if (prop === 'close') return async () => {};
            const val = target[prop];
            return typeof val === 'function' ? val.bind(target) : val;
          }
        });
      }
    };
  }
  throw new Error('require is restricted in this environment');
};
exports.main = async () => {
${processedCode}
};
`;

    interpreter.import({
      __logs: logs,
      output: {
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
        setPdf: (value: string | Uint8Array | ArrayBuffer) => {
          if (typeof value === 'string') {
            result.pdf = value.startsWith('data:application/pdf') ? value : `data:application/pdf;base64,${value}`;
            return;
          }
          result.pdf = `data:application/pdf;base64,${bytesToBase64(value)}`;
        },
      },
      bytesToBase64,
      __puppeteerLib: puppeteer,
      __browser: browser,
      setTimeout: (cb: Function, ms?: number, ...args: unknown[]) => {
        return setTimeout(cb, Math.min(ms || 0, 3000), ...args);
      },
      clearTimeout,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Execution timed out after 30 seconds')), EXECUTION_TIMEOUT_MS);
    });

    const executePromise = (async () => {
      interpreter.run(wrapped);
      if (typeof interpreter.exports.main === 'function') {
        await interpreter.exports.main();
      }
    })();
    // Attach a no-op catch handler to prevent unhandled rejections if the promise
    // rejects AFTER Promise.race has already finished (e.g. on timeout)
    executePromise.catch(() => {});

    await Promise.race([
      executePromise,
      timeoutPromise,
    ]);

    if (!result.screenshot) {
      try {
        const pages = await browser.pages();
        const activePage = pages.length > 1 ? pages[pages.length - 1] : page;
        const screenshotBuffer = await activePage.screenshot({ fullPage: true });
        result.screenshot = `data:image/png;base64,${bytesToBase64(screenshotBuffer)}`;
      } catch (e) {
        // browser or page might be closed
      }
    }

    return c.json({ ...result, durationMs: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
      #editorWrap { height: 100%; display:flex; flex-direction: column; }
      #editorArea { position: relative; flex: 1; }
      #editorHighlight { position: absolute; inset: 0; margin: 0; padding: 12px; pointer-events: none; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, monospace; font-size:13px; line-height:1.5; tab-size:2; color: var(--fg); }
      #editor { position: absolute; inset: 0; margin: 0; padding: 12px; border: 0; outline: none; resize: none; width:100%; height:100%; background: transparent; color: transparent; caret-color: var(--fg); font-family: ui-monospace, SFMono-Regular, monospace; font-size:13px; line-height:1.5; tab-size:2; }
      #editor::selection { color: transparent; background: rgba(59, 130, 246, 0.3); }
      #codeMirrorContainer { position: absolute; inset: 0; padding: 12px; display: none; z-index: 1; }
      #editorHighlight .kw { color: #60a5fa; }
      #editorHighlight .str { color: #f59e0b; }
      #editorHighlight .num { color: #fb7185; }
      #editorHighlight .cmnt { color: var(--muted); }
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
      select option { background: var(--panel); color: var(--fg); }
      button[disabled] { opacity:0.6; }
      .status { color: var(--muted); margin-left:auto; }
      .links { display:flex; gap: 10px; }
      a { color: #60a5fa; text-decoration: none; }
      .json-code { margin: 0; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
      .json-string { color: #a5d6ff; }
      .json-number { color: #fb7185; }
      .json-boolean { color: #34d399; }
      .json-null { color: var(--muted); font-style: italic; }
      .json-key { color: #60a5fa; }
      .modal { display:none; position:fixed; z-index:9999; left:0; top:0; width:100%; height:100%; overflow:auto; background-color:rgba(0,0,0,0.8); align-items:center; justify-content:center; flex-direction:column; gap:15px; }
      .modal.show { display:flex; }
      .modal img { max-width:90%; max-height:80%; border-radius:8px; border:2px solid var(--line); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
      .modal-close { position:absolute; top:20px; right:30px; color:var(--fg); font-size:40px; font-weight:bold; cursor:pointer; }
      .modal-download { background:var(--brand); color:#fff; border:none; padding:10px 20px; font-size:16px; border-radius:6px; cursor:pointer; text-decoration:none; display:inline-block; font-family:inherit; font-weight:bold; }
      .modal-download:hover { opacity:0.9; }
      @media (max-width: 900px) { #app { grid-template-columns: 1fr; grid-template-rows: 40vh 1fr auto; } }
    </style>
  </head>
  <body>
    <div id="imageModal" class="modal">
      <span class="modal-close" onclick="document.getElementById('imageModal').classList.remove('show')">&times;</span>
      <img id="modalImage" src="" />
      <a id="modalDownload" class="modal-download" download="screenshot.png">⬇ Download Image</a>
    </div>

    <div id="app">
      <section class="panel">
        <div id="editorWrap">
          <div id="editorArea">
            <pre id="editorHighlight" aria-hidden="true"></pre>
            <textarea id="editor" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></textarea>
            <div id="codeMirrorContainer"></div>
          </div>
        </div>
      </section>
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
        <button id="loadCdnBtn">Load CDN Editor</button>
        <button id="saveKV" disabled title="Saving examples to KV: coming soon">Save to KV (Coming soon)</button>
        <span id="status" class="status">Ready</span>
        <span class="links"><a href="https://github.com/gohcx/try-puppeteer" target="_blank" rel="noopener noreferrer">GitHub</a><a href="https://developers.cloudflare.com/browser-rendering/" target="_blank" rel="noopener noreferrer">Cloudflare Docs</a></span>
      </footer>
    </div>

    <script>
      window.__DEFAULT_CODE__ = ${JSON.stringify(defaultCode)};
      window.__JSON_PLACEHOLDER__ = ${JSON.stringify(jsonTreePlaceholder)};
    </script>
    <script>
      const runBtn = document.getElementById('runBtn');
      const statusEl = document.getElementById('status');
      const logsEl = document.getElementById('logs');
      const previewEl = document.getElementById('preview');
      const selectEl = document.getElementById('exampleSelect');
      const clearLogs = document.getElementById('clearLogs');
      const editor = document.getElementById('editor');
      const editorHighlight = document.getElementById('editorHighlight');
      let currentTab = 'shot';
      let inflight = null;
      let latest = { screenshot: null, json: null };

      // set initial body
      editor.value = window.__DEFAULT_CODE__;
      updateHighlight();

      // CodeMirror (CDN) loader toggle
      let cmInstance = null;
      let cmLoaded = false;
      const loadCdnBtn = document.getElementById('loadCdnBtn');
      loadCdnBtn.addEventListener('click', async () => {
        if (cmLoaded) return;
        loadCdnBtn.textContent = 'Loading...';
        try {
          // inject CSS
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://unpkg.com/codemirror@5.65.12/lib/codemirror.css';
          document.head.appendChild(link);
          // inject scripts sequentially
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/codemirror@5.65.12/lib/codemirror.js';
            s.onload = res; s.onerror = rej; document.body.appendChild(s);
          });
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/codemirror@5.65.12/mode/javascript/javascript.js';
            s.onload = res; s.onerror = rej; document.body.appendChild(s);
          });
          // initialize CodeMirror from the textarea
          const cm = window.CodeMirror.fromTextArea(editor, {
            lineNumbers: true,
            mode: 'javascript',
            theme: 'default',
            indentUnit: 2,
          });
          cm.on('change', (cmIns) => {
            editor.value = cmIns.getValue();
            updateHighlight();
          });
          cm.on('keydown', (cmIns, e) => {
            const isRun = (e.ctrlKey || e.metaKey) && e.keyCode === 13;
            if (isRun) {
              e.preventDefault(); runAction();
            }
          });
          // show CodeMirror container and hide overlay highlight
          const cmContainer = document.getElementById('codeMirrorContainer');
          cmContainer.style.display = 'block';
          // CodeMirror will have replaced the textarea; adjust wrapper layout so prefix stays visible
          const wrapper = cm.getWrapperElement();
          const topPad = editor.style.paddingTop || '0px';
          wrapper.style.marginTop = topPad;
          wrapper.style.position = 'relative';
          wrapper.style.zIndex = '2';
          document.getElementById('editorHighlight').style.display = 'none';
          editor.style.display = 'none';
          cmInstance = cm;
          cmLoaded = true;
          loadCdnBtn.textContent = 'CDN Editor Active';
        } catch (e) {
          console.error('Failed to load CDN editor', e);
          loadCdnBtn.textContent = 'Load CDN Editor';
          addLog('error', 'Failed to load CDN editor: ' + String(e));
        }
      });

      const runAction = () => runCode();

      editor.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          runAction();
        }
      });

      editor.addEventListener('input', () => updateHighlight());
      editor.addEventListener('scroll', () => {
        editorHighlight.scrollTop = editor.scrollTop;
        editorHighlight.scrollLeft = editor.scrollLeft;
      });

      function escapeForHtml(s) {
        return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      }

      function updateHighlight() {
        const v = editor.value;
        const keywords = new Set(['await','const','let','var','function','return','if','else','for','while','try','catch','new','require','class']);
        let out = '';
        for (let i = 0; i < v.length; ) {
          const ch = v[i];
          if (ch === "'" || ch === '"') {
            const q = ch;
            let j = i + 1;
            while (j < v.length && v[j] !== q) {
              if (v[j] === '\\\\' && j + 1 < v.length) j += 2;
              else j++;
            }
            if (j < v.length) j++;
            const str = v.slice(i, j);
            out += '<span class="str">' + escapeForHtml(str) + '</span>';
            i = j;
            continue;
          }
          if (/[0-9]/.test(ch)) {
            let j = i;
            while (j < v.length && /[0-9]/.test(v[j])) j++;
            out += '<span class="num">' + escapeForHtml(v.slice(i, j)) + '</span>';
            i = j;
            continue;
          }
          if (/[A-Za-z_$]/.test(ch)) {
            let j = i;
            while (j < v.length && /[A-Za-z0-9_$]/.test(v[j])) j++;
            const word = v.slice(i, j);
            if (keywords.has(word)) out += '<span class="kw">' + escapeForHtml(word) + '</span>';
            else out += escapeForHtml(word);
            i = j;
            continue;
          }
          out += escapeForHtml(ch);
          i++;
        }
        editorHighlight.innerHTML = out;
      }

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

      function syntaxHighlightJson(json) {
        if (typeof json !== 'string') {
          json = JSON.stringify(json, null, 2);
        }
        json = escapeHtml(json);
        return '<pre class="json-code">' + json.replace(/(&quot;(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&quot;])*&quot;(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
          let cls = 'json-number';
          if (/^&quot;/.test(match)) {
            if (/:$/.test(match)) {
              cls = 'json-key';
            } else {
              cls = 'json-string';
            }
          } else if (/true|false/.test(match)) {
            cls = 'json-boolean';
          } else if (/null/.test(match)) {
            cls = 'json-null';
          }
          return '<span class="' + cls + '">' + match + '</span>';
        }) + '</pre>';
      }

      function base64ToBlobUrl(base64, type) {
        const binStr = atob(base64.split(',')[1]);
        const len = binStr.length;
        const arr = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          arr[i] = binStr.charCodeAt(i);
        }
        return URL.createObjectURL(new Blob([arr], { type }));
      }

      function renderPreview() {
        if (currentTab === 'shot') {
          if (!latest.screenshot) {
            previewEl.innerHTML = '<p class="placeholder">No screenshot yet.</p>';
            return;
          }
          previewEl.innerHTML = '<img id="shot" alt="screenshot preview" src="' + latest.screenshot + '" style="cursor:zoom-in" />';
          document.getElementById('shot').addEventListener('click', () => {
            document.getElementById('modalImage').src = latest.screenshot;
            document.getElementById('modalDownload').href = latest.screenshot;
            document.getElementById('imageModal').classList.add('show');
          });
          return;
        }
        if (currentTab === 'pdf') {
          if (!latest.pdf) {
            previewEl.innerHTML = '<p class="placeholder">No PDF generated.</p>';
            return;
          }
          if (!latest.pdfBlobUrl) {
            latest.pdfBlobUrl = base64ToBlobUrl(latest.pdf, 'application/pdf');
          }
          previewEl.innerHTML = '<iframe src="' + latest.pdfBlobUrl + '#toolbar=0" width="100%" height="100%" style="border:none; border-radius:10px; min-height: 400px;"></iframe>' + 
            '<div style="text-align:center; padding: 10px;"><a href="' + latest.pdfBlobUrl + '" download="document.pdf" style="display:inline-block; padding: 8px 16px; background: var(--brand); color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">⬇ Download PDF directly</a></div>';
          return;
        }
        previewEl.innerHTML = latest.json === null ? window.__JSON_PLACEHOLDER__ : syntaxHighlightJson(latest.json);
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
        editor.value = ex.code;
        updateHighlight();
      });

      async function runCode() {
        const code = editor.value;
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
          let switchedTab = false;
          if (data.screenshot) {
            latest.screenshot = data.screenshot;
            currentTab = 'shot';
            switchedTab = true;
          }
          if (data.pdf) {
            latest.pdf = data.pdf;
            if (latest.pdfBlobUrl) URL.revokeObjectURL(latest.pdfBlobUrl);
            latest.pdfBlobUrl = null;
            currentTab = 'pdf';
            switchedTab = true;
          }
          if (data.json !== undefined) {
            latest.json = data.json;
            if (!switchedTab) currentTab = 'json';
          }
          
          document.querySelectorAll('.tab').forEach((b) => {
            b.classList.toggle('active', b.dataset.tab === currentTab);
          });
          
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
      (async () => {
        await loadExamples();
        renderPreview();
      })();
    </script>
  </body>
</html>`;
}

export default app;
