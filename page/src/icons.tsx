import type * as React from 'react'

type IconProps = React.ComponentProps<'svg'>

function Icon({ children, ...props }: IconProps) {
    return (
        <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            height="20"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="20"
            {...props}
        >
            {children}
        </svg>
    )
}

export function BoltIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </Icon>
    )
}

export function LinkIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
            <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
        </Icon>
    )
}

export function PlusIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
        </Icon>
    )
}

export function SendIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="m22 2-7 20-4-9-9-4 20-7Z" />
            <path d="M22 2 11 13" />
        </Icon>
    )
}

export function StopIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <rect height="12" rx="2" width="12" x="6" y="6" />
        </Icon>
    )
}

export function ShieldIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-5" />
        </Icon>
    )
}

export function ActivityIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M3 12h4l3-8 4 16 3-8h4" />
        </Icon>
    )
}

export function CopyIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <rect height="13" rx="2" width="13" x="8" y="8" />
            <path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1" />
        </Icon>
    )
}

export function TerminalIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="m4 17 6-6-6-6" />
            <path d="M12 19h8" />
        </Icon>
    )
}
