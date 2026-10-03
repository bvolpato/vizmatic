export interface PlaygroundTextSource {
    start: number
    end: number
    original: string
    value: string
    kind: 'string' | 'jsx-attribute' | 'jsx-text'
}

export interface PlaygroundTextTarget extends PlaygroundTextSource {
    left: number
    top: number
    width: number
    height: number
    fontSize: number
    color: string
}
