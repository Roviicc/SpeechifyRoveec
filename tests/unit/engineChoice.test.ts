import { beforeEach, describe, expect, it } from 'vitest'
import { chooseDevice, getAutoResult, getEnginePref, setAutoResult, setEnginePref } from '../../src/engine/tts/engineChoice'

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
