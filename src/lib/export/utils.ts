import { readFile } from "@tauri-apps/plugin-fs";

// Helper to read file as Uint8Array
export async function getFileBuffer(path: string): Promise<Uint8Array | null> {
    console.log(`Attempting to read file: ${path}`);
    try {
        let cleanPath = path;

        // Decode URI components (e.g. %20 -> space)
        try {
            cleanPath = decodeURIComponent(cleanPath);
        } catch (e) {
            // Ignore if malformed
        }

        // Remove file:// prefix
        if (cleanPath.startsWith('file://')) {
            cleanPath = cleanPath.slice(7);
            // Handle Windows /C:/... -> C:/...
            if (navigator.userAgent.includes('Windows') && cleanPath.startsWith('/') && cleanPath.includes(':')) {
                cleanPath = cleanPath.slice(1);
            }
        }

        console.log(`Cleaned path: ${cleanPath}`);

        if (cleanPath.startsWith('http')) {
            const response = await fetch(cleanPath);
            const buffer = await response.arrayBuffer();
            console.log(`Fetched http file, size: ${buffer.byteLength}`);
            return new Uint8Array(buffer);
        }

        const data = await readFile(cleanPath);
        console.log(`Read local file, size: ${data.length}`);
        return data;
    } catch (error) {
        console.error(`Failed to read file: ${path}`, error);
        return null;
    }
}

// Helper to convert Uint8Array to Base64
export function arrayBufferToBase64(buffer: Uint8Array, mimeType: string): string {
    const base64 = uint8ArrayToBase64(buffer);
    return `data:${mimeType};base64,${base64}`;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    const CHUNK_SIZE = 0x8000; // 32KB
    for (let i = 0; i < len; i += CHUNK_SIZE) {
        const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return window.btoa(binary);
}

// Helper to determine mime type
export function getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'image/png';
}

// Helper to trigger file download
export function downloadFile(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}
