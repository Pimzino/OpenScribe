import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { getFileBuffer, arrayBufferToBase64, getMimeType, downloadFile } from "./utils";

export async function exportToHtml(markdown: string, fileName: string): Promise<void> {
    const html = await processMarkdownToHtml(markdown, fileName);
    const blob = new Blob([html], { type: 'text/html' });
    downloadFile(blob, `${fileName}.html`);
}

async function processMarkdownToHtml(markdown: string, fileName: string): Promise<string> {
    // Parse markdown to AST
    const processor = unified().use(remarkParse).use(remarkGfm);
    const ast = processor.parse(markdown);

    // Process AST nodes to HTML
    const contentHtml = await processNode(ast);

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(fileName)}</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #333; }
        img { max-width: 100%; height: auto; display: block; margin: 1em 0; }
        pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; border-radius: 4px; }
        code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 2px; font-family: monospace; }
        pre code { background: none; padding: 0; }
        h1, h2, h3 { margin-top: 1.5em; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        blockquote { border-left: 4px solid #ddd; padding-left: 1em; color: #666; margin: 1em 0; }
        ul, ol { padding-left: 2em; }
        a { color: #0066cc; }
    </style>
</head>
<body>
    ${contentHtml}
</body>
</html>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function processNode(node: any): Promise<string> {
    if (node.type === 'root') {
        const parts = [];
        for (const child of node.children) {
            parts.push(await processNode(child));
        }
        return parts.join('\n');
    }

    if (node.type === 'heading') {
        const content = await processChildren(node.children);
        return `<h${node.depth}>${content}</h${node.depth}>`;
    }

    if (node.type === 'paragraph') {
        const content = await processChildren(node.children);
        return `<p>${content}</p>`;
    }

    if (node.type === 'text') {
        return escapeHtml(node.value);
    }

    if (node.type === 'strong') {
        const content = await processChildren(node.children);
        return `<strong>${content}</strong>`;
    }

    if (node.type === 'emphasis') {
        const content = await processChildren(node.children);
        return `<em>${content}</em>`;
    }

    if (node.type === 'inlineCode') {
        return `<code>${escapeHtml(node.value)}</code>`;
    }

    if (node.type === 'code') {
        const lang = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : '';
        return `<pre><code${lang}>${escapeHtml(node.value)}</code></pre>`;
    }

    if (node.type === 'link') {
        const content = await processChildren(node.children);
        return `<a href="${escapeHtml(node.url)}">${content}</a>`;
    }

    if (node.type === 'image') {
        const buffer = await getFileBuffer(node.url);
        if (buffer) {
            const mimeType = getMimeType(node.url);
            const base64 = arrayBufferToBase64(buffer, mimeType);
            return `<img src="${base64}" alt="${escapeHtml(node.alt || '')}" />`;
        } else {
            console.warn(`Failed to load image for HTML export: ${node.url}`);
            return `<img src="${escapeHtml(node.url)}" alt="${escapeHtml(node.alt || '')}" />`;
        }
    }

    if (node.type === 'list') {
        const tag = node.ordered ? 'ol' : 'ul';
        const items = [];
        for (const item of node.children) {
            items.push(await processNode(item));
        }
        return `<${tag}>\n${items.join('\n')}\n</${tag}>`;
    }

    if (node.type === 'listItem') {
        const content = [];
        for (const child of node.children) {
            content.push(await processNode(child));
        }
        return `<li>${content.join('')}</li>`;
    }

    if (node.type === 'blockquote') {
        const content = [];
        for (const child of node.children) {
            content.push(await processNode(child));
        }
        return `<blockquote>${content.join('\n')}</blockquote>`;
    }

    if (node.type === 'thematicBreak') {
        return '<hr />';
    }

    if (node.type === 'break') {
        return '<br />';
    }

    if (node.type === 'html') {
        return node.value;
    }

    // For any unhandled node types, try to process children
    if (node.children) {
        return await processChildren(node.children);
    }

    return '';
}

async function processChildren(children: any[]): Promise<string> {
    const parts = [];
    for (const child of children) {
        parts.push(await processNode(child));
    }
    return parts.join('');
}
