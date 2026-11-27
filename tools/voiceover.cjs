#!/usr/bin/env node
// Adds a spoken voiceover to a clip from scripts/record-loop.cjs, reading
// its <clip>.cues.json: each story card is read out as it appears ("Strait of
// Hormuz. Tanker seized ..."), then a closing line on the end card. Confirmed
// stories get no status line (Amir, 27 Nov 2026); a story that is not
// confirmed keeps a short caveat, so the voice never states a claim as fact. Uses Piper, a free open-source text-to-speech engine that runs
// offline (https://github.com/rhasspy/piper), and ffmpeg. No AI writes the
// words: they are the card's own text.
//
//   PIPER=/path/to/piper VOICE=/path/to/voice.onnx node scripts/voiceover.cjs clip.mp4 out.mp4 [segmentWord]
//
// A line that runs longer than its card is sped up a little (at most 1.3×),
// then cut at the next card, so voices never overlap.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATUS_LINE = {
  'Reported once': () => 'Not yet confirmed.',
  'Claimed by one side': () => "That's one side's claim.",
  'Sources disagree': () => 'Sources disagree.',
};

/** Drops what outlets tack onto a title: " | The Jerusalem Post", " – Europe live", " - Reuters". */
function cleanHeadline(h) {
  let s = String(h || '').replace(/…$/, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+\|\s+[^|]{2,60}$/, '');
  s = s.replace(/\s+[–—-]\s+[^–—-]{0,40}\blive( blog| updates)?$/i, '');
  s = s.replace(/\s+[–—-]\s+(Reuters|AP|AP News|BBC News|CBC News|CNN|Al Jazeera|The Guardian|NPR|Politico|Axios)$/i, '');
  return s.trim();
}

/** What to say for one card: plain words a speech engine reads well. */
function lineFor(c, segWord = 'around the world') {
  if (c.end) return `That's today's loop. Follow what's moving ${segWord}, live, at in the loop live dot com.`;
  const head = cleanHeadline(c.headline).replace(/([^.!?])$/, '$1.');
  const status = STATUS_LINE[c.status]?.(c.sources) || '';
  const where = c.where && !head.toLowerCase().startsWith(c.where.toLowerCase()) ? `${c.where}. ` : '';
  return `${where}${head} ${status}`.trim();
}

const seconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

function main() {
  const [clip, out, segWord] = process.argv.slice(2);
  if (!clip || !out) throw new Error('usage: voiceover.cjs clip.mp4 out.mp4 [segmentWord]');
  const { cues, duration } = JSON.parse(fs.readFileSync(clip.replace(/\.mp4$/, '') + '.cues.json', 'utf8'));
  if (!cues.length) throw new Error('No cues: the loop did not show any story.');
  const piper = process.env.PIPER || 'piper', voice = process.env.VOICE;
  if (!voice) throw new Error('Set VOICE to a Piper .onnx voice file.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itl-vo-'));
  const parts = [];
  cues.forEach((c, i) => {
    const raw = path.join(dir, `l${i}.wav`), fit = path.join(dir, `f${i}.wav`);
    execFileSync(piper, ['--model', voice, '--output_file', raw, '--length_scale', '0.95', '--sentence_silence', '0.15'], { input: lineFor(c, segWord), stdio: ['pipe', 'ignore', 'inherit'] });
    const start = c.t + 0.35;
    const room = (cues[i + 1]?.t ?? duration) - start - 0.2;
    const len = seconds(raw);
    const tempo = Math.min(1.3, Math.max(1, len / Math.max(0.5, room)));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', `atempo=${tempo.toFixed(3)},afade=t=out:st=${Math.max(0, room - 0.15).toFixed(2)}:d=0.15`, '-t', Math.max(0.5, room).toFixed(2), fit]);
    parts.push({ file: fit, start });
    console.log(`${start.toFixed(1)} s  ${tempo > 1 ? `(×${tempo.toFixed(2)}) ` : ''}${lineFor(c, segWord)}`);
  });
  const inputs = parts.flatMap((p) => ['-i', p.file]);
  const delays = parts.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.start * 1000)}|${Math.round(p.start * 1000)}[a${i}]`).join(';');
  const mix = `${delays};${parts.map((_, i) => `[a${i}]`).join('')}amix=inputs=${parts.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[vo]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[vo]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]);
  fs.writeFileSync(out.replace(/\.mp4$/, '') + '.script.txt', cues.map((c) => lineFor(c, segWord)).join('\n') + '\n');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Wrote ${out}`);
}

module.exports = { lineFor, cleanHeadline };
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
