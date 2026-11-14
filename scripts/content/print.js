// Prints book.html to an A4 PDF with page numbers. Usage: node print.js <in.html> <out.pdf>
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const [input, output] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.resolve(input), { waitUntil: "load" });
  await page.pdf({
    path: output,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="font-family:DejaVu Sans,Arial,sans-serif;font-size:7.5px;color:#6b7076;width:100%;padding:0 15mm;display:flex;justify-content:space-between">' +
      '<span>PRIMUS · Problem statements and crises</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    margin: { top: "15mm", bottom: "17mm", left: "15mm", right: "15mm" },
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
