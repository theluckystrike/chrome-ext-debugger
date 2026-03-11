#!/usr/bin/env node

/**
 * webext-debug CLI
 *
 * Usage:
 *   webext-debug scaffold <extension-path> [output-dir]  - Generate test suite
 *   webext-debug inspect <extension-path>                - Dump extension state
 *   webext-debug memory <extension-path> [duration]      - Profile memory
 *   webext-debug logs <extension-path>                   - Collect all logs
 *   webext-debug messages <extension-path>               - Trace message passing
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');

const [,, command, ...args] = process.argv;

const commands = new Map([
  ['scaffold', 'generators/scaffold.ts'],
  ['inspect', 'debug/inspect-state.ts'],
  ['memory', 'debug/profile-memory.ts'],
  ['logs', 'debug/collect-logs.ts'],
  ['messages', 'debug/trace-messages.ts'],
]);

if (!command || !commands.has(command)) {
  console.log(`
webext-debug - Universal Chrome Extension Testing & Debugging

Commands:
  scaffold <ext-path> [output-dir]  Generate a complete test suite for your extension
  inspect  <ext-path>               Dump all extension state (storage, tabs, alarms)
  memory   <ext-path> [duration]    Profile memory usage over time
  logs     <ext-path>               Collect console output from all contexts
  messages <ext-path>               Trace chrome.runtime message passing

Examples:
  webext-debug scaffold ./my-extension ./my-extension/tests
  webext-debug inspect ./my-extension/dist
  webext-debug memory ./my-extension/dist 60
  webext-debug logs ./my-extension/dist
`);
  process.exit(command ? 1 : 0);
}

const script = path.join(srcDir, commands.get(command));

// Use process.platform to handle Windows (npx.cmd) vs Unix (npx)
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npxCmd, ['tsx', script, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`Failed to start: ${err.message}`);
  console.error('Make sure "tsx" is installed: npm install -g tsx');
  process.exit(1);
});
