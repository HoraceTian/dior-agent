export type Logger = {
    debug: (message: string, fields?: LogFields) => void
    info: (message: string, fields?: LogFields) => void
    warn: (message: string, fields?: LogFields) => void
    error: (message: string, fields?: LogFields) => void
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogFields = Record<string, unknown>

const levelWeight: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
}

export function createLogger(options: { level: LogLevel }): Logger {
    const shouldWrite = (level: LogLevel) => levelWeight[level] >= levelWeight[options.level]

    const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
        if (!shouldWrite(level)) return
        const event = {
            time: new Date().toISOString(),
            level,
            message,
            ...fields,
        }
        const line = JSON.stringify(event)
        if (level === 'error') {
            console.error(line)
            return
        }
        console.log(line)
    }

    return {
        debug: (message, fields) => write('debug', message, fields),
        info: (message, fields) => write('info', message, fields),
        warn: (message, fields) => write('warn', message, fields),
        error: (message, fields) => write('error', message, fields),
    }
}
