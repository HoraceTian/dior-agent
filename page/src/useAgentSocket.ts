import { useEffect, useRef, useState } from 'react'
import {
    type ClientMessage,
    type JsonObject,
    type ServerMessage,
    type SessionEvent,
    createMessageId,
    isSafeSessionId,
    parseServerMessage,
} from './protocol'

const SESSION_STORAGE_KEY = 'dior-agent:last-session-id'

export type AuthMode = 'cookie' | 'query'

export type ConnectionState =
    | {
          status: 'idle'
      }
    | {
          status: 'connecting'
          url: string
      }
    | {
          status: 'connected'
          url: string
          connectionId: string
          serverTime: string
          maxMessageBytes: number
      }
    | {
          status: 'closed'
          reason?: string
      }
    | {
          status: 'error'
          message: string
      }

export type ChatMessage = {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    turnId?: string
    createdAt?: string
    status: 'complete' | 'streaming' | 'failed' | 'cancelled'
    metadata?: JsonObject
}

export type ClientLog = {
    id: string
    time: string
    level: 'info' | 'warn' | 'error'
    message: string
}

export type AgentClientState = {
    connection: ConnectionState
    sessionId: string | undefined
    lastSeq: number
    replayedEvents: number
    messages: ChatMessage[]
    pendingTurnId: string | undefined
    seenSeqs: number[]
    logs: ClientLog[]
    lastError: string | undefined
    lastSessionId: string | undefined
}

export type ConnectOptions = {
    url: string
    token: string
    authMode: AuthMode
}

const initialState: AgentClientState = {
    connection: {
        status: 'idle',
    },
    sessionId: undefined,
    lastSeq: 0,
    replayedEvents: 0,
    messages: [],
    pendingTurnId: undefined,
    seenSeqs: [],
    logs: [],
    lastError: undefined,
    lastSessionId: readLastSessionId(),
}

export function useAgentSocket() {
    const [state, setState] = useState<AgentClientState>(initialState)
    const socketRef = useRef<WebSocket | null>(null)

    useEffect(() => {
        return () => {
            socketRef.current?.close(1000, 'page unmounted')
        }
    }, [])

    function connect(options: ConnectOptions): void {
        const normalized = createSocketUrl(options)
        if (!normalized.ok) {
            setState(current => ({
                ...current,
                connection: {
                    status: 'error',
                    message: normalized.message,
                },
                lastError: normalized.message,
            }))
            return
        }

        socketRef.current?.close(1000, 'reconnecting')
        const cookieReady =
            options.authMode === 'cookie'
                ? writeAgentCookie(options.token, normalized.url)
                : { ok: true as const }

        const socket = new WebSocket(normalized.url)
        socketRef.current = socket
        setState(current => ({
            ...current,
            connection: {
                status: 'connecting',
                url: normalized.displayUrl,
            },
            lastError: cookieReady.ok ? undefined : cookieReady.message,
            logs: appendLog(
                current.logs,
                cookieReady.ok ? 'info' : 'warn',
                cookieReady.ok ? 'Opening websocket' : cookieReady.message,
            ),
        }))

        socket.onmessage = event => {
            if (typeof event.data !== 'string') return
            const message = parseServerMessage(event.data)
            if (!message) {
                setState(current => ({
                    ...current,
                    logs: appendLog(current.logs, 'warn', 'Ignored malformed server message'),
                }))
                return
            }
            handleServerMessage(message)
        }

        socket.onerror = () => {
            setState(current => ({
                ...current,
                connection: {
                    status: 'error',
                    message: 'WebSocket transport error',
                },
                lastError: 'WebSocket transport error',
                logs: appendLog(current.logs, 'error', 'WebSocket transport error'),
            }))
        }

        socket.onclose = event => {
            setState(current => ({
                ...current,
                connection:
                    current.connection.status === 'error'
                        ? current.connection
                        : {
                              status: 'closed',
                              reason: event.reason || `closed with code ${event.code}`,
                          },
                pendingTurnId: undefined,
                logs: appendLog(current.logs, 'warn', `Connection closed (${event.code})`),
            }))
        }
    }

    function disconnect(): void {
        socketRef.current?.close(1000, 'manual disconnect')
        socketRef.current = null
    }

    function createSession(): void {
        setState(current => ({
            ...current,
            sessionId: undefined,
            lastSeq: 0,
            replayedEvents: 0,
            messages: [],
            pendingTurnId: undefined,
            seenSeqs: [],
        }))
        send({
            type: 'session.create',
            id: createMessageId('create'),
            metadata: {
                source: 'page',
            },
        })
    }

    function attachSession(sessionId: string): boolean {
        if (!isSafeSessionId(sessionId)) {
            setState(current => ({
                ...current,
                lastError: 'Session id can only contain letters, numbers, underscore, and dash.',
            }))
            return false
        }

        setState(current => ({
            ...current,
            sessionId,
            lastSeq: 0,
            replayedEvents: 0,
            messages: [],
            pendingTurnId: undefined,
            seenSeqs: [],
        }))
        return send({
            type: 'session.attach',
            id: createMessageId('attach'),
            sessionId,
            lastSeq: 0,
        })
    }

    function sendTurn(input: string): boolean {
        const content = input.trim()
        if (!content || !state.sessionId || state.pendingTurnId) return false

        const turnId = createMessageId('turn')
        return send({
            type: 'turn.start',
            id: turnId,
            sessionId: state.sessionId,
            input: content,
            metadata: {
                source: 'page',
            },
        })
    }

    function cancelTurn(): boolean {
        if (!state.sessionId || !state.pendingTurnId) return false

        return send({
            type: 'turn.cancel',
            id: createMessageId('cancel'),
            sessionId: state.sessionId,
            turnId: state.pendingTurnId,
            reason: 'cancelled from page',
        })
    }

    function ping(): boolean {
        return send({
            type: 'ping',
            id: createMessageId('ping'),
        })
    }

    function handleServerMessage(message: ServerMessage): void {
        setState(current => reduceServerMessage(current, message))
    }

    function send(message: ClientMessage): boolean {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            setState(current => ({
                ...current,
                lastError: 'WebSocket is not connected.',
                logs: appendLog(current.logs, 'error', 'WebSocket is not connected'),
            }))
            return false
        }

        socket.send(JSON.stringify(message))
        return true
    }

    return {
        state,
        connect,
        disconnect,
        createSession,
        attachSession,
        sendTurn,
        cancelTurn,
        ping,
    }
}

