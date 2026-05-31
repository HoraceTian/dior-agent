import { describe, expect, test } from 'bun:test'
import { loadConfig } from 'src/config/env.js'

describe('loadConfig', () => {
    test('requires a token unless insecure local mode is enabled', () => {
        expect(() => loadConfig({})).toThrow('AGENT_API_TOKEN is required')
        expect(() => loadConfig({ AGENT_ALLOW_INSECURE_DEV: '1' })).toThrow('loopback hosts')
        expect(
            loadConfig({
                AGENT_ALLOW_INSECURE_DEV: '1',
                AGENT_HOST: '127.0.0.1',
            }).auth.allowInsecureDev,
        ).toBe(true)
    })

    test('parses numeric server settings', () => {
        const config = loadConfig({
            AGENT_API_TOKEN: 'secret',
            AGENT_PORT: '9000',
            AGENT_MAX_MESSAGE_BYTES: '2048',
            AGENT_IDLE_TIMEOUT_MS: '10000',
            AGENT_LOG_LEVEL: 'debug',
            AGENT_ALLOWED_ORIGINS: 'https://private.example/, https://admin.example',
            AGENT_DATA_DIR: '.private-data',
            AGENT_WORKSPACE_ROOT: '.private-workspaces',
            AGENT_MODEL_CONFIG_PATH: '.private-models.toml',
            AGENT_MODEL_CONFIG_WATCH: '0',
        })

        expect(config.port).toBe(9000)
        expect(config.dataDir).toBe('.private-data')
        expect(config.workspaceRoot).toBe('.private-workspaces')
        expect(config.modelConfigPath).toBe('.private-models.toml')
        expect(config.modelConfigWatch).toBe(false)
        expect(config.maxMessageBytes).toBe(2048)
        expect(config.idleTimeoutMs).toBe(10000)
        expect(config.logLevel).toBe('debug')
        expect(config.auth.staticToken).toBe('secret')
        expect(config.auth.allowedOrigins).toEqual([
            'https://private.example',
            'https://admin.example',
        ])
    })

    test('defaults workspace root under data dir', () => {
        const config = loadConfig({
            AGENT_API_TOKEN: 'secret',
            AGENT_DATA_DIR: '.private-data',
        })

        expect(config.workspaceRoot).toBe('.private-data/workspaces')
        expect(config.modelConfigPath).toBe('.config/models.toml')
        expect(config.modelConfigWatch).toBe(true)
    })
})
