/**
 * to-wechat-html.ts
 *
 * Converts the AI Daily Digest Markdown into a WeChat-compatible HTML file
 * with all inline CSS styles (WeChat strips <style> blocks).
 *
 * Usage:
 *   bun scripts/to-wechat-html.ts <input.md> [output.html]
 *
 * Can also be imported and called programmatically:
 *   import { convertMarkdownToWechatHtml } from './to-wechat-html';
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

// ============================================================================
// Style Constants
// ============================================================================

const COLORS = {
  primary: '#1a73e8',
  primaryLight: '#e8f0fe',
  text: '#333333',
  textSecondary: '#666666',
  textLight: '#999999',
  bg: '#ffffff',
  bgCard: '#f7f8fa',
  bgQuote: '#f0f6ff',
  border: '#e5e5e5',
  borderLight: '#f0f0f0',
  accent: '#ff6b35',
  tagAI: '#1a73e8',
  tagSecurity: '#e53935',
  tagEngineering: '#43a047',
  tagTools: '#fb8c00',
  tagOpinion: '#8e24aa',
  tagOther: '#757575',
};

const CATEGORY_COLORS: Record<string, string> = {
  'AI / ML': COLORS.tagAI,
  '安全': COLORS.tagSecurity,
  '工程': COLORS.tagEngineering,
  '工具 / 开源': COLORS.tagTools,
  '观点 / 杂谈': COLORS.tagOpinion,
  '其他': COLORS.tagOther,
};

// ============================================================================
// HTML Building Helpers
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert markdown links [text](url) to plain text with source annotation */
function stripLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

