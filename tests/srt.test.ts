import { describe, expect, it } from 'vitest'
import { buildSrt, parseSrt } from '../src/renderer/src/lib/srt'

const SAMPLE = `1
00:00:01,000 --> 00:00:03,500
Xin chào

2
00:00:04,000 --> 00:00:06,000
Dòng thứ hai
nhiều dòng

`

describe('parseSrt', () => {
  it('parses cues with multi-line text', () => {
    const cues = parseSrt(SAMPLE)
    expect(cues).toHaveLength(2)
    expect(cues[0].start).toBeCloseTo(1, 5)
    expect(cues[0].end).toBeCloseTo(3.5, 5)
    expect(cues[0].text).toBe('Xin chào')
    expect(cues[1].text).toBe('Dòng thứ hai\nnhiều dòng')
  })

  it('tolerates dots as millisecond separators and BOM', () => {
    const cues = parseSrt('\uFEFF1\n00:00:02.250 --> 00:00:05.750\nNội dung')
    expect(cues).toHaveLength(1)
    expect(cues[0].start).toBeCloseTo(2.25, 5)
    expect(cues[0].end).toBeCloseTo(5.75, 5)
  })

  it('skips malformed blocks', () => {
    const cues = parseSrt('không phải srt\n\n1\n00:00:01,000 --> 00:00:00,000\nđảo ngược')
    expect(cues).toHaveLength(0)
  })
})

describe('buildSrt', () => {
  it('round-trips through parseSrt', () => {
    const cues = [
      { start: 1.25, end: 3.0, text: 'Dòng A' },
      { start: 4.0, end: 7.999, text: 'Dòng B\nhai dòng' }
    ]
    const parsed = parseSrt(buildSrt(cues))
    expect(parsed).toHaveLength(2)
    expect(parsed[0].start).toBeCloseTo(1.25, 3)
    expect(parsed[1].end).toBeCloseTo(7.999, 3)
    expect(parsed[1].text).toBe('Dòng B\nhai dòng')
  })
})
