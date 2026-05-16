(async () => {
  const code = `const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  const pdf = await page.pdf({ format: 'A4' });
  output.setPdf(pdf);
  output.setJson({ success: true });
  await browser.close();
})();`;
  const res = await fetch('https://try-puppeteer.gohcx.workers.dev/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const data = await res.json();
  console.log('Has PDF:', !!data.pdf);
  if (data.pdf) console.log('PDF Length:', data.pdf.length);
  console.log('JSON:', data.json);
  console.log('Error:', data.error);
})();
