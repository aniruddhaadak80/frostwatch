import { describe, expect, it } from 'vitest'
import { appendEvent, canonicalJson, computeSeal, GENESIS_SEAL, replayChain, sha384Hex } from '../src/lib/integrity'

const base = { sheetId: 'sh_1', kind: 'create' as const, at: '2026-01-15T00:00:00.000Z', actor: 'grower', payload: { blockId: 'blk-a' } }

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('produces identical bytes regardless of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }))
  })

  it('preserves array order, because array order is meaningful', () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}')
  })

  it('collapses -0 to 0 so an arithmetic accident cannot change a seal', () => {
    expect(canonicalJson({ v: -0 })).toBe(canonicalJson({ v: 0 }))
  })

  it('drops undefined rather than emitting invalid JSON', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('refuses non-finite numbers, which have no canonical JSON form', () => {
    expect(() => canonicalJson({ v: Number.NaN })).toThrow(/non-finite/)
  })
})

describe('the seal chain', () => {
  it('starts at genesis with sequence 1', () => {
    const link = appendEvent([], base)
    expect(link.seq).toBe(1)
    expect(link.prevSeal).toBe(GENESIS_SEAL)
    expect(link.seal).toHaveLength(96)
  })

  it('matches the documented formula on a known vector', () => {
    // seal_1 = SHA-384( UTF-8(genesis) || canonicalJson(event_1) )
    //
    // The vector is derived from canonicalJson rather than a hand-written JSON string,
    // because the canonical form SORTS keys — a literal written in natural order would
    // encode the wrong input and prove nothing.
    const body = canonicalJson({
      seq: 1,
      sheetId: 'sh_1',
      kind: 'create',
      at: '2026-01-15T00:00:00.000Z',
      actor: 'grower',
      payload: { blockId: 'blk-a' },
    })
    expect(body).toBe(
      '{"actor":"grower","at":"2026-01-15T00:00:00.000Z","kind":"create","payload":{"blockId":"blk-a"},"seq":1,"sheetId":"sh_1"}',
    )
    const expected = sha384Hex(`${GENESIS_SEAL}${body}`)
    expect(computeSeal(GENESIS_SEAL, { ...base, seq: 1 })).toBe(expected)
    // Genesis is 96 zeroes, so the concatenation is the hash of that prefix plus the body.
    expect(expected).toBe(sha384Hex(`${'0'.repeat(96)}${body}`))
    expect(expected).toHaveLength(96)
  })

  it('chains each seal to the previous one', () => {
    const first = appendEvent([], base)
    const second = appendEvent([first], { ...base, kind: 'decision', payload: { status: 'protected' } })
    expect(second.seq).toBe(2)
    expect(second.prevSeal).toBe(first.seal)
    expect(second.seal).not.toBe(first.seal)
  })

  it('replays a clean chain', () => {
    let chain = [appendEvent([], base)]
    chain = [...chain, appendEvent(chain, { ...base, kind: 'update', payload: { notes: 'hello' } })]
    chain = [...chain, appendEvent(chain, { ...base, kind: 'delete', payload: { tombstone: true } })]
    const result = replayChain(chain)
    expect(result.ok).toBe(true)
    expect(result.length).toBe(3)
    expect(result.headSeal).toBe(chain[2]!.seal)
  })

  it('replays an empty chain as valid', () => {
    expect(replayChain([])).toMatchObject({ ok: true, length: 0, brokenAtSeq: null })
  })

  it('detects a tampered payload', () => {
    const first = appendEvent([], base)
    const second = appendEvent([first], { ...base, kind: 'decision', payload: { status: 'protected' } })
    const tampered = [{ ...first }, { ...second, payload: { status: 'stood-down' } }]
    const result = replayChain(tampered)
    expect(result.ok).toBe(false)
    expect(result.brokenAtSeq).toBe(2)
    expect(result.reason).toMatch(/seal does not match/)
  })

  it('detects a removed event via the sequence gap', () => {
    const first = appendEvent([], base)
    const second = appendEvent([first], { ...base, kind: 'update', payload: { notes: 'x' } })
    const third = appendEvent([second], { ...base, kind: 'delete', payload: { tombstone: true } })
    const result = replayChain([first, third])
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/expected sequence 2, found 3/)
  })

  it('detects a rewritten prevSeal', () => {
    const first = appendEvent([], base)
    const second = appendEvent([first], { ...base, kind: 'update', payload: { notes: 'x' } })
    const result = replayChain([first, { ...second, prevSeal: GENESIS_SEAL }])
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/prevSeal does not match/)
  })

  it('is unaffected by key order in the stored payload', () => {
    const first = appendEvent([], base)
    const second = appendEvent([first], { ...base, kind: 'update', payload: { b: 2, a: 1 } })
    const reordered = [{ ...first }, { ...second, payload: { a: 1, b: 2 } }]
    expect(replayChain(reordered).ok).toBe(true)
  })
})
