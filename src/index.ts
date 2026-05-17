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

app.get('/public/puppeteer.png', (c) => {
  const base64 = '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';
  const buffer = Uint8Array.from(atob(base64), function(c) { return c.charCodeAt(0); });
  return c.body(buffer, 200, { 'Content-Type': 'image/png' });
});

app.get('/public/puppeteer.ico', (c) => {
  const base64 = 'AAABAAEAFiAAAAEAIACoCwAAFgAAACgAAAAWAAAAQAAAAAEAIAAAAAAAAAsAABMLAAATCwAAAAAAAAAAAAAAAAABAwMDKRcXF1AZGRlRGRkZURkZGVEZGRlRGRkZURkZGVEZGRlRGRkZURkZGVEZGRlRGRkZURkZGVEZGRlRGRkZURkZGVEZGRlRFxcXUAMDAykAAAABCwsLKn5+fs68vLz2vr6+976+vve+vr73vr6+976+vve+vr73vr6+976+vve+vr72vr6+9r6+vva+vr72vr6+9r6+vva+vr72vr6+9ry8vPZ+fn7NCwsLKhgYGFG+vr74/////////////////////////////////////////////////////v////7////+/////v////7////+/////v////7////+vb299xgYGFEZGRlRvr6+9/////////////////////////////////////////////////////7////+/////v////7////+/////v////7////+/////r29vfYZGRlRGRkZUb6+vvf////////////////////////////////////////////////////////////////////+/////v////////////////////++vr73GRkZURkZGVG+vr73//////////////////////Pz8//9/f3/9/f3//j4+P//////////////////////////////////////////////////////vr6+9xkZGVEZGRlRvb299+Pj4//9/f3/4ODg/8LCwv+dnZ3/rKys/7S0tP+ZmZn/3t7e/8zMzP/f39//1dXV/9TU1P/Kysr/39/f/8jIyP/e3t7/9/f3/7+/v/cZGRlRGRkZUb29vfeQkJD/t7e3/5WVlf99fX3/bm5u/39/f/9sbGz/e3t7/3Nzc/9cXFz/i4uL/4WFhf93d3f/Z2dn/21tbf9nZ2f/fHx8/9PT0//AwMD3GRkZURkZGVG9vb33iIiI/2ZmZv+goKD/zMzM/66urv+dnZ3/tbW1/5ycnP+6urr/oKCg/6ioqP96enr/srKy/5ycnP+3t7f/m5ub/7CwsP+6urr/vLy89xkZGVEZGRlRvr6+98rKyv+5ubn/9fX1///////////////////////////////////////+/v7/7Ozs/////////////////////////////////76+vvcZGRlRGRkZUb6+vvf///////////////////////////////////////////////////////////////////////////////////////////////++vr73GRkZURkZGVG+vr73////////////////////////////////////////////////////////////////////////////////////////////////vr6+9xkZGVEZGRlRwMDA9////////////////////////////////////////////////////////////////////////////////////////////////8DAwPcZGRlRFRUVUZ6envfU1NT/1NTU/9TU1P/U1NT/1NTU/9TU1P/U1NT/1NTU/9TU1P/U1NT/1NTU/9TU1P/U1NT/1NTU/9TU1P/U1NT/1NTU/9TU1P+enp73FRUVURAQEFF0dHT3lZSV/5KSkv+SkZL/mpma/52dnf+dnZ3/nZ2d/52dnf+dnZ3/nZ2d/52dnf+dnZ3/nZ2d/52dnf+dnZ3/nZ2d/52dnf+fn5//dnV29xAQEFETExNLmpqa9a2srf+op6j/paWl/8/Oz//i4eL/4eDh/+Hg4f/h4OH/4eDh/+Hg4f/h4OH/4eDh/+Hg4f/h4OH/4eDh/+Hg4f/i4eL/5eTl/6GgofUSEhJLBAQEFz4+Pr9jY2P2cG9w3XV0ddN3dnfTeHd403h3eNN4d3jTeHd403h3eNN4d3jTeHd403h3eNN4d3jTeHd403h3eNN3d3fTcXFx3mdnZ/I9PD3FAwMDGAgICAAAAABjAAAA5wAAAFIAAAAUAAAAFAAAABQAAAAUAAAAFAAAABQAAAAUAAAAFAAAABQAAAAUAAAAFAAAABQAAAAUAAAAFAAAAFYAAADSAAAAd0VFRQAAAAAAAAAAIQAAANwAAABYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABXAAAA6AAAADoAAAAAAAAAAAAAAAMAAACaAAAAbAQGAAABAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAECAAAFBwAAAAAAawAAAMEAAAANAAAAAAAAAAAJCwAAAAAAVQECALEEBgBkAAAAHTxPBAABAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQIAAJDBAAAAAAAiBQYAZgEBAKkAAAB6BQYAAAAAAAAAAAAABggALCg2ALIxQQD9Iy4C/ik2A9MTGQFyAAAAHDpMBAABAQAAAAAAAAAAAAABAQAASWIAAAAAAB4aIgB7NUcA2CYyAP4oNAP9HScCsQQFACQAAAAAAAAAAAgKAG0vPgD/Xn0A/2eJAP9EWgL/NkcE/io3A9ITGQFxAAAAGzA/BAA9UQAAAAAAGxggAHE1RgDSQ1oA/01mAP9qjQD/WHQB/yUwAv8FBgBcAAAAAAAAAAAAAAAtERcArFFsAPaLugD/lcYA/2uOAP9DWAL/NkcE/io3A9ASGAFyFx8AcjVGANBDWQD9S2QA/3CVAP+WyAD/iLUA/0tkAPcOEgCmAAAAJQAAAAAAAAAAAAAAAAAAABYAAACzISwAqFh2AOiMugD/lcYA/mqNAP9DWAL/JzQD/zBAAP9LZAD/a48A/5TFAP6ItgD/VHAA5B8pAJwAAACzAAAAGwAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAlQAAAB4AAAAzHigAr1VyAP2NvAD+k8QA/mWHAP9lhwD/k8QA/om2AP5OaAD7GyQApAAAACwAAAATAAAAlwAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAI8AAABDHScAbTdKANM1RwD+QFUA/5zRAP6l3AD/pdwA/5zRAP5AVQD/KzkD/Ss4A80VGwJmAAAAMwAAAJUAAAAJAAAAAAAAAAAAAAAA//8AAAAAABkTGgCsN0kA4UZdAP1GXQD/ZYYA/5HBAP+HtAD/VHEA7FVxAOyHtAD/lMUA/2uOAf9GXAP/O00E/Cs4A9gMEAG1AAAAGDNDAwAAAAAAAAAAAAoNADo3SQDNSGAA+0ZeAP9khQD/kMAA/4m3AP9WcgDoIi4AmAAAADcAAAA4Ii0AmVVyAOmKuAD/lMUA/2qOAf9GXAP/PVAE+io3A8UGBwAwAAAAAAAAAAAICgBeKTcA/2CAAP+QwAD/irgA/1d0AOgjLwCXAAAANQAAAAMEBgAABAYAAAAAAAMAAAA3JTEAm1t5AOuNvAD/lMUA/2WGAf8mMgL8BgcATgAAAAAAAAAAAAAAFBEXAHBJYQDPU28A4yQxAJQAAAA0AAAAAwUHAAAAAAAAAAAAAAAAAAAAAAAABQcAAAAAAAQAAAA6KDUAnFVxAOVGXQDJERcAZwAAABAAAAAAAAAAAAAAAABFXAAAAAAAHwAAAC8AAAADBgcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAoAAAAAAAUAAAAyAAAAGzJCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAEAI//xACP/8QAw/8MAID8BACAMAQAgAAEAMAADADAAAwAwAAMAMAADACAAAQAgDAEAID8BADj/xwA'
  const buffer = Uint8Array.from(atob(base64), function(c) { return c.charCodeAt(0); });
  return c.body(buffer, 200, { 'Content-Type': 'image/x-icon' });
});
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
    <title>Try Puppeteer - Online Playground for Browser Rendering</title>
    <link rel="icon" type="image/x-icon" href="/public/puppeteer.ico" />
    <meta name="description" content="An online playground to test and run Puppeteer scripts using Cloudflare Browser Rendering. Capture screenshots and JSON output instantly." />
    <meta name="keywords" content="Puppeteer, Cloudflare Workers, Browser Rendering, Headless Chrome, Online Playground" />
    <meta property="og:title" content="Try Puppeteer - Online Playground" />
    <meta property="og:description" content="Test and run Puppeteer scripts online with Cloudflare Browser Rendering." />
    <meta property="og:image" content="/public/puppeteer.png" />
    <meta property="og:type" content="website" />
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
          <div class="view" id="preview" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center;">
            <img src="/public/puppeteer.png" style="max-width:150px; opacity:0.3; margin-bottom:10px;" />
            <p class="placeholder" style="margin:0;">Run code to see screenshot or JSON output.</p>
          </div>
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
            previewEl.innerHTML = '<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center;"><img src="/public/puppeteer.png" style="max-width:150px; opacity:0.3; margin-bottom:10px;" /><p class="placeholder" style="margin:0;">No screenshot yet.</p></div>';
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

