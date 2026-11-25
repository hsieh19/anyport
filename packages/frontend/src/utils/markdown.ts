import { marked } from 'marked';

/**
 * 将 Markdown 字符串渲染为 HTML
 * 开启 GFM (GitHub Flavored Markdown) 并保持换行友好
 */
export function renderMarkdown(content: string | null | undefined): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  try {
    return marked.parse(content, {
      async: false,
      gfm: true,
      breaks: true,
    }) as string;
  } catch (err) {
    console.error('Failed to parse markdown:', err);
    return content;
  }
}