/** Remove markdown bold/italic markers */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/** Convert inline markdown to HTML (bold, italic, code) */
function inlineMarkdownToHtml(text: string): string {
  // First strip links
  let result = stripLinks(text);
  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Inline code
  result = result.replace(/`([^`]+)`/g,
    `<code style="background:${COLORS.bgCard};padding:2px 6px;border-radius:3px;font-size:14px;color:${COLORS.accent};">$1</code>`);
  return result;
}

function getCategoryColor(label: string): string {
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (label.includes(key)) return color;
  }
  return COLORS.tagOther;
}

// ============================================================================
// Section Parsers
// ============================================================================

interface ParsedDigest {
  title: string;
  subtitle: string;
  highlights: string;
  topArticles: TopArticle[];
  stats: StatsRow | null;
  categories: CategorySection[];
  footer: string;
  tagCloud: string;
}

interface TopArticle {
  medal: string;
  titleZh: string;
  meta: string;
  summary: string;
  reason: string;
  keywords: string;
}

interface StatsRow {
  sources: string;
  articles: string;
  timeRange: string;
  selected: string;
}

interface CategorySection {
  emoji: string;
  label: string;
  articles: CategoryArticle[];
}

interface CategoryArticle {
  index: string;
  titleZh: string;
  meta: string;
  summary: string;
  keywords: string;
}

function parseDigestMarkdown(md: string): ParsedDigest {
  const lines = md.split('\n');
  const result: ParsedDigest = {
    title: '',
    subtitle: '',
    highlights: '',
    topArticles: [],
    stats: null,
    categories: [],
    footer: '',
    tagCloud: '',
  };

  let section = '';
  let currentTopArticle: Partial<TopArticle> | null = null;
  let currentCategory: CategorySection | null = null;
  let currentCatArticle: Partial<CategoryArticle> | null = null;
  let inMermaid = false;
  let inCodeBlock = false;
  let inDetails = false;
  let statsTableLineCount = 0;

  const flushTopArticle = () => {
    if (currentTopArticle?.titleZh) {
      result.topArticles.push(currentTopArticle as TopArticle);
    }
    currentTopArticle = null;
  };

  const flushCatArticle = () => {
    if (currentCatArticle?.titleZh && currentCategory) {
      currentCategory.articles.push(currentCatArticle as CategoryArticle);
    }
    currentCatArticle = null;
  };

  const flushCategory = () => {
    flushCatArticle();
    if (currentCategory && currentCategory.articles.length > 0) {
      result.categories.push(currentCategory);
    }
    currentCategory = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Skip mermaid blocks entirely
    if (trimmed.startsWith('```mermaid')) { inMermaid = true; continue; }
    if (inMermaid) {
      if (trimmed === '```') inMermaid = false;
      continue;
    }

    // Skip code blocks (ASCII charts)
    if (trimmed.startsWith('```') && !inCodeBlock) { inCodeBlock = true; continue; }
    if (inCodeBlock) {
      if (trimmed === '```') inCodeBlock = false;
      continue;
    }

    // Skip details/summary blocks
    if (trimmed.startsWith('<details>')) { inDetails = true; continue; }
    if (inDetails) {
      if (trimmed.startsWith('</details>')) inDetails = false;
      continue;
    }

    // Main title: # 📰 AI 博客每日精选 — 2026-02-15
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      result.title = trimmed.replace(/^# /, '');
      continue;
    }

    // Subtitle line (> 来自...)
    if (trimmed.startsWith('> 来自') && !section) {
      result.subtitle = trimmed.replace(/^> /, '');
      continue;
    }

    // Section headers
    if (trimmed.startsWith('## ')) {
      const sectionTitle = trimmed.replace(/^## /, '');

      if (sectionTitle.includes('今日看点')) {
        flushTopArticle();
        section = 'highlights';
      } else if (sectionTitle.includes('今日必读')) {
        section = 'top';
      } else if (sectionTitle.includes('数据概览')) {
        flushTopArticle();
        section = 'stats';
        statsTableLineCount = 0;
      } else {
        // Category sections like ## 🤖 AI / ML
        flushTopArticle();
        flushCategory();
        section = 'category';
        const match = sectionTitle.match(/^(\S+)\s+(.+)$/);
        if (match) {
          currentCategory = { emoji: match[1], label: match[2], articles: [] };
        }
      }
      continue;
    }

    // --- separator
    if (trimmed === '---') continue;

    // Tag cloud
    if (section === 'stats' && trimmed.startsWith('### ') && trimmed.includes('话题标签')) {
      section = 'tagcloud';
      continue;
    }
    if (section === 'tagcloud' && trimmed && !trimmed.startsWith('#')) {
      result.tagCloud = trimmed;
      section = 'stats'; // back to stats area
      continue;
    }

    // Skip chart sub-headers
    if (section === 'stats' && trimmed.startsWith('### ')) continue;

    // Process by section
    switch (section) {
      case 'highlights': {
        if (trimmed && !trimmed.startsWith('#')) {
          result.highlights += (result.highlights ? ' ' : '') + trimmed;
        }
        break;
      }

      case 'top': {
        // Medal line: 🥇 **标题**
        const medalMatch = trimmed.match(/^(🥇|🥈|🥉)\s+\*\*(.+)\*\*$/);
        if (medalMatch) {
          flushTopArticle();
          currentTopArticle = {
            medal: medalMatch[1],
            titleZh: medalMatch[2],
            meta: '',
            summary: '',
            reason: '',
            keywords: '',
          };
          continue;
        }

        if (!currentTopArticle) continue;

        // Meta line: [English Title](url) — source · time · category
        if (trimmed.startsWith('[') && trimmed.includes('](') && trimmed.includes(' — ')) {
          currentTopArticle.meta = stripLinks(trimmed);
          continue;
        }

        // Quote/summary: > summary text
        if (trimmed.startsWith('> ')) {
          currentTopArticle.summary = (currentTopArticle.summary || '') +
            (currentTopArticle.summary ? ' ' : '') + trimmed.replace(/^> /, '');
          continue;
        }

        // Reason: 💡 **为什么值得读**: ...
        if (trimmed.startsWith('💡')) {
          currentTopArticle.reason = trimmed
            .replace(/^💡\s*/, '')
            .replace(/\*\*为什么值得读\*\*:\s*/, '')
            .replace(/\*\*为什么值得读\*\*：\s*/, '');
          continue;
        }

        // Keywords: 🏷️ tag1, tag2
        if (trimmed.startsWith('🏷️') || trimmed.startsWith('🏷')) {
          currentTopArticle.keywords = trimmed.replace(/^🏷️?\s*/, '');
          continue;
        }
        break;
      }

      case 'stats': {
        // Parse the stats table
        if (trimmed.startsWith('|') && !trimmed.startsWith('|:')) {
          statsTableLineCount++;
          if (statsTableLineCount === 2) {
            // Data row
            const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
            if (cells.length >= 4) {
              result.stats = {
                sources: cells[0],
                articles: cells[1],
                timeRange: cells[2],
                selected: cells[3],
              };
            }
          }
        }
        break;
      }

      case 'category': {
        if (!currentCategory) continue;

        // Article sub-header: ### 1. 标题
        const artMatch = trimmed.match(/^### (\d+)\.\s+(.+)$/);
        if (artMatch) {
          flushCatArticle();
          currentCatArticle = {
            index: artMatch[1],
            titleZh: artMatch[2],
            meta: '',
            summary: '',
            keywords: '',
          };
          continue;
        }

        if (!currentCatArticle) continue;

        // Meta line
        if (trimmed.startsWith('[') && trimmed.includes('](') && trimmed.includes(' — ')) {
          currentCatArticle.meta = stripLinks(trimmed);
          continue;
        }

        // Summary
        if (trimmed.startsWith('> ')) {
          currentCatArticle.summary = (currentCatArticle.summary || '') +
            (currentCatArticle.summary ? ' ' : '') + trimmed.replace(/^> /, '');
          continue;
        }

        // Keywords
        if (trimmed.startsWith('🏷️') || trimmed.startsWith('🏷')) {
          currentCatArticle.keywords = trimmed.replace(/^🏷️?\s*/, '');
          continue;
        }
        break;
      }
    }

    // Footer lines (start with *)
    if (trimmed.startsWith('*') && trimmed.endsWith('*') && i > lines.length - 10) {
      result.footer += (result.footer ? '\n' : '') + stripInlineMarkdown(trimmed);
    }
  }

  // Flush remaining
  flushTopArticle();
  flushCategory();

  return result;
}

