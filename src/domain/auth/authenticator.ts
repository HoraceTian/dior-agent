import { timingSafeEqual } from 'node:crypto'

export type CredentialSource = 'authorization' | 'cookie' | 'query'

export type AuthCredential = {
    scheme: 'bearer'
    source: CredentialSource
    token: string
}

export type AuthPolicy = {
    staticToken?: string
    allowInsecureDev: boolean
    allowQueryToken: boolean
}

export type AuthPrincipal = {
    id: 'private-client' | 'insecure-dev'
    credentialSource?: CredentialSource
}

export type AuthFailureReason =
    | 'missing_credentials'
    | 'invalid_credentials'
    | 'query_token_disabled'
    | 'auth_not_configured'
    | 'origin_not_allowed'

export type AuthResult =
    | {
          ok: true
          principal: AuthPrincipal
      }
    | {
          ok: false
          reason: AuthFailureReason
      }

export class Authenticator {
    constructor(private readonly policy: AuthPolicy) {}

    authenticate(credential: AuthCredential | undefined): AuthResult {
        if (!this.policy.staticToken) {
            if (this.policy.allowInsecureDev) {
                return {
                    ok: true,
                    principal: { id: 'insecure-dev' },
                }
            }
            return { ok: false, reason: 'auth_not_configured' }
        }

        if (!credential) {
            return { ok: false, reason: 'missing_credentials' }
        }

        if (credential.source === 'query' && !this.policy.allowQueryToken) {
            return { ok: false, reason: 'query_token_disabled' }
        }

        if (!timingSafeTokenEqual(credential.token, this.policy.staticToken)) {
            return { ok: false, reason: 'invalid_credentials' }
        }

        return {
            ok: true,
            principal: {
                id: 'private-client',
                credentialSource: credential.source,
            },
        }
    }
}

function timingSafeTokenEqual(candidate: string, expected: string): boolean {
    const expectedBuffer = Buffer.from(expected)
    const candidateBuffer = Buffer.from(candidate)

    if (candidateBuffer.length !== expectedBuffer.length) {
        const padded = Buffer.alloc(expectedBuffer.length)
        candidateBuffer.copy(padded, 0, 0, Math.min(candidateBuffer.length, expectedBuffer.length))
        timingSafeEqual(padded, expectedBuffer)
        return false
    }

    return timingSafeEqual(candidateBuffer, expectedBuffer)
}
