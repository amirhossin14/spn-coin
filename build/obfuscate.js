#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  Build step: produces an obfuscated, ship-ready copy of the
 *  node source in ./dist. Original source files are never touched.
 * ─────────────────────────────────────────────────────────────
 *
 *  Usage:  npm run build        (obfuscate -> ./dist)
 *          npm run start:dist   (run the protected build)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// Directories never copied into the build output.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'data', 'uploads', 'ha',
]);

// File names that must NOT be obfuscated (copied verbatim instead).
const SKIP_OBFUSCATION_FILES = new Set([
  'eslint.config.js', // dev-only config, not shipped logic
]);

// Balanced options — safe for a Node.js server. We deliberately keep
// renameGlobals / selfDefending OFF so require(), module.exports and
// cross-file property access keep working.
const OBFUSCATION_OPTIONS = {
  target: 'node',
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

let jsCount = 0;
let copyCount = 0;

function rmrf(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function walk(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(srcPath, destPath);
      continue;
    }
    if (!entry.isFile()) continue;

    const isJs = entry.name.endsWith('.js');
    const obfuscate = isJs && !SKIP_OBFUSCATION_FILES.has(entry.name);

    if (obfuscate) {
      const code = fs.readFileSync(srcPath, 'utf8');
      const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATION_OPTIONS);
      fs.writeFileSync(destPath, result.getObfuscatedCode(), 'utf8');
      jsCount++;
    } else {
      fs.copyFileSync(srcPath, destPath);
      copyCount++;
    }
  }
}

console.log('🔒 [build] Obfuscating source -> ./dist');
rmrf(OUT);
walk(ROOT, OUT);

// Ship a production package.json that drops devDependencies and points
// scripts at the (already obfuscated) files in this folder.
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  delete pkg.devDependencies;
  pkg.scripts = {
    start: 'node server.js',
    testnet: 'node testnet/launch.js',
    cli: 'node cli/wallet-cli.js',
  };
  fs.writeFileSync(
    path.join(OUT, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n',
    'utf8',
  );
} catch (e) {
  console.warn('⚠️  [build] could not rewrite dist/package.json:', e.message);
}

console.log(`✅ [build] Done. Obfuscated ${jsCount} JS files, copied ${copyCount} assets.`);
console.log(`   Output: ${OUT}`);
console.log('   Run the protected build with:  npm run start:dist');
