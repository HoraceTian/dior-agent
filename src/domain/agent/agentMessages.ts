export type AgentMessageRole = 'system' | 'user' | 'assistant'

export type AgentMessage = {
    role: AgentMessageRole
    content: string
}

export function createDefaultSystemPrompt(): string {
    return [
        'You are Dior Agent, a private websocket agent service.',
        'Respond directly and keep answers concise unless the user asks for detail.',
        'Tool execution is not available in this runtime yet.',
        'Do not claim to read files, run commands, or modify external state unless the user provided that content in the conversation.',
    ].join('\n')
}
