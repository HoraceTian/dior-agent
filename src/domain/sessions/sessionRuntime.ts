import type { AgentMessage } from 'src/domain/agent/agentMessages.js'
import type { AgentRuntimeEvent } from 'src/domain/agent/agentRuntime.js'
import type { AgentService } from 'src/domain/agent/agentService.js'
import { type ModelConfigProvider, createTurnModelRecord } from 'src/domain/models/modelConfig.js'
import { SessionTurnInProgressError, SessionTurnNotFoundError } from './sessionErrors.js'
import type { JsonObject, SessionEvent, SessionEventDraft } from './sessionEvents.js'
import type { SessionLogLevel, SessionStore, TurnRecord } from './sessionStore.js'

export type SessionRuntimeOptions = {
    sessionId: string
    ownerId: string
    store: SessionStore
    agent: AgentService
    modelConfigs: ModelConfigProvider
}

export type RunSessionTurnInput = {
    turnId: string
    connectionId: string
    input: string
    metadata?: JsonObject
}

type RunningTurn = {
    turnId: string
    abortController: AbortController
    record: TurnRecord
    cancelEventEmitted: boolean
}

export class SessionRuntime {
    private runningTurn?: RunningTurn

    constructor(private readonly options: SessionRuntimeOptions) {}

    async *runTurn(input: RunSessionTurnInput): AsyncGenerator<SessionEvent> {
        if (this.runningTurn) {
            throw new SessionTurnInProgressError(this.options.sessionId)
        }

        const startedAtMs = Date.now()
        const startedAt = new Date().toISOString()
        const abortController = new AbortController()
        const modelSnapshot = this.options.modelConfigs.getSnapshot()
        const model = createTurnModelRecord(modelSnapshot)
        const history = await this.readConversationHistory()
        const record: TurnRecord = {
            sessionId: this.options.sessionId,
            turnId: input.turnId,
            status: 'running',
            input: input.input,
            ...(input.metadata ? { metadata: input.metadata } : {}),
            model,
            startedAt,
        }
        this.runningTurn = {
            turnId: input.turnId,
            abortController,
            record,
            cancelEventEmitted: false,
        }

        await this.options.store.writeTurn(record)
        await this.writeLog('info', 'turn.started', {
            turnId: input.turnId,
            connectionId: input.connectionId,
            hasMetadata: Boolean(input.metadata),
            modelProvider: model.provider,
            modelName: model.modelName,
            modelConfigVersion: model.configVersion,
        })

        try {
            yield await this.appendEvent({
                type: 'turn.started',
                sessionId: this.options.sessionId,
                turnId: input.turnId,
                input: input.input,
                connectionId: input.connectionId,
                ...(input.metadata ? { metadata: input.metadata } : {}),
            })

            throwIfAborted(abortController.signal)

            const iterator = this.options.agent.runTurn({
                sessionId: this.options.sessionId,
                turnId: input.turnId,
                connectionId: input.connectionId,
                input: input.input,
                history,
                metadata: input.metadata,
                model: modelSnapshot,
                signal: abortController.signal,
            })

            let result = await iterator.next()
            throwIfAborted(abortController.signal)
            while (!result.done) {
                yield await this.appendRuntimeEvent(input.turnId, result.value)
                result = await iterator.next()
                throwIfAborted(abortController.signal)
            }

            const completedAt = new Date().toISOString()
            const completedRecord: TurnRecord = {
                ...record,
                status: 'completed',
                completedAt,
            }
            await this.options.store.writeTurn(completedRecord)
            await this.writeLog('info', 'turn.completed', {
                turnId: input.turnId,
                durationMs: Date.now() - startedAtMs,
            })

            yield await this.appendEvent({
                type: 'assistant.message',
                sessionId: this.options.sessionId,
                turnId: input.turnId,
                content: result.value.output,
                ...(result.value.metadata ? { metadata: result.value.metadata } : {}),
            })
            yield await this.appendEvent({
                type: 'turn.completed',
                sessionId: this.options.sessionId,
                turnId: input.turnId,
                output: result.value.output,
                ...(result.value.metadata ? { metadata: result.value.metadata } : {}),
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failedAt = new Date().toISOString()
            const runningTurn = this.runningTurn
            await this.options.store.writeTurn({
                ...record,
                status: abortController.signal.aborted ? 'cancelled' : 'failed',
                completedAt: failedAt,
                error: message,
            })

            if (abortController.signal.aborted) {
                await this.writeLog('warn', 'turn.cancelled', {
                    turnId: input.turnId,
                    durationMs: Date.now() - startedAtMs,
                    reason: message,
                })
                if (runningTurn?.cancelEventEmitted) return
                yield await this.appendEvent({
                    type: 'turn.cancelled',
                    sessionId: this.options.sessionId,
                    turnId: input.turnId,
                    reason: message,
                })
                return
            }

            await this.writeLog('error', 'turn.failed', {
                turnId: input.turnId,
                durationMs: Date.now() - startedAtMs,
                error: message,
            })
            yield await this.appendEvent({
                type: 'turn.failed',
                sessionId: this.options.sessionId,
                turnId: input.turnId,
                message,
            })
        } finally {
            this.runningTurn = undefined
        }
    }

    async cancelTurn(turnId: string, reason?: string): Promise<SessionEvent> {
        if (!this.runningTurn || this.runningTurn.turnId !== turnId) {
            throw new SessionTurnNotFoundError(turnId)
        }

        await this.writeLog('warn', 'turn.cancel_requested', {
            turnId,
            ...(reason ? { reason } : {}),
        })
        this.runningTurn.abortController.abort(reason ?? 'cancelled')
        const completedAt = new Date().toISOString()
        await this.options.store.writeTurn({
            ...this.runningTurn.record,
            status: 'cancelled',
            completedAt,
            ...(reason ? { error: reason } : {}),
        })
        const event = await this.appendEvent({
            type: 'turn.cancelled',
            sessionId: this.options.sessionId,
            turnId,
            ...(reason ? { reason } : {}),
        })
        this.runningTurn.cancelEventEmitted = true
        return event
    }

    private appendEvent(event: SessionEventDraft): Promise<SessionEvent> {
        return this.options.store.appendEvent(event)
    }

    private appendRuntimeEvent(turnId: string, event: AgentRuntimeEvent): Promise<SessionEvent> {
        if (event.type === 'assistant.delta') {
            return this.appendEvent({
                type: 'assistant.delta',
                sessionId: this.options.sessionId,
                turnId,
                text: event.text,
            })
        }

        if (event.type === 'tool.use') {
            return this.appendEvent({
                type: 'tool.use',
                sessionId: this.options.sessionId,
                turnId,
                toolUseId: event.toolUseId,
                name: event.name,
                input: event.input ?? {},
            })
        }

        return this.appendEvent({
            type: 'tool.result',
            sessionId: this.options.sessionId,
            turnId,
            toolUseId: event.toolUseId,
            ...(event.content ? { content: event.content } : {}),
            ...(event.resultRef ? { resultRef: event.resultRef } : {}),
            ...(event.isError === undefined ? {} : { isError: event.isError }),
        })
    }

    private async writeLog(
        level: SessionLogLevel,
        message: string,
        fields?: JsonObject,
    ): Promise<void> {
        await this.options.store.appendLog({
            sessionId: this.options.sessionId,
            time: new Date().toISOString(),
            level,
            message,
            ...(fields ? { fields } : {}),
        })
    }

    private async readConversationHistory(): Promise<AgentMessage[]> {
        const events = await this.options.store.readEventsAfter(this.options.sessionId, 0)
        const turnInputs = new Map<string, string>()
        const messages: AgentMessage[] = []

        for (const event of events) {
            if (event.type === 'turn.started') {
                turnInputs.set(event.turnId, event.input)
                continue
            }

            if (event.type !== 'assistant.message') continue

            const input = turnInputs.get(event.turnId)
            if (!input) continue

            messages.push(
                {
                    role: 'user',
                    content: input,
                },
                {
                    role: 'assistant',
                    content: event.content,
                },
            )
            turnInputs.delete(event.turnId)
        }

        return messages
    }
}

function throwIfAborted(signal: AbortSignal): void {
    if (!signal.aborted) return

    const reason = signal.reason
    if (reason instanceof Error) {
        throw reason
    }
    if (typeof reason === 'string' && reason.length > 0) {
        throw new Error(reason)
    }
    throw new Error('cancelled')
}
