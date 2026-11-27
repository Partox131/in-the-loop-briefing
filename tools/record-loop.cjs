#!/usr/bin/env node
// Records "Today's loop" from the live map as a 1080 × 1920 video for
// TikTok, Shorts and Reels (Amir, 26 Nov 2026: the daily clip is the phone
// loop, recorded). Needs Playwright with Chromium, and ffmpeg.
//
//   node scripts/record-loop.cjs [url] [out.mp4]
//
// url defaults to https://inthelooplive.com/; add ?segment=us or
// ?segment=ca for those segments, or demo=1 for sample data. The page is
// opened at phone size (432 × 768 CSS px at 2.5×, so 1080 × 1920 pixels) with
// ?clip=1, which plays the loop on its own and ends on a card with the
// address. Frames come from Chrome's screencast and are timed as they arrive.
// Next to the video it writes <out>.cues.json: when each story card appeared
// (seconds from the first frame) and what it said, for scripts/voiceover.cjs.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const url = new URL(process.argv[2] || 'https://inthelooplive.com/');
url.searchParams.set('clip', '1');
const out = path.resolve(process.argv[3] || `loop-${new Date().toISOString().slice(0, 10)}.mp4`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itl-loop-'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true, colorScheme: 'light' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let done = false;
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url.href, { waitUntil: 'load' });
  // Wait for the map, then record until the end card has shown for a while.
  await page.waitForSelector('.pshell .map svg', { timeout: 60_000 });
  // Note each story card as it appears, for the voiceover.
  const cues = [];
  const poll = setInterval(async () => {
    const c = await page.evaluate(() => {
      const cap = document.querySelector('.loopcap h2');
      if (document.querySelector('.clipend')) return { end: true };
      if (!cap) return null;
      return { headline: (cap.dataset.full || cap.textContent).trim(), where: document.querySelector('.loophead strong')?.textContent.trim() || '', status: document.querySelector('.loopcap .chip')?.textContent.trim() || '', sources: Number((document.querySelector('.loopcap p')?.textContent.match(/(\d+) source/) || [])[1]) || 0 };
    }).catch(() => null);
    if (!c) return;
    const last = cues.at(-1);
    if (c.end ? !last?.end : c.headline !== last?.headline) cues.push({ ...c, at: Date.now() / 1000 });
  }, 100);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  const started = Date.now();
  await page.waitForSelector('.clipend', { timeout: 120_000 }).catch(() => console.error('No end card after 2 minutes; keeping what was recorded.'));
  await page.waitForTimeout(6000); // room for the closing line
  await cdp.send('Page.stopScreencast');
  clearInterval(poll);
  done = true;
  await browser.close();
  if (frames.length < 2) throw new Error('No frames recorded.');
  // ffmpeg concat list: each frame lasts until the next one arrived.
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? f.t + 0.04) - f.t)).toFixed(3)}`).join('\n');
  fs.writeFileSync(path.join(dir, 'list.txt'), `${list}\nfile '${frames.at(-1).file}'\n`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true, force: true });
  const t0 = frames[0].t;
  fs.writeFileSync(out.replace(/\.mp4$/, '') + '.cues.json', JSON.stringify({ duration: frames.at(-1).t - t0, cues: cues.map(({ at, ...c }) => ({ t: Math.max(0, at - t0), ...c })) }, null, 2) + '\n');
  console.log(`Wrote ${out} (${((Date.now() - started) / 1000).toFixed(0)} s recorded, ${frames.length} frames, done=${done}).`);
})().catch((e) => { console.error(e); process.exit(1); });
