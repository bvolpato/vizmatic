import { readdir } from 'fs/promises'
import { basename } from 'path'

export async function listGalleryExamples() {
    return (await readdir('examples'))
        .filter((file) => file.endsWith('.tsx'))
        .sort()
        .map((file) => ({ name: basename(file, '.tsx'), source: `examples/${file}` }))
}

const titleWords: Record<string, string> = {
    gif: 'GIF',
    ml: 'ML',
    nccl: 'NCCL',
    rag: 'RAG',
}

export function exampleTitle(name: string): string {
    return name
        .split('-')
        .map((part) => titleWords[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}
