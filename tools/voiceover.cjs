#!/usr/bin/env node
// Adds a spoken voiceover to a clip from scripts/record-loop.cjs, reading
// its <clip>.cues.json: each story card is read out as it appears ("Strait of
// Hormuz. Tanker seized ..."), then a closing line on the end card. Confirmed
// stories get no status line (Amir, 27 Nov 2026); a story that is not
// confirmed keeps a short caveat, so the voice never states a claim as fact. Uses Piper, a free open-source text-to-speech engine that runs
// offline (https://github.com/rhasspy/piper), and ffmpeg. No AI writes the
// words: they are the card's own text.
//
//   TTS=piper PIPER=/path/to/piper VOICE=/path/to/voice.onnx node scripts/voiceover.cjs clip.mp4 out.mp4 [segmentWord]
//   TTS=kokoro VOICE=af_heart node scripts/voiceover.cjs clip.mp4 out.mp4 [segmentWord]
//   ... voiceover.cjs --sample "Some text." out.wav     (one line, for voice samples)
//
// Kokoro (scripts/tts-kokoro.py) sounds far more natural than Piper; both are
// free and run offline. A story line that runs longer than its card is sped
// up a little (at most 1.15×), then cut at the next card, so voices never
// overlap. The closing line is never sped up or cut: if it needs more time
// than the end card has, the last frame is held until it finishes.
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

const MAX_TEMPO = 1.15;

/** Speaks each text into dir/l<i>.wav with the engine in TTS (piper or kokoro). */
function synth(texts, dir) {
  const engine = process.env.TTS || 'piper', voice = process.env.VOICE;
  if (!voice) throw new Error('Set VOICE (a Piper .onnx file, or a Kokoro voice name such as af_heart).');
  if (engine === 'kokoro') {
    execFileSync(process.env.PYTHON || 'python3', [path.join(__dirname, 'tts-kokoro.py'), voice, dir, process.env.SPEED || '1.0'], { input: JSON.stringify(texts), stdio: ['pipe', 'ignore', 'inherit'] });
  } else {
    texts.forEach((t, i) => execFileSync(process.env.PIPER || 'piper', ['--model', voice, '--output_file', path.join(dir, `l${i}.wav`), '--length_scale', '0.95', '--sentence_silence', '0.15'], { input: t, stdio: ['pipe', 'ignore', 'inherit'] }));
  }
  return texts.map((_, i) => path.join(dir, `l${i}.wav`));
}

/** Where each line goes: story lines fit their card; the closing line always plays in full. */
function plan(cues, lens, duration) {
  let hold = 0;
  const parts = cues.map((c, i) => {
    const start = c.t + 0.35;
    if (c.end || i === cues.length - 1) {
      const need = start + lens[i] + 1.2;
      hold = Math.max(0, need - duration);
      return { start, tempo: 1, cut: null };
    }
    const room = cues[i + 1].t - start - 0.2;
    const tempo = Math.min(MAX_TEMPO, Math.max(1, lens[i] / Math.max(0.5, room)));
    return { start, tempo, cut: lens[i] / tempo > room ? Math.max(0.5, room) : null };
  });
  return { parts, hold };
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--sample') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itl-vo-'));
    fs.copyFileSync(synth([args[1]], dir)[0], args[2]);
    return;
  }
  const [clip, out, segWord] = args;
  if (!clip || !out) throw new Error('usage: voiceover.cjs clip.mp4 out.mp4 [segmentWord]');
  const { cues, duration } = JSON.parse(fs.readFileSync(clip.replace(/\.mp4$/, '') + '.cues.json', 'utf8'));
  if (!cues.length) throw new Error('No cues: the loop did not show any story.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itl-vo-'));
  const lines = cues.map((c) => lineFor(c, segWord));
  const raws = synth(lines, dir);
  const { parts, hold } = plan(cues, raws.map(seconds), duration);
  const fits = parts.map((p, i) => {
    const fit = path.join(dir, `f${i}.wav`);
    const af = [`atempo=${p.tempo.toFixed(3)}`];
    if (p.cut) af.push(`afade=t=out:st=${Math.max(0, p.cut - 0.15).toFixed(2)}:d=0.15`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raws[i], '-af', af.join(','), ...(p.cut ? ['-t', p.cut.toFixed(2)] : []), fit]);
    console.log(`${p.start.toFixed(1)} s  ${p.tempo > 1 ? `(×${p.tempo.toFixed(2)}) ` : ''}${p.cut ? '(cut) ' : ''}${lines[i]}`);
    return fit;
  });
  const inputs = fits.flatMap((f) => ['-i', f]);
  const delays = parts.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.start * 1000)}|${Math.round(p.start * 1000)}[a${i}]`).join(';');
  const video = hold > 0 ? `[0:v]tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}[v];` : '';
  const mix = `${video}${delays};${parts.map((_, i) => `[a${i}]`).join('')}amix=inputs=${parts.length}:normalize=0,apad,loudnorm=I=-16:TP=-1.5:LRA=11[vo]`;
  const total = (duration + hold).toFixed(2);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip, ...inputs, '-filter_complex', mix, '-map', hold > 0 ? '[v]' : '0:v', '-map', '[vo]',
    ...(hold > 0 ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy']),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', total, '-movflags', '+faststart', out]);
  if (hold > 0) console.log(`Held the end card ${hold.toFixed(1)} s longer so the closing line plays in full.`);
  fs.writeFileSync(out.replace(/\.mp4$/, '') + '.script.txt', lines.join('\n') + '\n');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Wrote ${out}`);
}

module.exports = { lineFor, cleanHeadline, plan };
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
