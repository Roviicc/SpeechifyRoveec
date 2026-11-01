// Real Kokoro benchmark in Node (CPU / onnxruntime-node). Prints load time and real-time factor.
// RTF = generation time / audio length. Smooth playback at speed S needs RTF < 1/S.
// For WebGPU numbers, open the app's Voice test page with ?debug=1 on your device.
// Usage: npm run bench:tts [-- --dtype q8|fp32|q4]
import { KokoroTTS } from 'kokoro-js'

const dtype = process.argv.includes('--dtype') ? process.argv[process.argv.indexOf('--dtype') + 1] : 'q8'
const SENTENCES = [
  'Alice was beginning to get very tired of sitting by her sister on the bank.',
  'Dr. Smith arrived at 3.14 p.m. on a grey Tuesday.',
  'The lab smelled of coffee and solder; nobody had slept.',
  'Sound travels as a pressure wave through air at roughly 343 metres per second.',
  'Warmer air carries sound faster, a point discussed at length elsewhere.',
  '“Curiouser and curiouser!” cried Alice.',
  'Engineers designing concert halls take all of these factors into account when they plan the shape of a room.',
  'In another moment down went Alice after it, never once considering how in the world she was to get out again.',
  'It was all very well to say “Drink me,” but the wise little Alice was not going to do that in a hurry.',
  'Humidity has a smaller effect than temperature, but it is still measurable with careful instruments.',
]

const t0 = performance.now()
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device: 'cpu' })
const loadMs = performance.now() - t0
await tts.generate('Warm up.', { voice: 'af_heart' })
const rtfs = []
for (const s of SENTENCES) {
  const a = performance.now()
  const audio = await tts.generate(s, { voice: 'af_heart' })
  const gen = (performance.now() - a) / 1000
  const dur = audio.audio.length / audio.sampling_rate
  rtfs.push(gen / dur)
  console.log(`${(gen / dur).toFixed(3)}  ${dur.toFixed(2)}s  ${s.slice(0, 60)}`)
}
rtfs.sort((x, y) => x - y)
const avg = rtfs.reduce((x, y) => x + y, 0) / rtfs.length
console.log(`\ndevice=cpu(node) dtype=${dtype} load=${(loadMs / 1000).toFixed(1)}s avgRTF=${avg.toFixed(3)} p95RTF=${rtfs[Math.min(rtfs.length - 1, Math.floor(rtfs.length * 0.95))].toFixed(3)}`)
