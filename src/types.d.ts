declare module 'tsx/esm/api' {
    export function tsImport<T = unknown>(specifier: string, parentUrl: string): Promise<T>
}
