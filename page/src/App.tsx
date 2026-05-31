import { useLayoutEffect, useRef, useState } from 'react'
import {
    ActivityIcon,
    BoltIcon,
    CopyIcon,
    LinkIcon,
    PlusIcon,
    SendIcon,
    ShieldIcon,
    StopIcon,
    TerminalIcon,
} from './icons'
import { type AuthMode, type ChatMessage, useAgentSocket } from './useAgentSocket'

const promptStarters = [
    'Summarize the current session runtime design.',
    'Draft the next step for one-session-one-container isolation.',
    'Explain the model config reload path and risks.',
] as const

export function App() {
    const client = useAgentSocket()
    const [wsUrl, setWsUrl] = useState(createDefaultWebSocketUrl)
    const [token, setToken] = useState('')
    const [authMode, setAuthMode] = useState<AuthMode>('cookie')
    const [attachId, setAttachId] = useState(client.state.lastSessionId ?? '')
    const [draft, setDraft] = useState('')
    const messageEndRef = useRef<HTMLDivElement | null>(null)
    const lastMessage = client.state.messages.at(-1)
    const scrollVersion = `${client.state.messages.length}:${lastMessage?.id ?? ''}:${lastMessage?.content.length ?? 0}`

    useLayoutEffect(() => {
        if (!scrollVersion.startsWith('0:')) {
            messageEndRef.current?.scrollIntoView({ block: 'end' })
        }
    }, [scrollVersion])

    function handleMessageListScroll(): void {
        messageEndRef.current?.scrollIntoView({ block: 'end' })
    }

    function handleConnect(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault()
        client.connect({
            url: wsUrl,
            token,
            authMode,
        })
    }

    function handleAttach(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault()
        if (attachId.trim()) {
            client.attachSession(attachId.trim())
        }
    }

    function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault()
        if (client.sendTurn(draft)) {
            setDraft('')
        }
    }

    const isConnected = client.state.connection.status === 'connected'
    const canSend = isConnected && Boolean(client.state.sessionId) && !client.state.pendingTurnId
    const connectionLabel = getConnectionLabel(client.state.connection.status)

    return (
        <div className="app-shell">
            <aside className="left-rail" aria-label="Connection and session controls">
                <header className="brand">
                    <span className="brand-mark">
                        <BoltIcon />
                    </span>
                    <span>
                        <strong>Dior Agent</strong>
                        <small>Private WebSocket Console</small>
                    </span>
                </header>

                <section className="control-panel">
                    <div className="section-heading">
                        <LinkIcon />
                        <h2>Connection</h2>
                    </div>
                    <form className="stack" onSubmit={handleConnect}>
                        <label className="field">
                            <span>WebSocket URL</span>
                            <input
                                value={wsUrl}
                                onChange={event => setWsUrl(event.currentTarget.value)}
                                spellCheck={false}
                            />
                        </label>
                        <label className="field">
                            <span>Token</span>
                            <input
                                value={token}
                                onChange={event => setToken(event.currentTarget.value)}
                                placeholder="AGENT_API_TOKEN"
                                type="password"
                            />
                        </label>
                        <fieldset className="segmented" aria-label="Authentication mode">
                            <label>
                                <input
                                    checked={authMode === 'cookie'}
                                    name="auth-mode"
                                    onChange={() => setAuthMode('cookie')}
                                    type="radio"
                                />
                                <span>Cookie</span>
                            </label>
                            <label>
                                <input
                                    checked={authMode === 'query'}
                                    name="auth-mode"
                                    onChange={() => setAuthMode('query')}
                                    type="radio"
                                />
                                <span>Query</span>
                            </label>
                        </fieldset>
                        <div className="button-row">
                            <Button
                                disabled={client.state.connection.status === 'connecting'}
                                type="submit"
                            >
                                <LinkIcon />
                                Connect
                            </Button>
                            <Button onClick={client.disconnect} type="button" variant="ghost">
                                Disconnect
                            </Button>
                        </div>
                    </form>
                </section>

                <section className="control-panel">
                    <div className="section-heading">
                        <ShieldIcon />
                        <h2>Session</h2>
                    </div>
                    <div className="stack">
                        <Button
                            disabled={!isConnected}
                            onClick={client.createSession}
                            type="button"
                        >
                            <PlusIcon />
                            New Session
                        </Button>
                        <form className="attach-form" onSubmit={handleAttach}>
                            <label className="field">
                                <span>Attach ID</span>
                                <input
                                    value={attachId}
                                    onChange={event => setAttachId(event.currentTarget.value)}
                                    spellCheck={false}
                                />
                            </label>
                            <Button
                                disabled={!isConnected || !attachId.trim()}
                                type="submit"
                                variant="secondary"
                            >
                                Attach
                            </Button>
                        </form>
                        {client.state.lastSessionId ? (
                            <button
                                className="session-memory"
                                onClick={() => setAttachId(client.state.lastSessionId ?? '')}
                                type="button"
                            >
                                <span>Last session</span>
                                <strong>{client.state.lastSessionId}</strong>
                            </button>
                        ) : null}
                    </div>
                </section>
            </aside>

            <main className="workspace">
                <header className="workspace-header">
                    <div>
                        <p className="eyebrow">Agent workspace</p>
                        <h1>Realtime conversation</h1>
                    </div>
                    <div className="status-strip" aria-label="Runtime status">
                        <StatusPill
                            label="Socket"
                            tone={isConnected ? 'green' : 'amber'}
                            value={connectionLabel}
                        />
                        <StatusPill
                            label="Session"
                            tone={client.state.sessionId ? 'blue' : 'neutral'}
                            value={client.state.sessionId ?? 'none'}
                        />
                        <StatusPill
                            label="Seq"
                            tone="neutral"
                            value={String(client.state.lastSeq)}
                        />
                    </div>
                </header>

                <section className="conversation-surface" aria-label="Conversation">
                    <div className="message-list">
                        {client.state.messages.length === 0 ? (
                            <EmptyConversation
                                disabled={!canSend}
                                onSelectPrompt={value => {
                                    setDraft(value)
                                    handleMessageListScroll()
                                }}
                            />
                        ) : (
                            client.state.messages.map(message => (
                                <MessageBubble key={message.id} message={message} />
                            ))
                        )}
                        <div ref={messageEndRef} />
                    </div>

                    <form className="composer" onSubmit={handleSubmit}>
                        <label className="composer-input">
                            <span>Message</span>
                            <textarea
                                disabled={!canSend}
                                onChange={event => setDraft(event.currentTarget.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                        event.currentTarget.form?.requestSubmit()
                                    }
                                }}
                                placeholder={
                                    client.state.sessionId
                                        ? 'Ask the private agent...'
                                        : 'Create or attach a session first'
                                }
                                rows={3}
                                value={draft}
                            />
                        </label>
                        <div className="composer-actions">
                            <Button disabled={!canSend || !draft.trim()} type="submit">
                                <SendIcon />
                                Send
                            </Button>
                            <IconButton
                                disabled={!client.state.pendingTurnId}
                                label="Cancel turn"
                                onClick={client.cancelTurn}
                                type="button"
                            >
                                <StopIcon />
                            </IconButton>
                        </div>
                    </form>
                </section>
            </main>

            <aside className="right-rail" aria-label="Runtime details">
                <section className="runtime-panel">
                    <div className="section-heading">
                        <ActivityIcon />
                        <h2>Runtime</h2>
                    </div>
                    <dl className="metrics-grid">
                        <Metric label="Replay" value={String(client.state.replayedEvents)} />
                        <Metric label="Pending" value={client.state.pendingTurnId ?? 'none'} />
                        <Metric
                            label="Max bytes"
                            value={
                                client.state.connection.status === 'connected'
                                    ? formatNumber(client.state.connection.maxMessageBytes)
                                    : 'unknown'
                            }
                        />
                        <Metric
                            label="Connection"
                            value={
                                client.state.connection.status === 'connected'
                                    ? client.state.connection.connectionId
                                    : 'none'
                            }
                        />
                    </dl>
                    <div className="button-row">
                        <Button
                            disabled={!isConnected}
                            onClick={client.ping}
                            type="button"
                            variant="secondary"
                        >
                            Ping
                        </Button>
                        <IconButton
                            disabled={!client.state.sessionId}
                            label="Copy session id"
                            onClick={() => copyText(client.state.sessionId)}
                            type="button"
                        >
                            <CopyIcon />
                        </IconButton>
                    </div>
                    {client.state.lastError ? (
                        <p className="inline-error">{client.state.lastError}</p>
                    ) : null}
                </section>

                <section className="runtime-panel activity-log-panel">
                    <div className="section-heading">
                        <TerminalIcon />
                        <h2>Activity</h2>
                    </div>
                    <ol className="activity-log">
                        {client.state.logs.map(log => (
                            <li data-level={log.level} key={log.id}>
                                <time>{formatTime(log.time)}</time>
                                <span>{log.message}</span>
                            </li>
                        ))}
                    </ol>
                </section>
            </aside>
        </div>
    )
}

