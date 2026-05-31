import { SessionEventSchema } from 'src/domain/sessions/sessionEvents.js'
import { z } from 'zod'

export const JsonObjectSchema = z.record(z.string(), z.unknown())
const StorageIdSchema = z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/)

export const ClientMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('ping'),
        id: z.string().min(1).optional(),
    }),
    z.object({
        type: z.literal('session.create'),
        id: z.string().min(1).optional(),
        metadata: JsonObjectSchema.optional(),
    }),
    z.object({
        type: z.literal('session.attach'),
        id: z.string().min(1).optional(),
        sessionId: StorageIdSchema,
        lastSeq: z.number().int().min(0).default(0),
    }),
    z.object({
        type: z.literal('turn.start'),
        id: StorageIdSchema,
        sessionId: StorageIdSchema,
        input: z.string().trim().min(1),
        metadata: JsonObjectSchema.optional(),
    }),
    z.object({
        type: z.literal('turn.cancel'),
        id: z.string().min(1).optional(),
        sessionId: StorageIdSchema,
        turnId: StorageIdSchema,
        reason: z.string().min(1).optional(),
    }),
])

export const ProtocolErrorCodeSchema = z.enum([
    'invalid_json',
    'invalid_message',
    'message_too_large',
    'agent_error',
    'unauthorized',
    'forbidden',
    'session_not_found',
    'session_not_attached',
    'lease_conflict',
    'turn_in_progress',
    'turn_not_found',
])

export const ServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('connection.ready'),
        connectionId: z.string().min(1),
        serverTime: z.string().min(1),
        maxMessageBytes: z.number().int().positive(),
    }),
    z.object({
        type: z.literal('pong'),
        id: z.string().min(1).optional(),
        serverTime: z.string().min(1),
    }),
    z.object({
        type: z.literal('session.ready'),
        id: z.string().min(1).optional(),
        sessionId: z.string().min(1),
        lastSeq: z.number().int().min(0),
        replayedEvents: z.number().int().min(0),
    }),
    z.object({
        type: z.literal('session.event'),
        event: SessionEventSchema,
    }),
    z.object({
        type: z.literal('turn.accepted'),
        id: z.string().min(1),
        sessionId: z.string().min(1),
        turnId: z.string().min(1),
    }),
    z.object({
        type: z.literal('error'),
        id: z.string().min(1).optional(),
        code: ProtocolErrorCodeSchema,
        message: z.string().min(1),
    }),
])

export type JsonObject = z.infer<typeof JsonObjectSchema>
export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type ServerMessage = z.infer<typeof ServerMessageSchema>
export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>
