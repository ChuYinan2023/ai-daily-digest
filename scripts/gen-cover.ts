/**
 * gen-cover.ts
 *
 * Generates a WeChat cover image HTML (900x383) from the digest Markdown.
 * Open the HTML in a browser and screenshot to get the cover image.
 *
 * Usage:
 *   bun scripts/gen-cover.ts <input.md> [output-cover.html]
 *
 * Can also be imported:
 *   import { generateCoverHtml } from './gen-cover';
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

interface CoverData {
  date: string;
  top3: string[];
  topKeywords: string[];
}

function parseCoverData(md: string): CoverData {
  const lines = md.split('\n');
  const result: CoverData = { date: '', top3: [], topKeywords: [] };

  // Extract date from title: # 📰 AI 博客每日精选 — 2026-02-15
  for (const line of lines) {
    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch && !result.date) {
      result.date = dateMatch[1];
    }
  }

  // Extract top 3 titles: 🥇 **title** / 🥈 **title** / 🥉 **title**
  for (const line of lines) {
    const medalMatch = line.trim().match(/^(🥇|🥈|🥉)\s+\*\*(.+)\*\*$/);
    if (medalMatch && result.top3.length < 3) {
      result.top3.push(medalMatch[2]);
    }
  }

  // Extract top keywords from tag cloud line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes('(') && trimmed.includes(' · ')) {
      const parts = trimmed.split(' · ').slice(0, 5);
      for (const part of parts) {
        const m = part.match(/\*?\*?(.+?)\*?\*?\((\d+)\)$/);
        if (m) result.topKeywords.push(m[1].replace(/\*/g, ''));
      }
      break;
    }
  }

  return result;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function renderCoverHtml(data: CoverData): string {
  const medals = ['🥇', '🥈', '🥉'];

  // Format date for display
  const dateParts = data.date.split('-');
  const displayDate = dateParts.length === 3
    ? `${dateParts[0]}年${parseInt(dateParts[1])}月${parseInt(dateParts[2])}日`
    : data.date;

  let topHtml = '';
  for (let i = 0; i < Math.min(3, data.top3.length); i++) {
    const opacity = i === 0 ? '1' : i === 1 ? '0.85' : '0.7';
    const fontSize = i === 0 ? '20px' : '17px';
    topHtml += `<div style="opacity:${opacity};font-size:${fontSize};margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:700px;">${medals[i]} ${escapeHtml(truncate(data.top3[i], 30))}</div>\n`;
  }

  let kwHtml = '';
  for (const kw of data.topKeywords.slice(0, 5)) {
    kwHtml += `<span style="display:inline-block;border:1px solid rgba(255,220,150,0.5);color:rgba(255,235,200,0.9);font-size:12px;padding:2px 10px;border-radius:12px;margin-right:6px;margin-bottom:4px;">${escapeHtml(kw)}</span>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 900px; height: 383px; overflow: hidden; }
</style>
</head>
<body>
<div style="width:900px;height:383px;background:linear-gradient(135deg,#1a0a00 0%,#3d1800 25%,#8b3a00 55%,#d4760a 80%,#f5a623 100%);color:white;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;position:relative;overflow:hidden;">

<!-- Decorative circles (warm glow) -->
<div style="position:absolute;top:-60px;right:-40px;width:280px;height:280px;border-radius:50%;background:rgba(245,166,35,0.15);"></div>
<div style="position:absolute;bottom:-80px;left:-60px;width:220px;height:220px;border-radius:50%;background:rgba(255,140,0,0.1);"></div>
<div style="position:absolute;top:30px;right:100px;width:100px;height:100px;border-radius:50%;background:rgba(255,200,50,0.08);"></div>

<!-- Content -->
<div style="position:relative;z-index:1;padding:36px 48px;">

  <!-- Header row -->
  <div style="margin-bottom:16px;">
    <span style="font-size:13px;color:rgba(255,255,255,0.6);letter-spacing:2px;">DAILY TECH DIGEST</span>
    <span style="float:right;font-size:13px;color:rgba(255,255,255,0.5);">碳硅边界</span>
  </div>

  <!-- Title -->
  <div style="font-size:32px;font-weight:bold;margin-bottom:6px;letter-spacing:1px;">📰 推特AI降噪</div>
  <div style="font-size:18px;color:rgba(255,255,255,0.7);margin-bottom:24px;">${escapeHtml(displayDate)}</div>

  <!-- Divider -->
  <div style="width:60px;height:3px;background:rgba(255,220,150,0.6);border-radius:2px;margin-bottom:20px;"></div>

  <!-- Top 3 -->
  <div style="color:rgba(255,255,255,0.95);line-height:1.5;">
${topHtml}  </div>

  <!-- Keywords -->
  ${kwHtml ? `<div style="position:absolute;bottom:28px;left:48px;">${kwHtml}</div>` : ''}

  <!-- Bottom right badge -->
  <div style="position:absolute;bottom:28px;right:48px;font-size:12px;color:rgba(255,255,255,0.4);">Powered by Gemini AI · 90 RSS Sources</div>

</div>
</div>
</body>
</html>`;
}

// ============================================================================
// Public API
// ============================================================================

export async function generateCoverHtml(mdPath: string, coverPath: string): Promise<void> {
  const md = await readFile(mdPath, 'utf-8');
  const data = parseCoverData(md);
  const html = renderCoverHtml(data);
  await writeFile(coverPath, html, 'utf-8');
  console.log(`[cover] ✅ Cover HTML generated: ${coverPath}`);
}

// ============================================================================
// CLI entry
// ============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: bun scripts/gen-cover.ts <input.md> [output-cover.html]');
    process.exit(1);
  }

  const inputPath = args[0]!;
  const outputPath = args[1] || inputPath.replace(/\.md$/, '-cover.html');

  await generateCoverHtml(inputPath, outputPath);
}
