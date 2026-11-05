import type { Book } from './view.js'

export interface Loader {
  loadText(name: string): Promise<string | null>
  loadBlob(name: string): Promise<Blob | null>
  getSize(name: string): number
}

export class EPUB {
  constructor(loader: Loader)
  init(): Promise<Book>
}