function reduceServerMessage(state: AgentClientState, message: ServerMessage): AgentClientState {
    if (message.type === 'connection.ready') {
        return {
            ...state,
            connection: {
                status: 'connected',
                url: state.connection.status === 'connecting' ? state.connection.url : '',
                connectionId: message.connectionId,
                serverTime: message.serverTime,
                maxMessageBytes: message.maxMessageBytes,
            },
            logs: appendLog(state.logs, 'info', 'Connection ready'),
        }
    }

    if (message.type === 'pong') {
        return {
            ...state,
            logs: appendLog(state.logs, 'info', 'Pong received'),
        }
    }

    if (message.type === 'session.ready') {
        writeLastSessionId(message.sessionId)
        return {
            ...state,
            sessionId: message.sessionId,
            lastSeq: message.lastSeq,
            replayedEvents: message.replayedEvents,
            lastSessionId: message.sessionId,
            logs: appendLog(state.logs, 'info', `Session ready: ${message.sessionId}`),
        }
    }

    if (message.type === 'turn.accepted') {
        return {
            ...state,
            pendingTurnId: message.turnId,
            logs: appendLog(state.logs, 'info', `Turn accepted: ${message.turnId}`),
        }
    }

    if (message.type === 'session.event') {
        return reduceSessionEvent(state, message.event)
    }

    return {
        ...state,
        lastError: message.message,
        logs: appendLog(state.logs, 'error', `${message.code}: ${message.message}`),
    }
}

