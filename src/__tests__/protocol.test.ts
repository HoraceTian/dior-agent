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

    test('parses agent messages', () => {
        const result = parseSocketMessage(
            JSON.stringify({
                type: 'agent.message',
                id: 'turn-1',
                input: 'hello',
                metadata: { tenant: 'local' },
            }),
        )

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.message.type).toBe('agent.message')
            expect(result.message.id).toBe('turn-1')
        }
    })

    test('rejects malformed payloads', () => {
        const result = parseSocketMessage('{"type":"agent.message","id":"","input":""}')

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
