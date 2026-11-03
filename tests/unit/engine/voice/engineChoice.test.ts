import { beforeEach, describe, expect, it } from 'vitest'
import { attemptChain, migrateEnginePrefs } from '@/engine/voice/choice/engineChoice'

describe('Natural voice engine: GPU first, processor only as fallback', () => {
  beforeEach(() => localStorage.clear())

  it('tries the GPU (no speed test) then threaded and single-thread processor', () => {
    expect(attemptChain(true, false)).toEqual([{ device: 'webgpu' }, { device: 'wasm' }, { device: 'wasm', threads: 1 }])
    expect(attemptChain(true, true)).toEqual([{ device: 'webgpu' }, { device: 'wasm', threads: 1 }])
  })

  it('goes straight to the processor when the device has no WebGPU adapter', () => {
    expect(attemptChain(false, false)).toEqual([{ device: 'wasm' }, { device: 'wasm', threads: 1 }])
    expect(attemptChain(false, true)).toEqual([{ device: 'wasm', threads: 1 }])
  })

  it("migrates the old Auto / Processor engine choice to the GPU (the stored prefs are removed)", () => {
    localStorage.setItem('lumen-voice-engine', 'cpu')
    localStorage.setItem('lumen-voice-auto', JSON.stringify({ device: 'wasm', gpuRtf: 3, at: 1 }))
    localStorage.setItem('lumen-voice-single-thread', '1')
    migrateEnginePrefs()
    expect(localStorage.getItem('lumen-voice-engine')).toBeNull()
    expect(localStorage.getItem('lumen-voice-auto')).toBeNull()
    // unrelated: the processor's single-thread memory stays
    expect(localStorage.getItem('lumen-voice-single-thread')).toBe('1')
  })
})

describe('auto voice', () => {
  beforeEach(() => localStorage.clear())
  it('defaults to auto, tests Kokoro once, then sticks to the decision', async () => {
    const m = await import('@/engine/voice/choice/engineChoice')
    expect(m.getVoicePref()).toBe('auto')
    expect(m.effectiveVoice()).toBe('kokoro')
    expect(m.shouldTestKokoro()).toBe(true)
    m.setAutoVoice('piper')
    expect(m.effectiveVoice()).toBe('piper')
    expect(m.shouldTestKokoro()).toBe(false)
    m.setVoicePref('kokoro')
    expect(m.effectiveVoice()).toBe('kokoro')
    expect(m.shouldTestKokoro()).toBe(false)
  })
})