type ButtonProps = React.ComponentProps<'button'> & {
    variant?: 'primary' | 'secondary' | 'ghost'
}

function Button({ className = '', variant = 'primary', ...props }: ButtonProps) {
    return <button className={`button button-${variant} ${className}`} {...props} />
}

type IconButtonProps = React.ComponentProps<'button'> & {
    label: string
}

function IconButton({ children, className = '', label, ...props }: IconButtonProps) {
    return (
        <button aria-label={label} className={`icon-button ${className}`} title={label} {...props}>
            {children}
        </button>
    )
}

function StatusPill({
    label,
    tone,
    value,
}: {
    label: string
    tone: 'green' | 'amber' | 'blue' | 'neutral'
    value: string
}) {
    return (
        <div className="status-pill" data-tone={tone}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    )
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    )
}

function EmptyConversation({
    disabled,
    onSelectPrompt,
}: {
    disabled: boolean
    onSelectPrompt: (value: string) => void
}) {
    return (
        <div className="empty-state">
            <span className="empty-icon">
                <TerminalIcon />
            </span>
            <h2>No turns yet</h2>
            <p>Create or attach a session, then send the first turn.</p>
            <div className="prompt-grid">
                {promptStarters.map(prompt => (
                    <button
                        disabled={disabled}
                        key={prompt}
                        onClick={() => onSelectPrompt(prompt)}
                        type="button"
                    >
                        {prompt}
                    </button>
                ))}
            </div>
        </div>
    )
}

