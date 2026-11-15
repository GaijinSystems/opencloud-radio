export interface Result { name: string; ok: boolean; detail: string }
export declare const runContract: (o: { base: string; headers?: Record<string, string>; fetch?: typeof fetch }) => Promise<Result[]>
