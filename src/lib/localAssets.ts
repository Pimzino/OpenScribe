import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getParentDirectory, isLocalFilePath, normalizeImagePath } from "./pathUtils";

export async function registerLocalAssetScope(path: string): Promise<void> {
    if (!path || !isLocalFilePath(path)) {
        return;
    }

    const normalizedPath = normalizeImagePath(path);
    const parentDirectory = getParentDirectory(normalizedPath);

    if (!parentDirectory) {
        return;
    }

    await invoke("register_asset_scope", { path: parentDirectory });
}

export async function resolveDisplayImageSrc(src: string): Promise<string> {
    if (!src) {
        return "";
    }

    if (!isLocalFilePath(src)) {
        return src;
    }

    const normalizedPath = normalizeImagePath(src);
    await registerLocalAssetScope(normalizedPath);
    return convertFileSrc(normalizedPath);
}
