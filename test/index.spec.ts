import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('try-puppeteer worker', () => {
it('serves html shell', async () => {
const request = new IncomingRequest('http://example.com/');
const ctx = createExecutionContext();
const response = await worker.fetch(request, env, ctx);
await waitOnExecutionContext(ctx);
expect(response.status).toBe(200);
expect(await response.text()).toContain('try-puppeteer');
});

it('returns built-in examples list', async () => {
const response = await SELF.fetch('https://example.com/examples');
const body = await response.json<{ examples: Array<{ id: string }> }>();
expect(response.status).toBe(200);
expect(body.examples.some((example) => example.id === 'screenshot')).toBe(true);
});

it('rejects oversized code in /run', async () => {
const oversized = 'a'.repeat(10001);
const response = await SELF.fetch('https://example.com/run', {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({ code: oversized }),
});
		const body = await response.json<{ error: string }>();
		expect(response.status).toBe(400);
		expect(body.error).toContain('Max 10,000 characters');
	});

it('rejects forbidden keywords in /run', async () => {
const response = await SELF.fetch('https://example.com/run', {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({ code: 'console.log(process.env.SECRET)' }),
});
const body = await response.json<{ error: string }>();
expect(response.status).toBe(400);
expect(body.error).toContain('blocked');
});
});