function MessageBubble({ message }: { message: ChatMessage }) {
    const roleLabel =
        message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Agent' : 'System'
    const meta = getMessageMeta(message)

    return (
        <article className="message" data-role={message.role} data-status={message.status}>
            <header>
                <span>{roleLabel}</span>
                <time>{message.createdAt ? formatTime(message.createdAt) : ''}</time>
            </header>
            <p>{message.content}</p>
            {meta ? <footer>{meta}</footer> : null}
        </article>
    )
}

function getMessageMeta(message: ChatMessage): string | undefined {
    if (message.status === 'streaming') return 'streaming'
    if (message.status === 'failed') return 'failed'
    if (message.status === 'cancelled') return 'cancelled'

    const provider = message.metadata?.modelProvider
    const model = message.metadata?.modelName
    if (typeof provider === 'string' && typeof model === 'string') {
        return `${provider} · ${model}`
    }

    return undefined
}

function createDefaultWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname || 'localhost'
    return `${protocol}//${host}:8787/ws`
}

function getConnectionLabel(
    status: ReturnType<typeof useAgentSocket>['state']['connection']['status'],
): string {
    if (status === 'idle') return 'idle'
    if (status === 'connecting') return 'connecting'
    if (status === 'connected') return 'ready'
    if (status === 'closed') return 'closed'
    return 'error'
}

function formatTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
}

function formatNumber(value: number): string {
    return new Intl.NumberFormat().format(value)
}

function copyText(value: string | undefined): void {
    if (!value) return
    void navigator.clipboard?.writeText(value)
}
