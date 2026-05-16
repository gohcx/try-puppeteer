# Try Puppeteer on Cloudflare Workers 🌐

[English](/README.md) | [简体中文](#简体中文)

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/gohcx/try-puppeteer">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers" />
  </a>
</p>

<p align="center">
  <a href="https://star-history.com/#gohcx/try-puppeteer&Date">
    <img src="https://api.star-history.com/svg?repos=gohcx/try-puppeteer&type=Date" alt="Star Rating" />
  </a>
</p>

---

<h2 id="简体中文">简体中文</h2>

这是一个为 [Cloudflare Workers Browser Rendering API](https://developers.cloudflare.com/browser-rendering/) 量身打造的高性能、安全且支持实时交互的 **Puppeteer 在线演练场 (Playground)**。无需配置本地环境，直接在浏览器里编写、测试和预览 Puppeteer 爬虫脚本！

### ✨ 核心特性

- **现代化的交互界面**：提供暗色模式的代码编辑器，开箱即用。
- **丰富的预览模式**：支持全网页截图预览、PDF 生成（内置阅读器并支持本地下载）以及自带语法高亮的 JSON 数据解析。
- **边缘安全沙盒执行**：为了打破 V8 引擎对动态代码生成的限制，项目深度集成了 `sval` 解释器。通过 AST 解析逐行安全执行用户代码，彻底消除了 `eval()` 带来的安全隐患。
- **防泄漏与生命周期接管**：针对 Puppeteer 实例容易引发的 `429 Rate limit exceeded` 报错问题，引入了 JavaScript Proxy 代理模式接管生命周期。无论用户代码死循环、抛出异常还是中途中断，底层都能自动完成浏览器资源的回收。
- **新手实战教程**：内置多个实用教学案例，包括：SEO 数据提取、移动端模拟、等待策略以及屏蔽图片的网络拦截。

### 🚀 本地开发

1. 安装依赖：
```bash
npm install
```

2. 生成类型声明：
```bash
npm run cf-typegen
```

3. 启动开发服务器：
```bash
npm run dev -- --remote
```
> **注意**: Browser Rendering API 需要带上 `--remote` 参数，以便连接到 Cloudflare 真实的云端浏览器资源。

### 🗺️ API 路由说明

- `GET /` - 访问前端 UI 界面
- `GET /examples` - 获取内置教程列表
- `GET /examples/:id` - 获取指定教程的代码详情
- `POST /run` - 在沙盒环境中执行提交的 Puppeteer 脚本

### ☁️ 如何部署

除了使用顶部的“一键部署”按钮，你也可以通过 Wrangler 命令行手动推送到你的 Cloudflare 账号：
```bash
npm run deploy
```
**部署前请确保：** 你的 Cloudflare 账户已开通 Browser Rendering 权限，并且 `wrangler.toml` 中的 `MYBROWSER` 绑定设置正确无误。
