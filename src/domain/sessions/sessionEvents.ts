import { z } from 'zod'

const JsonObjectSchema = z.record(z.string(), z.unknown())
const StorageIdSchema = z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/)

const EventBaseSchema = {
    seq: z.number().int().positive(),
    sessionId: StorageIdSchema,
    createdAt: z.string().min(1),
}

export const SessionEventSchema = z.discriminatedUnion('type', [
    z.object({
        ...EventBaseSchema,
        type: z.literal('session.created'),
        ownerId: z.string().min(1),
    }),
    z.object({
        ...EventBaseSchema,
        type: z.literal('turn.started'),
        turnId: StorageIdSchema,
        input: z.string().min(1),
        connectionId: z.string().min(1),
        metadata: JsonObjectSchema.optional(),
    }),
    z.object({
        ...EventBaseSchema,
        type: z.literal('assistant.delta'),
        turnId: StorageIdSchema,
        text: z.string(),
    }),
    z.object({
        ...EventBaseSchema,
        type: z.literal('assistant.message'),
        turnId: StorageIdSchema,
        content: z.string(),
        metadata: JsonObjectSchema.optional(),
    }),
    z.object({
        ...EventBaseSchema,
        type: z.literal('tool.use'),
        turnId: StorageIdSchema,
        toolUseId: StorageIdSchema,
        name: z.string().min(1),
        input: JsonObjectSchema,
    }),
    z.object({
        ...EventBaseSchema,
        type: z.literal('tool.result'),
        turnId: StorageIdSchema,
        toolUseId: StorageIdSchema,
        content: z.string().optional(),
        resultRef: z.string().min(1).optional(),
        isError: z.boolean().optional(),
    }),
    z.object({
        ...EventBaseSchema,
        type: z.literal('turn.completed'),
        turnId: StorageIdSchema,
        output: z.string(),
        metadata: JsonObjectSchema.optional(),
    }),
    z.object({
        ...EventBaseSchema,
        type: z.literal('turn.failed'),
        turnId: StorageIdSchema,
        message: z.string().min(1),
    }),
    z.object({
        ...EventBaseSchema,
        type: z.literal('turn.cancelled'),
        turnId: StorageIdSchema,
        reason: z.string().min(1).optional(),
    }),
])

export type JsonObject = z.infer<typeof JsonObjectSchema>
export type SessionEvent = z.infer<typeof SessionEventSchema>
export type SessionEventDraft = SessionEvent extends infer Event
    ? Event extends SessionEvent
        ? Omit<Event, 'seq' | 'createdAt'>
        : never
    : never
