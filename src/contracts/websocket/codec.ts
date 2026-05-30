import type { RawData } from 'ws'
import { type ClientMessage, ClientMessageSchema, type ServerMessage } from './messages.js'

export type ParseResult =
    | {
          ok: true
          message: ClientMessage
      }
    | {
          ok: false
          error: {
              code: 'invalid_json' | 'invalid_message'
              message: string
          }
      }

export function parseSocketMessage(raw: RawData | string | ArrayBuffer | Uint8Array): ParseResult {
    const text = decodeSocketMessage(raw)
    let parsed: unknown

    try {
        parsed = JSON.parse(text)
    } catch {
        return {
            ok: false,
            error: {
                code: 'invalid_json',
                message: 'Message must be valid JSON.',
            },
        }
    }

    const result = ClientMessageSchema.safeParse(parsed)
    if (!result.success) {
        return {
            ok: false,
            error: {
                code: 'invalid_message',
                message: 'Message does not match the WebSocket protocol.',
            },
        }
    }

    return {
        ok: true,
        message: result.data,
    }
}

export function serializeServerMessage(message: ServerMessage): string {
    return JSON.stringify(message)
}

export function socketMessageByteLength(raw: RawData | string | ArrayBuffer | Uint8Array): number {
    if (typeof raw === 'string') return Buffer.byteLength(raw)
    if (raw instanceof ArrayBuffer) return raw.byteLength
    if (Array.isArray(raw)) return Buffer.concat(raw).byteLength
    return raw.byteLength
}

function decodeSocketMessage(raw: RawData | string | ArrayBuffer | Uint8Array): string {
    if (typeof raw === 'string') return raw
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
    return Buffer.from(raw).toString('utf8')
}