function reduceSessionEvent(state: AgentClientState, event: SessionEvent): AgentClientState {
    if (state.seenSeqs.includes(event.seq)) return state

    const nextBase = {
        ...state,
        lastSeq: Math.max(state.lastSeq, event.seq),
        seenSeqs: [...state.seenSeqs, event.seq].slice(-500),
    }

    if (event.type === 'session.created') {
        return {
            ...nextBase,
            logs: appendLog(nextBase.logs, 'info', `Session created by ${event.ownerId}`),
        }
    }

    if (event.type === 'turn.started') {
        return {
            ...nextBase,
            messages: upsertMessage(nextBase.messages, {
                id: `${event.turnId}:user`,
                role: 'user',
                turnId: event.turnId,
                content: event.input,
                createdAt: event.createdAt,
                status: 'complete',
            }),
        }
    }

    if (event.type === 'assistant.delta') {
        return {
            ...nextBase,
            messages: appendAssistantDelta(nextBase.messages, event),
        }
    }

    if (event.type === 'assistant.message') {
        return {
            ...nextBase,
            messages: upsertMessage(nextBase.messages, {
                id: `${event.turnId}:assistant`,
                role: 'assistant',
                turnId: event.turnId,
                content: event.content,
                createdAt: event.createdAt,
                status: 'complete',
                ...(event.metadata ? { metadata: event.metadata } : {}),
            }),
        }
    }

    if (event.type === 'turn.completed') {
        return {
            ...nextBase,
            pendingTurnId:
                nextBase.pendingTurnId === event.turnId ? undefined : nextBase.pendingTurnId,
            logs: appendLog(nextBase.logs, 'info', `Turn completed: ${event.turnId}`),
        }
    }

    if (event.type === 'turn.failed') {
        return {
            ...nextBase,
            pendingTurnId:
                nextBase.pendingTurnId === event.turnId ? undefined : nextBase.pendingTurnId,
            messages: upsertMessage(nextBase.messages, {
                id: `${event.turnId}:assistant`,
                role: 'assistant',
                turnId: event.turnId,
                content: event.message,
                createdAt: event.createdAt,
                status: 'failed',
            }),
            lastError: event.message,
            logs: appendLog(nextBase.logs, 'error', `Turn failed: ${event.message}`),
        }
    }

    if (event.type === 'turn.cancelled') {
        return {
            ...nextBase,
            pendingTurnId:
                nextBase.pendingTurnId === event.turnId ? undefined : nextBase.pendingTurnId,
            messages: upsertMessage(nextBase.messages, {
                id: `${event.turnId}:assistant`,
                role: 'assistant',
                turnId: event.turnId,
                content: event.reason ?? 'Turn cancelled',
                createdAt: event.createdAt,
                status: 'cancelled',
            }),
            logs: appendLog(nextBase.logs, 'warn', `Turn cancelled: ${event.turnId}`),
        }
    }

    return {
        ...nextBase,
        logs: appendLog(nextBase.logs, 'info', `${event.type}: ${event.turnId}`),
    }
}

function appendAssistantDelta(
    messages: ChatMessage[],
    event: Extract<SessionEvent, { type: 'assistant.delta' }>,
) {
    const id = `${event.turnId}:assistant`
    const existing = messages.find(message => message.id === id)
    if (!existing) {
        return [
            ...messages,
            {
                id,
                role: 'assistant',
                turnId: event.turnId,
                content: event.text,
                createdAt: event.createdAt,
                status: 'streaming',
            },
        ] satisfies ChatMessage[]
    }

    return messages.map(message => {
        if (message.id !== id) return message

        return {
            ...message,
            content: `${message.content}${event.text}`,
            status: 'streaming',
        } satisfies ChatMessage
    })
}

function upsertMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
    if (messages.some(message => message.id === next.id)) {
        return messages.map(message => (message.id === next.id ? next : message))
    }

    return [...messages, next]
}

function appendLog(logs: ClientLog[], level: ClientLog['level'], message: string): ClientLog[] {
    return [
        {
            id: createMessageId('log'),
            level,
            message,
            time: new Date().toISOString(),
        },
        ...logs,
    ].slice(0, 80)
}

function createSocketUrl(options: ConnectOptions):
    | {
          ok: true
          url: string
          displayUrl: string
      }
    | {
          ok: false
          message: string
      } {
    try {
        const url = new URL(options.url)
        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
            return {
                ok: false,
                message: 'WebSocket URL must start with ws:// or wss://.',
            }
        }

        if (options.authMode === 'query') {
            url.searchParams.set('token', options.token)
        }

        const displayUrl = maskToken(url)
        return {
            ok: true,
            url: url.toString(),
            displayUrl,
        }
    } catch {
        return {
            ok: false,
            message: 'WebSocket URL is invalid.',
        }
    }
}

function writeAgentCookie(
    token: string,
    rawUrl: string,
):
    | {
          ok: true
      }
    | {
          ok: false
          message: string
      } {
    const url = new URL(rawUrl)
    if (url.hostname !== window.location.hostname) {
        return {
            ok: false,
            message: 'Cookie auth requires the page and websocket to use the same hostname.',
        }
    }

    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `agent_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict${secure}`
    return {
        ok: true,
    }
}

function maskToken(url: URL): string {
    const clone = new URL(url)
    if (clone.searchParams.has('token')) {
        clone.searchParams.set('token', '••••••')
    }
    return clone.toString()
}

function readLastSessionId(): string | undefined {
    return localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined
}

function writeLastSessionId(sessionId: string): void {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId)
}
