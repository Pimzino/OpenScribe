import type { ChangelogSection } from './changelog-data';

/**
 * Parses a raw markdown changelog body (from the Tauri updater's update.body)
 * into structured ChangelogSection[] for display.
 *
 * Expected format (from CHANGELOG.md extraction):
 *   ### Added
 *   - Item one
 *   - Item two
 *
 *   ### Fixed
 *   - Fix one
 */
export function parseChangelogBody(body: string): ChangelogSection[] {
    const sections: ChangelogSection[] = [];
    let currentSection: ChangelogSection | null = null;

    for (const line of body.split('\n')) {
        const trimmed = line.trim();

        // Match section headers like "### Added", "### Fixed", etc.
        const headerMatch = trimmed.match(/^###\s+(.+)$/);
        if (headerMatch) {
            if (currentSection && currentSection.items.length > 0) {
                sections.push(currentSection);
            }
            currentSection = { title: headerMatch[1].trim(), items: [] };
            continue;
        }

        // Match list items like "- Item text" or "* Item text"
        const itemMatch = trimmed.match(/^[-*]\s+(.+)$/);
        if (itemMatch && currentSection) {
            currentSection.items.push(itemMatch[1]);
        }
    }

    // Push the last section
    if (currentSection && currentSection.items.length > 0) {
        sections.push(currentSection);
    }

    return sections;
}
