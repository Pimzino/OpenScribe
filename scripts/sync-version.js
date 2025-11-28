#!/usr/bin/env node

/**
 * Syncs version from package.json to Cargo.toml
 * Run: node scripts/sync-version.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Read version from package.json (source of truth)
const packageJsonPath = join(rootDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

console.log(`📦 Version from package.json: ${version}`);

// Update Cargo.toml
const cargoTomlPath = join(rootDir, 'src-tauri', 'Cargo.toml');
let cargoToml = readFileSync(cargoTomlPath, 'utf-8');

const versionRegex = /^version\s*=\s*"[^"]*"/m;
const currentCargoVersion = cargoToml.match(versionRegex)?.[0];

if (currentCargoVersion) {
    const newVersionLine = `version = "${version}"`;
    if (currentCargoVersion !== newVersionLine) {
        cargoToml = cargoToml.replace(versionRegex, newVersionLine);
        writeFileSync(cargoTomlPath, cargoToml);
        console.log(`✅ Updated Cargo.toml: ${currentCargoVersion} → ${newVersionLine}`);
    } else {
        console.log(`✅ Cargo.toml already in sync`);
    }
} else {
    console.error('❌ Could not find version in Cargo.toml');
    process.exit(1);
}

console.log(`\n🎉 Version synced to ${version}`);
