// Helpers for syncing H2 step headings between the documentation markdown
// blob and the per-step `title` field. Used in both directions:
//   - step title edit → rewrite the Nth H2 in the doc
//   - doc edit → read the Nth H2 back into step.title

const H2_PATTERN = /^[ \t]{0,3}##[ \t]+(.+?)[ \t]*$/gm;

export function extractH2s(markdown: string): string[] {
    if (!markdown) return [];
    const out: string[] = [];
    const re = new RegExp(H2_PATTERN.source, H2_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(markdown)) !== null) {
        out.push(match[1].trim());
    }
    return out;
}

export function replaceNthH2(markdown: string, index: number, newTitle: string): string {
    if (!markdown || index < 0) return markdown;
    const safeTitle = newTitle.replace(/\r?\n/g, " ").trim();
    if (!safeTitle) return markdown;

    let occurrence = -1;
    const re = new RegExp(H2_PATTERN.source, H2_PATTERN.flags);
    return markdown.replace(re, (whole) => {
        occurrence += 1;
        if (occurrence !== index) return whole;
        return `## ${safeTitle}`;
    });
}

// Defaults like "Step 1", "Step 2" mean "no custom title" — used when
// reading headings back into step.title so the user can revert to default
// by typing "Step N" in the doc editor.
export function isDefaultStepHeading(heading: string, stepIndex: number): boolean {
    return heading.trim() === `Step ${stepIndex + 1}`;
}
