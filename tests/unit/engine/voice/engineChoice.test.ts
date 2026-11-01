import { beforeEach, describe, expect, it } from 'vitest'
import { chooseDevice, getAutoResult, getEnginePref, setAutoResult, setEnginePref } from '@/engine/voice/choice/engineChoice'

describe('voice engine choice', () => {
  beforeEach(() => localStorage.clear())

  it('auto tests the GPU the first time, then uses the remembered result', () => {
    expect(chooseDevice('auto', true, null)).toEqual({ device: 'webgpu', test: true })
    setAutoResult({ device: 'wasm', gpuRtf: 4.2, at: 1 })
    expect(chooseDevice('auto', true, getAutoResult())).toEqual({ device: 'wasm', test: false })
  })

  it('respects manual choices and missing GPUs', () => {
    expect(chooseDevice('cpu', true, null)).toEqual({ device: 'wasm', test: false })
    expect(chooseDevice('gpu', true, { device: 'wasm', gpuRtf: 3, at: 1 })).toEqual({ device: 'webgpu', test: false })
    expect(chooseDevice('gpu', false, null)).toEqual({ device: 'wasm', test: false })
    expect(chooseDevice('auto', false, null)).toEqual({ device: 'wasm', test: false })
  })

  it('switching back to auto forgets the old test result', () => {
    setAutoResult({ device: 'wasm', gpuRtf: 3, at: 1 })
    setEnginePref('cpu')
    expect(getEnginePref()).toBe('cpu')
    setEnginePref('auto')
    expect(getEnginePref()).toBe('auto')
    expect(getAutoResult()).toBeNull()
  })
})

describe('engine attempt chain', () => {
  it('auto: GPU (speed-tested) then threaded processor then single-thread processor', async () => {
    const { attemptChain } = await import('@/engine/voice/choice/engineChoice')
    expect(attemptChain('auto', true, null, false)).toEqual([
      { device: 'webgpu', speedTest: true },
      { device: 'wasm', speedTest: false },
      { device: 'wasm', threads: 1, speedTest: false },
    ])
    expect(attemptChain('cpu', true, null, false).map((a) => a.threads)).toEqual([undefined, 1])
    expect(attemptChain('cpu', true, null, true)).toEqual([{ device: 'wasm', threads: 1, speedTest: false }])
    expect(attemptChain('gpu', true, null, false)).toEqual([{ device: 'webgpu', speedTest: false }])
    expect(attemptChain('auto', true, { device: 'wasm', gpuRtf: 3, at: 1 }, false)[0].device).toBe('wasm')
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
