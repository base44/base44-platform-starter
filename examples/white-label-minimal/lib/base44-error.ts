export class Base44Error extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
