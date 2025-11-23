import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, ExternalHyperlink, BorderStyle } from "docx";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { getFileBuffer, downloadFile } from "./utils";

export async function exportToWord(markdown: string, fileName: string): Promise<void> {
    // Parse markdown to AST
    const processor = unified().use(remarkParse).use(remarkGfm);
    const ast = processor.parse(markdown);

    const children: any[] = [];

    // Recursive function to process AST nodes
    async function processNode(node: any): Promise<any[]> {
        if (node.type === 'root') {
            const nodes = [];
            for (const child of node.children) {
                nodes.push(...await processNode(child));
            }
            return nodes;
        }

        if (node.type === 'heading') {
            const text = node.children.map((c: any) => c.value).join('');
            let headingLevel: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1;
            if (node.depth === 2) headingLevel = HeadingLevel.HEADING_2;
            if (node.depth === 3) headingLevel = HeadingLevel.HEADING_3;

            return [new Paragraph({
                text: text,
                heading: headingLevel,
                spacing: { before: 200, after: 100 }
            })];
        }

        if (node.type === 'paragraph') {
            const runs = [];
            for (const child of node.children) {
                if (child.type === 'text') {
                    runs.push(new TextRun(child.value));
                } else if (child.type === 'strong') {
                    runs.push(new TextRun({ text: child.children[0].value, bold: true }));
                } else if (child.type === 'emphasis') {
                    runs.push(new TextRun({ text: child.children[0].value, italics: true }));
                } else if (child.type === 'inlineCode') {
                    runs.push(new TextRun({ text: child.value, font: "Courier New" }));
                } else if (child.type === 'link') {
                    runs.push(new ExternalHyperlink({
                        children: [
                            new TextRun({
                                text: child.children[0]?.value || child.url,
                                style: "Hyperlink",
                            }),
                        ],
                        link: child.url,
                    }));
                } else if (child.type === 'image') {
                    // Handle inline images in paragraph
                    const buffer = await getFileBuffer(child.url);
                    if (buffer) {
                        runs.push(new ImageRun({
                            data: buffer,
                            transformation: { width: 500, height: 300 },
                            type: "png",
                        }));
                    }
                }
            }
            return [new Paragraph({ children: runs, spacing: { after: 200 } })];
        }

        if (node.type === 'list') {
            const items = [];
            for (const item of node.children) {
                // Assuming simple list items for now
                const text = item.children[0]?.children[0]?.value || "";
                items.push(new Paragraph({
                    text: text,
                    bullet: { level: 0 }
                }));
            }
            return items;
        }

        if (node.type === 'code') {
            return [new Paragraph({
                children: [new TextRun({ text: node.value, font: "Courier New" })],
                spacing: { before: 200, after: 200 },
                border: {
                    top: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 },
                    bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 },
                    left: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 },
                    right: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 },
                }
            })];
        }

        // Handle standalone images
        if (node.type === 'image') {
            const buffer = await getFileBuffer(node.url);
            if (buffer) {
                return [new Paragraph({
                    children: [new ImageRun({
                        data: buffer,
                        transformation: { width: 500, height: 300 },
                        type: "png",
                    })]
                })];
            }
        }

        return [];
    }

    // Process all top-level nodes
    for (const node of ast.children) {
        children.push(...await processNode(node));
    }

    const doc = new Document({
        sections: [{
            properties: {},
            children: children,
        }],
    });

    const blob = await Packer.toBlob(doc);
    downloadFile(blob, `${fileName}.docx`);
}
