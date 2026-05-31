import { describe, expect, test } from 'bun:test'
import { parseSocketMessage, serializeServerMessage } from 'src/contracts/websocket/index.js'

describe('protocol messages', () => {
    test('parses ping messages', () => {
        const result = parseSocketMessage('{"type":"ping","id":"p1"}')

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.message).toEqual({ type: 'ping', id: 'p1' })
        }
    })

    test('parses session attach messages', () => {
        const result = parseSocketMessage(
            JSON.stringify({
                type: 'session.attach',
                id: 'attach-1',
                sessionId: 'sess_1',
                lastSeq: 12,
            }),
        )

        expect(result.ok).toBe(true)
        if (result.ok) {
            if (result.message.type !== 'session.attach') {
                throw new Error('Expected session.attach message')
            }
            expect(result.message.sessionId).toBe('sess_1')
            expect(result.message.lastSeq).toBe(12)
        }
    })

    test('parses turn start messages', () => {
        const result = parseSocketMessage(
            JSON.stringify({
                type: 'turn.start',
                id: 'turn-1',
                sessionId: 'sess_1',
                input: 'hello',
                metadata: { tenant: 'local' },
            }),
        )

        expect(result.ok).toBe(true)
        if (result.ok) {
            if (result.message.type !== 'turn.start') {
                throw new Error('Expected turn.start message')
            }
            expect(result.message.id).toBe('turn-1')
            expect(result.message.sessionId).toBe('sess_1')
        }
    })

    test('rejects malformed payloads', () => {
        const result = parseSocketMessage('{"type":"turn.start","id":"","sessionId":"","input":""}')

        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.error.code).toBe('invalid_message')
        }
    })

    test('rejects unsafe persisted ids', () => {
        const result = parseSocketMessage(
            JSON.stringify({
                type: 'turn.start',
                id: '../turn-1',
                sessionId: 'sess_1',
                input: 'hello',
            }),
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.error.code).toBe('invalid_message')
        }
    })

    test('serializes server messages', () => {
        expect(
            serializeServerMessage({
                type: 'pong',
                id: 'p1',
                serverTime: '2026-05-28T00:00:00.000Z',
            }),
        ).toBe('{"type":"pong","id":"p1","serverTime":"2026-05-28T00:00:00.000Z"}')
    })
})
