export class Base44Error extends Error {
  constructor(
    message: string,
    public status = 502,
    // Base44's error.code, when it sent one. Codes never hold secrets.
    public code?: string,
  ) {
    super(message);
  }
}
