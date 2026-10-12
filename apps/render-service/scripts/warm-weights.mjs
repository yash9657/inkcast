// Bake the two ONNX models the voice stage loads into INKCAST_MODEL_CACHE at image
// build time, so a cold render instance never downloads ~130 MB before speaking.
// Same calls and options as the voice stage itself (and as the root Dockerfile's
// `weights` stage, which explains each one). Fails the build if either is missing.
import { existsSync } from 'node:fs';

// Registered before kokoro-js loads: its phonemizer (an Emscripten module) installs
// handlers that rethrow and exit with code 7, which loses the original message.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    console.error(`warm-weights: ${event}:`, err);
    process.exit(1);
  });
}

const dir = process.env.INKCAST_MODEL_CACHE;
if (!dir) throw new Error('INKCAST_MODEL_CACHE is not set');

const transformers = await import('@huggingface/transformers');
transformers.env.cacheDir = dir;
transformers.env.useFSCache = true;
transformers.env.allowLocalModels = true;

const { KokoroTTS } = await import('kokoro-js');
console.log(`warming Kokoro (q8) into ${dir}`);
await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'q8',
  device: 'cpu',
});
console.log('warming the word aligner (q8)');
await transformers.pipeline(
  'automatic-speech-recognition',
  'onnx-community/whisper-tiny.en_timestamped',
  { dtype: 'q8', device: 'cpu' },
);

for (const repo of [
  'onnx-community/Kokoro-82M-v1.0-ONNX',
  'onnx-community/whisper-tiny.en_timestamped',
]) {
  if (!existsSync(`${dir}/${repo}`)) throw new Error(`weights missing: ${repo}`);
}
console.log('weights: baked');
