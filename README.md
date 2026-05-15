# try-puppeteer

Run Puppeteer snippets on Cloudflare Workers + Browser Rendering API.

## Local dev

```bash
npm install
npm run cf-typegen
npm run dev -- --remote
```

> Browser Rendering API requires `--remote` for real browser execution.

## Routes

- `GET /` UI playground
- `GET /examples` built-in example list
- `GET /examples/:id` get one example
- `POST /run` execute code

## Deploy

```bash
npm run deploy
```
