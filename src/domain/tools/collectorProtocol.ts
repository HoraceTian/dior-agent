import { z } from 'zod'

export const JsonObjectSchema = z.record(z.string(), z.unknown())

export const CollectorToolDescriptorSchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: JsonObjectSchema.default({}),
    outputSchema: JsonObjectSchema.default({}),
    scopes: z.array(z.string().min(1)).default([]),
    sideEffects: z.string().min(1).default('unknown'),
    timeoutMs: z.number().int().positive().default(10_000),
    maxResultBytes: z.number().int().positive().default(65_536),
})

export const CollectorManifestSchema = z.object({
    collectorId: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().default(''),
    protocolVersion: z.string().min(1),
    version: z.string().min(1),
    publicUrl: z.string().url(),
    tools: z.array(CollectorToolDescriptorSchema).default([]),
})

export const ToolInvocationRequestSchema = z.object({
    invocationId: z.string().min(1),
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    input: JsonObjectSchema.default({}),
    deadlineMs: z.number().int().positive().optional(),
})

export const ToolInvocationResponseSchema = z.object({
    invocationId: z.string().min(1),
    status: z.enum(['ok', 'error']),
    content: z.string().optional(),
    structured: z.unknown().optional(),
    resultRef: z.string().min(1).optional(),
    isError: z.boolean().default(false),
})

export type CollectorToolDescriptor = z.infer<typeof CollectorToolDescriptorSchema>
export type CollectorManifest = z.infer<typeof CollectorManifestSchema>
export type ToolInvocationRequest = z.infer<typeof ToolInvocationRequestSchema>
export type ToolInvocationResponse = z.infer<typeof ToolInvocationResponseSchema>
