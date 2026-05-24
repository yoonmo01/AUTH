/// <reference types="vite/client" />

declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string
    messages: { type: string; message: string }[]
  }>
}

declare module 'hwp.js' {
  export class Viewer {
    constructor(container: HTMLElement, data: Uint8Array)
    distory(): void
  }
  export function parse(data: Uint8Array): unknown
}
