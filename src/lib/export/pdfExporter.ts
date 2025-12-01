import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import { getFileBuffer, arrayBufferToBase64, getMimeType, saveFile } from "./utils";

// Register fonts for pdfmake
// @ts-ignore
pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

export async function exportToPdf(markdown: string, fileName: string): Promise<void> {
    // Parse markdown to AST
    const processor = unified().use(remarkParse).use(remarkGfm);
    const ast = processor.parse(markdown);

    const content: any[] = [];

    // Recursive function to process AST nodes for pdfmake
    async function processNode(node: any): Promise<any> {
        if (node.type === 'root') {
            const nodes = [];
            for (const child of node.children) {
                const processed = await processNode(child);
                if (processed) {
                    if (Array.isArray(processed)) nodes.push(...processed);
                    else nodes.push(processed);
                }
            }
            return nodes;
        }

        if (node.type === 'heading') {
            const text = node.children.map((c: any) => c.value).join('');
            const style = `header${node.depth}`; // header1, header2, etc.
            return { text, style, margin: [0, 10, 0, 5] };
        }

        if (node.type === 'paragraph') {
            const contentBlocks: any[] = [];
            let textParts: any[] = [];

            // Helper to flush accumulated text parts
            const flushTextParts = () => {
                if (textParts.length > 0) {
                    contentBlocks.push({ text: textParts, margin: [0, 0, 0, 10] });
                    textParts = [];
                }
            };

            for (const child of node.children) {
                if (child.type === 'text') {
                    textParts.push(child.value);
                } else if (child.type === 'strong') {
                    textParts.push({ text: child.children[0].value, bold: true });
                } else if (child.type === 'emphasis') {
                    textParts.push({ text: child.children[0].value, italics: true });
                } else if (child.type === 'inlineCode') {
                    textParts.push({ text: child.value, background: '#f0f0f0', font: 'Courier' });
                } else if (child.type === 'link') {
                    textParts.push({ text: child.children[0]?.value || child.url, link: child.url, decoration: 'underline', color: 'blue' });
                } else if (child.type === 'image') {
                    // Flush any accumulated text before the image
                    flushTextParts();

                    // Add image as standalone content block (pdfmake can't render images in text arrays)
                    const buffer = await getFileBuffer(child.url);
                    if (buffer) {
                        const mimeType = getMimeType(child.url);
                        const base64 = arrayBufferToBase64(buffer, mimeType);
                        contentBlocks.push({ image: base64, width: 500, margin: [0, 10, 0, 10] });
                    } else {
                        console.warn(`Failed to load image for PDF export: ${child.url}`);
                    }
                }
            }

            // Flush any remaining text
            flushTextParts();

            // Return based on content
            if (contentBlocks.length === 1) {
                return contentBlocks[0];
            } else if (contentBlocks.length > 1) {
                return contentBlocks;
            }
        }

        if (node.type === 'list') {
            const listType = node.ordered ? 'ol' : 'ul';
            const items = [];
            for (const item of node.children) {
                // Flatten list item children for simplicity
                const itemContent = [];
                for (const child of item.children) {
                    const processed = await processNode(child);
                    if (processed) {
                        if (Array.isArray(processed)) itemContent.push(...processed);
                        else itemContent.push(processed);
                    }
                }
                items.push(itemContent);
            }
            return { [listType]: items, margin: [0, 0, 0, 10] };
        }

        if (node.type === 'code') {
            return {
                text: node.value,
                style: 'code',
                background: '#f4f4f4',
                margin: [0, 5, 0, 15],
                preserveLeadingSpaces: true
            };
        }

        if (node.type === 'image') {
            const buffer = await getFileBuffer(node.url);
            if (buffer) {
                const mimeType = getMimeType(node.url);
                const base64 = arrayBufferToBase64(buffer, mimeType);
                return { image: base64, width: 500, margin: [0, 10, 0, 10] };
            } else {
                console.warn(`Failed to load image for PDF export: ${node.url}`);
            }
        }

        return null;
    }

    // Process all top-level nodes
    for (const node of ast.children) {
        const processed = await processNode(node);
        if (processed) {
            if (Array.isArray(processed)) content.push(...processed);
            else content.push(processed);
        }
    }

    const docDefinition = {
        content: content,
        styles: {
            title: { fontSize: 24, bold: true },
            header1: { fontSize: 22, bold: true, margin: [0, 20, 0, 10] },
            header2: { fontSize: 18, bold: true, margin: [0, 15, 0, 8] },
            header3: { fontSize: 16, bold: true, margin: [0, 10, 0, 5] },
            code: { font: 'Courier', fontSize: 10 }
        },
        defaultStyle: {
            fontSize: 12,
            font: 'Roboto'
        }
    } as any;

    const pdfDoc = pdfMake.createPdf(docDefinition);

    const buffer = await new Promise<Uint8Array>((resolve) => {
        pdfDoc.getBuffer((buffer: Buffer) => {
            resolve(new Uint8Array(buffer));
        });
    });

    await saveFile(buffer, `${fileName}.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
}
