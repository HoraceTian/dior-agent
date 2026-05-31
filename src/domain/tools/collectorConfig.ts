import { z } from 'zod'

export const CollectorTrustLevelSchema = z.enum(['private', 'local', 'untrusted'])

export const CollectorEndpointConfigSchema = z.object({
    id: z.string().min(1),
    url: z.string().url(),
    token_env: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    trust: CollectorTrustLevelSchema.default('private'),
})

export const RawCollectorsConfigSchema = z.object({
    collectors: z.array(CollectorEndpointConfigSchema).default([]),
})

export type CollectorTrustLevel = z.infer<typeof CollectorTrustLevelSchema>
export type CollectorEndpointConfig = z.infer<typeof CollectorEndpointConfigSchema>
export type RawCollectorsConfig = z.infer<typeof RawCollectorsConfigSchema>
