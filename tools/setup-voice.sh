#!/usr/bin/env bash
# Installs the text-to-speech engine for one voice and writes <dir>/voice.env
# (TTS, VOICE, PIPER) for scripts/voiceover.cjs. Used by the clip workflows.
#   bash setup-voice.sh kokoro:af_heart "$RUNNER_TEMP"
#   bash setup-voice.sh piper:ryan "$RUNNER_TEMP"
set -euo pipefail
spec="${1:-kokoro:af_heart}"; dir="$2"
engine="${spec%%:*}"; name="${spec#*:}"
case "$engine" in
  kokoro)
    case "$name" in af_heart|af_bella|af_nicole|am_michael|am_fenrir|am_puck|bf_emma|bf_isabella|bm_george|bm_fable) ;; *) echo "Unknown Kokoro voice $name" >&2; exit 1 ;; esac
    if ! python3 -c 'import kokoro' 2>/dev/null; then
      pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu
      pip install --quiet kokoro==0.9.4 soundfile
    fi
    printf 'TTS=kokoro\nVOICE=%s\n' "$name" > "$dir/voice.env" ;;
  piper)
    case "$name" in
      ryan) path=en/en_US/ryan/high/en_US-ryan-high ;;
      lessac) path=en/en_US/lessac/high/en_US-lessac-high ;;
      *) echo "Unknown Piper voice $name" >&2; exit 1 ;;
    esac
    [ -x "$dir/piper/piper" ] || curl -sL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz | tar xz -C "$dir"
    curl -sL -o "$dir/piper-$name.onnx" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/$path.onnx"
    curl -sL -o "$dir/piper-$name.onnx.json" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/$path.onnx.json"
    printf 'TTS=piper\nVOICE=%s\nPIPER=%s\n' "$dir/piper-$name.onnx" "$dir/piper/piper" > "$dir/voice.env" ;;
  *) echo "Voice must be kokoro:<name> or piper:<name>" >&2; exit 1 ;;
esac
cat "$dir/voice.env"
