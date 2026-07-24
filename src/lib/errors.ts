// Thrown by sponsor-seam stubs (SensoContextStore, ActianVectorStore) until
// Track A implements them; factories catch nothing — they simply return the
// local default until the real client exists.
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
