import { z } from 'zod'

export const JsonObjectSchema = z.record(z.string(), z.unknown())

export const ClientMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('ping'),
        id: z.string().min(1).optional(),
    }),
    z.object({
        type: z.literal('agent.message'),
        id: z.string().min(1),
        input: z.string().trim().min(1),
        metadata: JsonObjectSchema.optional(),
    }),
])

export const ProtocolErrorCodeSchema = z.enum([
    'invalid_json',
    'invalid_message',
    'message_too_large',
    'agent_error',
    'unauthorized',
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
        type: z.literal('agent.message.received'),
        id: z.string().min(1),
    }),
    z.object({
        type: z.literal('agent.message.result'),
        id: z.string().min(1),
        output: z.string(),
        metadata: JsonObjectSchema.optional(),
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
