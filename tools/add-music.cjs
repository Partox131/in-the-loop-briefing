#!/usr/bin/env node
// Lays a background music bed under a voiced clip (from scripts/voiceover.cjs).
// The music sits well below the voice and ducks further while someone speaks,
// comes up on the end card, and fades out with the video. The beds are made by
// scripts/make-music.py, so we own them outright.
//
//   node scripts/add-music.cjs voiced.mp4 music.wav out.mp4
const { execFileSync } = require('node:child_process');

// The voice is already at about -16 LUFS; the bed is set to BED_LUFS with a
// fixed gain (no dynamic levelling, which would pump the music up in pauses).
const BED_LUFS = -27;

/** The ffmpeg filter graph: [1:a] music under [0:a] voice, for a clip `dur` seconds long. */
function musicFilter(dur, musicLufs) {
  const fadeAt = Math.max(0, dur - 2).toFixed(2);
  const gain = (BED_LUFS - musicLufs).toFixed(1);
  return [
    '[0:a]asplit=2[vo][key]',
    `[1:a]atrim=0:${dur.toFixed(2)},volume=${gain}dB,afade=t=in:d=0.6,afade=t=out:st=${fadeAt}:d=2[bed]`,
    '[bed][key]sidechaincompress=threshold=0.03:ratio=4:attack=30:release=600[duck]',
    '[vo][duck]amix=inputs=2:normalize=0,alimiter=limit=0.89[out]',
  ].join(';');
}


function main() {
  const [clip, music, out] = process.argv.slice(2);
  if (!clip || !music || !out) throw new Error('usage: add-music.cjs voiced.mp4 music.wav out.mp4');
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip]).toString().trim());
  const r = require('node:child_process').spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', music, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const level = Number((r.stderr.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]);
  if (!Number.isFinite(level)) throw new Error(`Could not measure the loudness of ${music}`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip, '-i', music, '-filter_complex', musicFilter(dur, level),
    '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', out]);
  console.log(`Wrote ${out}`);
}

module.exports = { musicFilter };
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
