import { invoke } from "@tauri-apps/api/core";
import { isHttpUrl, normalizeImagePath } from "../pathUtils";

// Helper to read file as Uint8Array
export async function getFileBuffer(path: string): Promise<Uint8Array | null> {
    try {
        if (isHttpUrl(path)) {
            const cleanPath = path.trim();
            const response = await fetch(cleanPath);
            const buffer = await response.arrayBuffer();
            return new Uint8Array(buffer);
        }

        const data = await invoke<number[]>("read_file_bytes", {
            path: normalizeImagePath(path),
        });
        return Uint8Array.from(data);
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

// Helper to save file using native file picker
export async function saveFile(data: Uint8Array, fileName: string, filters: { name: string; extensions: string[] }[]): Promise<boolean> {
    return invoke<boolean>("save_file_via_dialog", {
        data: Array.from(data),
        defaultName: fileName,
        filters,
    });
}
