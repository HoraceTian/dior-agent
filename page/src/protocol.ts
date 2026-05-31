export type JsonObject = Record<string, unknown>

export type ClientMessage =
    | {
          type: 'ping'
          id?: string
      }
    | {
          type: 'session.create'
          id?: string
          metadata?: JsonObject
      }
    | {
          type: 'session.attach'
          id?: string
          sessionId: string
          lastSeq: number
      }
    | {
          type: 'turn.start'
          id: string
          sessionId: string
          input: string
          metadata?: JsonObject
      }
    | {
          type: 'turn.cancel'
          id?: string
          sessionId: string
          turnId: string
          reason?: string
      }

export type SessionEvent =
    | {
          type: 'session.created'
          seq: number
          sessionId: string
          createdAt: string
          ownerId: string
      }
    | {
          type: 'turn.started'
          seq: number
          sessionId: string
          createdAt: string
          turnId: string
          input: string
          connectionId: string
          metadata?: JsonObject
      }
    | {
          type: 'assistant.delta'
          seq: number
          sessionId: string
          createdAt: string
          turnId: string
          text: string
      }
    | {
          type: 'assistant.message'
          seq: number
          sessionId: string
          createdAt: string
          turnId: string
          content: string
          metadata?: JsonObject
      }
    | {
          type: 'tool.use'
          seq: number
          sessionId: string
          createdAt: string
          turnId: string
          toolUseId: string
          name: string
          input: JsonObject
      }
    | {
          type: 'tool.result'
          seq: number
          sessionId: string
          createdAt: string
          turnId: string
          toolUseId: string
          content?: string
          resultRef?: string
          isError?: boolean
      }
    | {
          type: 'turn.completed'
          seq: number
          sessionId: string
          createdAt: string
          turnId: string
          output: string
          metadata?: JsonObject
      }
    | {
          type: 'turn.failed'
          seq: number
          sessionId: string
          createdAt: string
          turnId: string
          message: string
      }
    | {
          type: 'turn.cancelled'
          seq: number
          sessionId: string
          createdAt: string
          turnId: string
          reason?: string
      }

export type ServerMessage =
    | {
          type: 'connection.ready'
          connectionId: string
          serverTime: string
          maxMessageBytes: number
      }
    | {
          type: 'pong'
          id?: string
          serverTime: string
      }
    | {
          type: 'session.ready'
          id?: string
          sessionId: string
          lastSeq: number
          replayedEvents: number
      }
    | {
          type: 'session.event'
          event: SessionEvent
      }
    | {
          type: 'turn.accepted'
          id: string
          sessionId: string
          turnId: string
      }
    | {
          type: 'error'
          id?: string
          code:
              | 'invalid_json'
              | 'invalid_message'
              | 'message_too_large'
              | 'agent_error'
              | 'unauthorized'
              | 'forbidden'
              | 'session_not_found'
              | 'session_not_attached'
              | 'lease_conflict'
              | 'turn_in_progress'
              | 'turn_not_found'
          message: string
      }

export function parseServerMessage(raw: string): ServerMessage | undefined {
    try {
        const parsed = JSON.parse(raw) as unknown
        if (!isJsonObject(parsed)) return undefined
        if (typeof parsed.type !== 'string') return undefined
        return parsed as ServerMessage
    } catch {
        return undefined
    }
}

export function createMessageId(prefix: string): string {
    const suffix = Math.random().toString(36).slice(2, 8)
    return `${prefix}_${Date.now()}_${suffix}`
}

export function isSafeSessionId(value: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(value)
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