// ============================================================================
// HTML Renderer
// ============================================================================

function renderWechatHtml(parsed: ParsedDigest): string {
  // WeChat editor compatibility notes:
  // - NO display:flex (use <table> instead)
  // - NO box-sizing
  // - Use <section> for block wrappers
  // - Expand margin/padding shorthand to full form
  // - border-radius works but keep simple
  // - display:inline-block works

  const wrap = (inner: string) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(stripInlineMarkdown(parsed.title))}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
<section style="max-width:100%;margin-left:auto;margin-right:auto;padding-top:20px;padding-bottom:20px;padding-left:16px;padding-right:16px;color:${COLORS.text};font-size:16px;line-height:1.8;">
${inner}
</section>
</body>
</html>`;

  let html = '';

  // ── Title ──
  const titleText = stripInlineMarkdown(parsed.title).replace(/^📰\s*/, '');
  html += `<h1 style="text-align:center;font-size:24px;font-weight:bold;color:${COLORS.text};margin-top:10px;margin-bottom:6px;margin-left:0;margin-right:0;line-height:1.4;">${escapeHtml(titleText)}</h1>\n`;

  html += `<p style="text-align:center;font-size:14px;color:${COLORS.textSecondary};margin-top:0;margin-bottom:24px;margin-left:0;margin-right:0;">90个顶级技术博客。AI精选每日必读。</p>\n`;

  // ── Highlights (引用色块) ──
  if (parsed.highlights) {
    html += `<section style="background-color:${COLORS.bgQuote};border-left:4px solid ${COLORS.primary};border-radius:8px;padding-top:16px;padding-bottom:16px;padding-left:18px;padding-right:18px;margin-top:0;margin-bottom:24px;margin-left:0;margin-right:0;font-size:15px;line-height:1.8;color:${COLORS.text};">\n`;
    html += `<strong style="display:block;margin-bottom:6px;font-size:16px;color:${COLORS.primary};">📝 今日看点</strong>\n`;
    html += `<span>${escapeHtml(parsed.highlights)}</span>\n`;
    html += `</section>\n`;
  }

  // ── Top 3 Cards ──
  if (parsed.topArticles.length > 0) {
    html += `<h2 style="font-size:20px;font-weight:bold;color:${COLORS.text};margin-top:28px;margin-bottom:16px;margin-left:0;margin-right:0;padding-bottom:8px;border-bottom:2px solid ${COLORS.primary};">🏆 今日必读 Top 3</h2>\n`;

    for (const art of parsed.topArticles) {
      const borderColor = art.medal === '🥇' ? '#FFD700' : art.medal === '🥈' ? '#C0C0C0' : '#CD7F32';

      html += `<section style="background-color:${COLORS.bgCard};border-radius:8px;border-left:4px solid ${borderColor};padding-top:16px;padding-bottom:16px;padding-left:18px;padding-right:18px;margin-top:0;margin-bottom:16px;margin-left:0;margin-right:0;">\n`;

      // Medal + title
      html += `<p style="font-size:18px;font-weight:bold;color:${COLORS.text};margin-top:0;margin-bottom:8px;margin-left:0;margin-right:0;">${art.medal} ${escapeHtml(art.titleZh)}</p>\n`;

      // Meta (source, time, category)
      if (art.meta) {
        const metaParts = art.meta.split(' — ');
        const metaRight = metaParts.length > 1 ? metaParts[1] : '';
        const catParts = metaRight.split(' · ').map(s => s.trim());
        let metaHtml = '';
        for (const part of catParts) {
          const catColor = getCategoryColor(part);
          if (part.match(/[🤖🔒⚙️🛠💡📝]/)) {
            metaHtml += ` <span style="display:inline-block;background-color:${catColor};color:white;font-size:12px;padding-top:2px;padding-bottom:2px;padding-left:8px;padding-right:8px;border-radius:4px;margin-left:4px;">${escapeHtml(part)}</span>`;
          } else {
            metaHtml += (metaHtml ? ' · ' : '') + `<span>${escapeHtml(part)}</span>`;
          }
        }
        html += `<p style="font-size:13px;color:${COLORS.textSecondary};margin-top:0;margin-bottom:10px;margin-left:0;margin-right:0;">${metaHtml}</p>\n`;
      }

      // Summary
      if (art.summary) {
        html += `<p style="font-size:15px;line-height:1.8;color:${COLORS.text};margin-top:0;margin-bottom:8px;margin-left:0;margin-right:0;">${escapeHtml(art.summary)}</p>\n`;
      }

      // Reason highlight
      if (art.reason) {
        html += `<section style="background-color:#fff8e1;border-radius:4px;padding-top:8px;padding-bottom:8px;padding-left:12px;padding-right:12px;font-size:14px;color:#e65100;margin-top:0;margin-bottom:8px;margin-left:0;margin-right:0;">💡 <strong>推荐理由：</strong>${escapeHtml(art.reason)}</section>\n`;
      }

      // Keywords
      if (art.keywords) {
        const tags = art.keywords.split(/[,，]\s*/).map(t => t.trim()).filter(Boolean);
        html += `<p style="margin-top:6px;margin-bottom:0;margin-left:0;margin-right:0;">`;
        for (const tag of tags) {
          html += `<span style="display:inline-block;background-color:${COLORS.primaryLight};color:${COLORS.primary};font-size:12px;padding-top:2px;padding-bottom:2px;padding-left:8px;padding-right:8px;border-radius:4px;margin-top:2px;margin-bottom:2px;margin-left:0;margin-right:4px;">${escapeHtml(tag)}</span>`;
        }
        html += `</p>\n`;
      }

      html += `</section>\n`;
    }
  }

  // ── Stats Overview (use <table> instead of flex) ──
  if (parsed.stats) {
    html += `<h2 style="font-size:20px;font-weight:bold;color:${COLORS.text};margin-top:28px;margin-bottom:16px;margin-left:0;margin-right:0;padding-bottom:8px;border-bottom:2px solid ${COLORS.primary};">📊 数据概览</h2>\n`;

    const statsItems = [
      { label: '扫描源', value: parsed.stats.sources },
      { label: '抓取文章', value: parsed.stats.articles },
      { label: '时间范围', value: parsed.stats.timeRange },
      { label: '精选', value: stripInlineMarkdown(parsed.stats.selected) },
    ];

    html += `<table style="width:100%;border-collapse:collapse;background-color:${COLORS.bgCard};border-radius:8px;margin-top:0;margin-bottom:16px;margin-left:0;margin-right:0;"><tbody><tr>\n`;
    for (const item of statsItems) {
      html += `<td style="text-align:center;padding-top:16px;padding-bottom:16px;padding-left:8px;padding-right:8px;width:25%;"><p style="font-size:18px;font-weight:bold;color:${COLORS.primary};margin-top:0;margin-bottom:4px;margin-left:0;margin-right:0;">${escapeHtml(item.value)}</p><p style="font-size:12px;color:${COLORS.textLight};margin-top:0;margin-bottom:0;margin-left:0;margin-right:0;">${escapeHtml(item.label)}</p></td>\n`;
    }
    html += `</tr></tbody></table>\n`;
  }

  // 不输出 Tag Cloud（数据概览后面的标签）

  // ── Divider ──
  html += `<p style="border-top:1px dashed ${COLORS.border};margin-top:24px;margin-bottom:24px;margin-left:0;margin-right:0;height:0;overflow:hidden;">&nbsp;</p>\n`;

  // ── Category Articles ──
  for (const cat of parsed.categories) {
    const catColor = getCategoryColor(cat.label);

    html += `<h2 style="font-size:20px;font-weight:bold;color:${COLORS.text};margin-top:24px;margin-bottom:16px;margin-left:0;margin-right:0;"><span style="display:inline-block;background-color:${catColor};color:white;font-size:14px;padding-top:2px;padding-bottom:2px;padding-left:10px;padding-right:10px;border-radius:4px;margin-right:8px;vertical-align:middle;">${cat.emoji} ${escapeHtml(cat.label)}</span></h2>\n`;

    for (const art of cat.articles) {
      html += `<section style="border-bottom:1px dashed ${COLORS.borderLight};padding-top:12px;padding-bottom:12px;padding-left:0;padding-right:0;margin-top:0;margin-bottom:4px;margin-left:0;margin-right:0;">\n`;

      // Title with index
      html += `<p style="font-size:16px;font-weight:bold;color:${COLORS.text};margin-top:0;margin-bottom:6px;margin-left:0;margin-right:0;"><span style="color:${COLORS.primary};margin-right:4px;">${escapeHtml(art.index)}.</span> ${escapeHtml(art.titleZh)}</p>\n`;

      // Meta
      if (art.meta) {
        const metaClean = stripInlineMarkdown(art.meta);
        html += `<p style="font-size:13px;color:${COLORS.textLight};margin-top:0;margin-bottom:6px;margin-left:0;margin-right:0;">${escapeHtml(metaClean)}</p>\n`;
      }

      // Summary
      if (art.summary) {
        html += `<p style="font-size:15px;line-height:1.8;color:${COLORS.textSecondary};margin-top:0;margin-bottom:0;margin-left:0;margin-right:0;">${escapeHtml(art.summary)}</p>\n`;
      }

      // Keywords
      if (art.keywords) {
        const tags = art.keywords.split(/[,，]\s*/).map(t => t.trim()).filter(Boolean);
        html += `<p style="margin-top:6px;margin-bottom:0;margin-left:0;margin-right:0;">`;
        for (const tag of tags) {
          html += `<span style="display:inline-block;background-color:${COLORS.primaryLight};color:${COLORS.primary};font-size:12px;padding-top:1px;padding-bottom:1px;padding-left:6px;padding-right:6px;border-radius:3px;margin-top:2px;margin-bottom:2px;margin-left:0;margin-right:3px;">${escapeHtml(tag)}</span>`;
        }
        html += `</p>\n`;
      }

      html += `</section>\n`;
    }
  }

  // ── Footer / Follow CTA ──
  html += `<p style="border-top:1px dashed ${COLORS.border};margin-top:24px;margin-bottom:24px;margin-left:0;margin-right:0;height:0;overflow:hidden;">&nbsp;</p>\n`;
  html += `<section style="text-align:center;padding-top:20px;padding-bottom:20px;padding-left:0;padding-right:0;">\n`;
  html += `<p style="font-size:16px;font-weight:bold;color:${COLORS.primary};margin-top:0;margin-bottom:8px;margin-left:0;margin-right:0;">📬 每日精选，不错过任何技术热点</p>\n`;
  html += `<p style="font-size:14px;color:${COLORS.textSecondary};margin-top:0;margin-bottom:12px;margin-left:0;margin-right:0;">关注「碳硅边界」公众号，获取更多 AI 实用技巧</p>\n`;
  // 不输出点击关注按钮
  html += `</section>\n`;

  // Footer meta (去掉最后一句「懂点儿AI」相关)
  if (parsed.footer) {
    const footerLines = parsed.footer.split('\n').filter(Boolean).filter(l => !l.includes('懂点儿AI'));
    if (footerLines.length > 0) {
      html += `<section style="text-align:center;font-size:12px;color:${COLORS.textLight};margin-top:16px;margin-bottom:0;margin-left:0;margin-right:0;line-height:1.6;">\n`;
      for (const fl of footerLines) {
        html += `<p style="margin-top:0;margin-bottom:4px;margin-left:0;margin-right:0;">${escapeHtml(fl)}</p>\n`;
      }
      html += `</section>\n`;
    }
  }

  return wrap(html);
}

// ============================================================================
// Public API
// ============================================================================

export async function convertMarkdownToWechatHtml(mdPath: string, htmlPath: string): Promise<void> {
  const md = await readFile(mdPath, 'utf-8');
  const parsed = parseDigestMarkdown(md);
  const html = renderWechatHtml(parsed);
  await writeFile(htmlPath, html, 'utf-8');
  console.log(`[wechat-html] ✅ HTML generated: ${htmlPath}`);
}

// ============================================================================
// CLI entry
// ============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: bun scripts/to-wechat-html.ts <input.md> [output.html]');
    process.exit(1);
  }

  const inputPath = args[0]!;
  const outputPath = args[1] || inputPath.replace(/\.md$/, '.html');

  await convertMarkdownToWechatHtml(inputPath, outputPath);
}
