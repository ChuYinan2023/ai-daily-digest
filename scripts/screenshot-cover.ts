/**
 * screenshot-cover.ts
 *
 * Uses Puppeteer to screenshot the cover HTML into a PNG image (900x383).
 *
 * Usage:
 *   npx puppeteer browsers install chrome
 *   bun scripts/screenshot-cover.ts <cover.html> [output.png]
 */

import { resolve } from 'node:path';
import process from 'node:process';

async function screenshotCover(htmlPath: string, pngPath: string): Promise<void> {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 383, deviceScaleFactor: 2 });

  const fileUrl = `file://${resolve(htmlPath)}`;
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });

  await page.screenshot({
    path: pngPath,
    type: 'png',
    clip: { x: 0, y: 0, width: 900, height: 383 },
  });

  await browser.close();
  console.log(`[screenshot] ✅ Cover PNG generated: ${pngPath}`);
}

// CLI
const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: bun scripts/screenshot-cover.ts <cover.html> [output.png]');
  process.exit(1);
}

const inputPath = args[0]!;
const outputPath = args[1] || inputPath.replace(/\.html$/, '.png');

await screenshotCover(inputPath, outputPath);
