#!/usr/bin/env tsx
/**
 * Memory Profiler for Chrome Extensions
 *
 * Usage: npx tsx src/debug/profile-memory.ts /path/to/extension [duration_seconds]
 *
 * Takes periodic heap snapshots and reports memory growth.
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const extPath = process.argv[2] || process.env.EXTENSION_PATH;
const durationSec = parseInt(process.argv[3] || '30', 10);

if (!extPath) {
  console.error('Usage: profile-memory <extension-path> [duration_seconds]');
  process.exit(1);
}

const resolvedPath = path.resolve(extPath);

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Extension Memory Profiler            ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`Extension: ${resolvedPath}`);
  console.log(`Duration: ${durationSec}s with snapshots every 5s\n`);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${resolvedPath}`,
      `--load-extension=${resolvedPath}`,
      '--no-first-run',
    ],
  });

  const page = context.pages()[0] ?? await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  const snapshots: Array<{ time: number; heapUsedMB: number; heapTotalMB: number; nodes: number; listeners: number }> = [];
  const intervals = Math.ceil(durationSec / 5);

  for (let i = 0; i <= intervals; i++) {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x: any) => [x.name, x.value]));

    const snap = {
      time: i * 5,
      heapUsedMB: (m.JSHeapUsedSize ?? 0) / 1024 / 1024,
      heapTotalMB: (m.JSHeapTotalSize ?? 0) / 1024 / 1024,
      nodes: m.Nodes ?? 0,
      listeners: m.JSEventListeners ?? 0,
    };
    snapshots.push(snap);

    console.log(
      `[${String(snap.time).padStart(3)}s] Heap: ${snap.heapUsedMB.toFixed(2)} MB / ${snap.heapTotalMB.toFixed(2)} MB | ` +
      `Nodes: ${snap.nodes} | Listeners: ${snap.listeners}`
    );

    if (i < intervals) await new Promise(r => setTimeout(r, 5000));
  }

  await cdp.send('Performance.disable');
  await cdp.detach();
  await context.close();

  // Analysis
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const heapGrowth = ((last.heapUsedMB - first.heapUsedMB) / first.heapUsedMB) * 100;
  const nodeGrowth = last.nodes - first.nodes;
  const listenerGrowth = last.listeners - first.listeners;

  console.log('\n--- Summary ---');
  console.log(`Heap growth: ${heapGrowth.toFixed(1)}% (${first.heapUsedMB.toFixed(2)} -> ${last.heapUsedMB.toFixed(2)} MB)`);
  console.log(`Node growth: ${nodeGrowth > 0 ? '+' : ''}${nodeGrowth}`);
  console.log(`Listener growth: ${listenerGrowth > 0 ? '+' : ''}${listenerGrowth}`);

  if (heapGrowth > 20) console.warn('\n⚠ WARNING: Heap grew >20% - possible memory leak');
  if (nodeGrowth > 100) console.warn('⚠ WARNING: DOM nodes grew significantly - check for leaks');
  if (listenerGrowth > 50) console.warn('⚠ WARNING: Event listeners growing - check for unremoved listeners');

  if (heapGrowth <= 20 && nodeGrowth <= 100 && listenerGrowth <= 50) {
    console.log('\n✓ Memory profile looks healthy');
  }

  // Save raw data
  const outDir = path.resolve(process.cwd(), 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'memory-profile.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshots, null, 2));
  console.log(`\nRaw data saved to: ${outPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
