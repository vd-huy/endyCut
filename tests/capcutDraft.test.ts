import { describe, expect, it } from 'vitest'
import {
  capcutDraftToDocument,
  closestAspect,
  mapEffectKind,
  mapTransitionType,
  parseTextContent,
  type CapcutDraftContent
} from '../src/renderer/src/core/template/capcutDraft'

const DRAFT_FOLDER = 'C:/fake/draft'

function buildDraft(): CapcutDraftContent {
  return {
    canvas_config: { width: 1080, height: 1920, ratio: 'original' },
    duration: 6500000,
    fps: 30,
    name: 'Mẫu test',
    tracks: [
      {
        id: 't1',
        type: 'video',
        name: '',
        segments: [
          {
            id: 's1',
            material_id: 'mv1',
            target_timerange: { start: 0, duration: 4000000 },
            source_timerange: { start: 500000, duration: 8000000 },
            extra_material_refs: ['sp1', 'fd1', 'fi1'],
            render_index: 0,
            volume: 1,
            clip: { alpha: 1, scale: 1, rotation: 0, transform: { x: 0, y: 0 }, flip: { horizontal: false, vertical: false } }
          },
          {
            id: 's2',
            material_id: 'mv1',
            target_timerange: { start: 4000000, duration: 2500000 },
            source_timerange: { start: 4500000, duration: 5000000 },
            extra_material_refs: ['sp1', 'tr1'],
            render_index: 0,
            clip: { alpha: 1, scale: 1, rotation: 0, transform: { x: 0, y: 0 } }
          }
        ]
      },
      {
        id: 't2',
        type: 'video',
        name: 'overlay',
        segments: [
          {
            id: 's3',
            material_id: 'mv2',
            target_timerange: { start: 1000000, duration: 3000000 },
            source_timerange: null,
            extra_material_refs: [],
            render_index: 14000,
            clip: {
              alpha: 0.8,
              scale: 1.2,
              rotation: 15,
              transform: { x: 0.1, y: -0.2 },
              flip: { horizontal: true, vertical: false }
            },
            common_keyframes: [
              {
                property_type: 'KFTypePositionX',
                keyframe_list: [
                  { time_offset: 0, values: [0.1] },
                  { time_offset: 1000000, values: [0.3] }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 't3',
        type: 'audio',
        name: '',
        segments: [
          {
            id: 's4',
            material_id: 'ma1',
            target_timerange: { start: 0, duration: 6500000 },
            source_timerange: { start: 0, duration: 6500000 },
            extra_material_refs: ['fd1'],
            render_index: 0,
            volume: 0.8
          }
        ]
      },
      {
        id: 't4',
        type: 'text',
        name: '',
        segments: [
          {
            id: 's5',
            material_id: 'mt1',
            target_timerange: { start: 500000, duration: 2000000 },
            source_timerange: null,
            extra_material_refs: [],
            render_index: 15000,
            clip: { alpha: 1, scale: 1, rotation: 0, transform: { x: 0, y: -0.4 } }
          }
        ]
      },
      {
        id: 't5',
        type: 'sticker',
        name: '',
        segments: [
          {
            id: 's6',
            material_id: 'ms1',
            target_timerange: { start: 0, duration: 1000000 },
            render_index: 16000
          }
        ]
      }
    ],
    materials: {
      videos: [
        {
          id: 'mv1',
          type: 'video',
          path: 'Resources\\main.mp4',
          duration: 12000000,
          width: 1080,
          height: 1920,
          has_audio: true,
          material_name: 'main.mp4'
        },
        {
          id: 'mv2',
          type: 'photo',
          path: '',
          url: 'https://cdn.example/pic.jpg',
          duration: 3000000,
          width: 800,
          height: 800,
          material_name: 'pic'
        }
      ],
      audios: [{ id: 'ma1', path: 'D:\\Music\\beat.mp3', duration: 10000000, name: 'beat.mp3' }],
      texts: [
        {
          id: 'mt1',
          type: 'text',
          content: JSON.stringify({
            text: 'HELLO',
            styles: [
              { size: 12, bold: true, italic: false, fill: { content: { solid: { color: [1, 0.5, 0] } } } }
            ]
          })
        }
      ],
      speeds: [{ id: 'sp1', speed: 2 }],
      transitions: [{ id: 'tr1', name: 'Fade', duration: 500000 }],
      audio_fades: [{ id: 'fd1', fade_in_duration: 1000000, fade_out_duration: 500000 }],
      filters: [
        {
          id: 'fi1',
          name: 'clear',
          enable_adjust: true,
          adjust_params: [
            { name: 'saturation', value: 0.3 },
            { name: 'brightness', value: 0.1 }
          ]
        }
      ],
      canvas_color: ['#000000']
    }
  }
}

describe('closestAspect', () => {
  it('maps canvas dimensions onto the nearest preset', () => {
    expect(closestAspect(1920, 1080)).toBe('16:9')
    expect(closestAspect(1080, 1920)).toBe('9:16')
    expect(closestAspect(1080, 1080)).toBe('1:1')
    expect(closestAspect(1440, 1080)).toBe('4:3')
    expect(closestAspect(2560, 1080)).toBe('21:9')
    expect(closestAspect(0, 0)).toBe('16:9')
  })
})

describe('mapTransitionType', () => {
  it('maps common CapCut transition names', () => {
    expect(mapTransitionType('Fade')).toBe('crossfade')
    expect(mapTransitionType('黑场')).toBe('fade-black')
    expect(mapTransitionType('WhiteOut')).toBe('fade-white')
    expect(mapTransitionType('SwipeUp')).toBe('slide-up')
    expect(mapTransitionType('SlideDown')).toBe('slide-down')
    expect(mapTransitionType('WipeLeft')).toBe('wipe-left')
    expect(mapTransitionType('WipeUp')).toBe('wipe-up')
    expect(mapTransitionType('ZoomIn')).toBe('zoom-in')
    expect(mapTransitionType('SpinOut')).toBe('spin')
    expect(mapTransitionType('BlurFade')).toBe('blur-cross')
    expect(mapTransitionType('QuantumWarpX')).toBeNull()
  })
})

describe('mapEffectKind', () => {
  it('maps CapCut effect names onto rendered kinds', () => {
    expect(mapEffectKind('Blur')).toBe('blur')
    expect(mapEffectKind('Shake nhẹ')).toBe('shake')
    expect(mapEffectKind('ZoomLens')).toBe('zoom')
    expect(mapEffectKind('Lóe sáng')).toBe('flash')
    expect(mapEffectKind('Mosaic')).toBe('pixelate')
    expect(mapEffectKind('Dreamy')).toBe('dreamy')
    expect(mapEffectKind('Magic Unicorn')).toBeNull()
  })
})

describe('parseTextContent', () => {
  it('extracts text, size, weight and color from the encoded content', () => {
    const parsed = parseTextContent(
      JSON.stringify({
        text: 'Chào bạn',
        styles: [{ size: 8, bold: true, fill: { content: { solid: { color: [1, 1, 1] } } } }]
      })
    )
    expect(parsed?.text).toBe('Chào bạn')
    expect(parsed?.size).toBe(8)
    expect(parsed?.bold).toBe(true)
    expect(parsed?.color).toBe('#ffffff')
  })

  it('falls back to raw string and defaults for non-JSON content', () => {
    const parsed = parseTextContent('plain text')
    expect(parsed?.text).toBe('plain text')
    expect(parsed?.size).toBe(8)
    expect(parsed?.color).toBeNull()
  })
})

describe('capcutDraftToDocument', () => {
  const result = capcutDraftToDocument(buildDraft(), {
    draftFolder: DRAFT_FOLDER,
    draftName: 'Mẫu test'
  })
  const { doc, warnings, downloads, stats } = result

  it('adopts canvas, fps, aspect and background', () => {
    expect(doc.settings.width).toBe(1080)
    expect(doc.settings.height).toBe(1920)
    expect(doc.settings.aspectRatio).toBe('9:16')
    expect(doc.settings.fps).toBe(30)
    expect(doc.settings.backgroundColor).toBe('#000000')
    expect(doc.settings.name).toBe('Mẫu test')
  })

  it('orders visual tracks top-first by render index and audio last', () => {
    expect(doc.tracks.map((t) => t.kind)).toEqual(['text', 'video', 'video', 'audio'])
  })

  it('maps video segments with speed, inPoint, fades and filters', () => {
    const mainTrack = doc.tracks[2]
    expect(mainTrack.clips).toHaveLength(2)
    const first = mainTrack.clips[0]
    expect(first.kind).toBe('video')
    expect(first.start).toBe(0)
    expect(first.duration).toBe(4)
    expect(first.inPoint).toBe(0.5)
    expect(first.speed).toBe(2)
    expect(first.fadeIn).toBe(1)
    expect(first.fadeOut).toBe(0.5)
    expect(first.filters?.saturation).toBeCloseTo(1.3)
    expect(first.filters?.brightness).toBeCloseTo(1.1)
    // asset paths: relative draft path resolved against the draft folder
    const asset = doc.mediaLibrary.find((a) => a.id === first.assetId)
    expect(asset?.path).toBe('C:/fake/draft/Resources/main.mp4')
    expect(asset?.kind).toBe('video')

    const second = mainTrack.clips[1]
    expect(second.start).toBe(4)
    expect(second.duration).toBe(2.5)
    expect(second.inPoint).toBe(4.5)
    expect(second.transitionIn?.type).toBe('crossfade')
    expect(second.assetId).toBe(first.assetId) // same material reuses one asset
  })

  it('maps photo materials to image clips with transform and keyframes', () => {
    const overlay = doc.tracks[1].clips[0]
    expect(overlay.kind).toBe('image')
    expect(overlay.transform.scale).toBe(1.2)
    expect(overlay.transform.x).toBe(0.1)
    expect(overlay.transform.y).toBe(-0.2)
    expect(overlay.transform.rotation).toBe(15)
    expect(overlay.transform.opacity).toBe(0.8)
    expect(overlay.transform.flipX).toBe(true)
    expect(overlay.keyframes).toEqual([
      { id: expect.any(String), time: 0, x: 0.1 },
      { id: expect.any(String), time: 1, x: 0.3 }
    ])
    // remote material goes to the download queue, not a local path
    const asset = doc.mediaLibrary.find((a) => a.id === overlay.assetId)
    expect(asset?.path).toBe('')
    expect(asset?.kind).toBe('image')
    expect(downloads).toEqual([
      { assetId: asset?.id, url: 'https://cdn.example/pic.jpg', fileName: 'mv2.jpg' }
    ])
  })

  it('maps audio segments with volume and fades; absolute paths stay absolute', () => {
    const audioClip = doc.tracks[3].clips[0]
    expect(audioClip.kind).toBe('audio')
    expect(audioClip.volume).toBe(0.8)
    expect(audioClip.duration).toBe(6.5)
    const asset = doc.mediaLibrary.find((a) => a.id === audioClip.assetId)
    expect(asset?.path).toBe('D:/Music/beat.mp3')
  })

  it('maps text segments into text clips with style and centered position', () => {
    const textClip = doc.tracks[0].clips[0]
    expect(textClip.kind).toBe('text')
    expect(textClip.text?.content).toBe('HELLO')
    expect(textClip.text?.fontSize).toBeCloseTo(0.12)
    expect(textClip.text?.bold).toBe(true)
    expect(textClip.text?.color).toBe('#ff8000')
    expect(textClip.text?.x).toBeCloseTo(0.5)
    expect(textClip.text?.y).toBeCloseTo(0.1)
    expect(textClip.start).toBe(0.5)
    expect(textClip.duration).toBe(2)
  })

  it('skips unsupported tracks with a warning and stamps the template ref', () => {
    expect(stats.skipped).toBeGreaterThanOrEqual(1)
    expect(warnings.some((w) => w.includes('sticker'))).toBe(true)
    expect(doc.templateRef?.stage).toBe('draft')
    expect(doc.mediaLibrary).toHaveLength(3)
  })

  it('reports segments whose material is missing entirely', () => {
    const draft = buildDraft()
    draft.tracks = [
      {
        id: 'tx',
        type: 'video',
        name: '',
        segments: [{ id: 'sx', material_id: 'ghost', target_timerange: { start: 0, duration: 1000000 } }]
      }
    ]
    const missing = capcutDraftToDocument(draft, { draftFolder: DRAFT_FOLDER })
    expect(missing.stats.skipped).toBe(1)
    expect(missing.warnings.some((w) => w.includes('không tìm thấy tệp media'))).toBe(true)
    expect(missing.doc.tracks).toHaveLength(0)
  })

  it('maps effect-track segments onto overlapping visual clips', () => {
    const draft = buildDraft()
    draft.materials = {
      ...draft.materials,
      video_effects: [
        { id: 've1', name: 'Blur' },
        { id: 've2', name: 'Magic Unicorn' }
      ]
    }
    draft.tracks = [
      ...(draft.tracks ?? []),
      {
        id: 't-eff',
        type: 'effect',
        name: '',
        segments: [
          { id: 'se1', material_id: 've1', target_timerange: { start: 1500000, duration: 2000000 } },
          { id: 'se2', material_id: 've2', target_timerange: { start: 0, duration: 1000000 } }
        ]
      }
    ]
    const withEffects = capcutDraftToDocument(draft, { draftFolder: DRAFT_FOLDER })
    // The overlay image clip runs 1s–4s; the effect covers 1.5s–3.5s of it.
    const overlay = withEffects.doc.tracks.find((t) => t.clips.some((c) => c.kind === 'image'))!
    const imageClip = overlay.clips.find((c) => c.kind === 'image')!
    expect(imageClip.effects).toHaveLength(1)
    expect(imageClip.effects?.[0].kind).toBe('blur')
    expect(imageClip.effects?.[0].start).toBeCloseTo(0.5)
    expect(imageClip.effects?.[0].duration).toBeCloseTo(2)
    expect(withEffects.warnings.some((w) => w.includes('hiệu ứng chưa hỗ trợ'))).toBe(true)
  })
})
