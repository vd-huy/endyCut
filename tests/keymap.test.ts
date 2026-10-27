import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYMAP,
  KEYMAP_ACTIONS,
  comboFromEvent,
  matchKeymapAction
} from '../src/renderer/src/lib/keymap'

/** Fabricate a KeyboardEvent-like object without a browser DOM. */
function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    code: '',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...init
  } as KeyboardEvent
}

describe('comboFromEvent', () => {
  it('crops modifiers in canonical order', () => {
    const e = keyEvent({ key: 'b', code: 'KeyB', ctrlKey: true, metaKey: true })
    expect(comboFromEvent(e)).toBe('Ctrl+B')
    const shiftCombo = keyEvent({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true })
    expect(comboFromEvent(shiftCombo)).toBe('Shift+ArrowLeft')
  })

  it('normalizes space and punctuation', () => {
    expect(comboFromEvent(keyEvent({ key: ' ', code: 'Space' }))).toBe('Space')
    // Punctuation keeps the glyph and drops the implicit Shift.
    expect(comboFromEvent(keyEvent({ key: '?', code: 'Slash', shiftKey: true }))).toBe('?')
    expect(comboFromEvent(keyEvent({ key: 'm', code: 'KeyM' }))).toBe('M')
  })
})

describe('matchKeymapAction', () => {
  it('matches defaults exactly', () => {
    expect(matchKeymapAction(keyEvent({ key: 'b', code: 'KeyB', ctrlKey: true }), DEFAULT_KEYMAP)).toBe('split')
    expect(matchKeymapAction(keyEvent({ key: ' ', code: 'Space' }), DEFAULT_KEYMAP)).toBe('play-pause')
    expect(matchKeymapAction(keyEvent({ key: '?', code: 'Slash', shiftKey: true }), DEFAULT_KEYMAP)).toBe('open-keymap')
  })

  it('supports pipe-separated alternatives', () => {
    const map = { ...DEFAULT_KEYMAP, redo: 'Ctrl+Shift+Z|Ctrl+Y' }
    expect(matchKeymapAction(keyEvent({ key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true }), map)).toBe('redo')
    expect(matchKeymapAction(keyEvent({ key: 'y', code: 'KeyY', ctrlKey: true }), map)).toBe('redo')
  })

  it('returns null for unmatched combos', () => {
    expect(matchKeymapAction(keyEvent({ key: 'F9', code: 'F9' }), DEFAULT_KEYMAP)).toBeNull()
  })
})

describe('KEYMAP_ACTIONS', () => {
  it('registers every default action in the meta list', () => {
    for (const id of Object.keys(DEFAULT_KEYMAP)) {
      expect(KEYMAP_ACTIONS.some((meta) => meta.id === id)).toBe(true)
    }
  })
})
