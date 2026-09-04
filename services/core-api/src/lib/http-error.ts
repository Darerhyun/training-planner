import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type HttpErrorExtra = {
  code?: string;
  currentVersion?: number;
};

export type HttpErrorBody = {
  error: string;
  code?: string;
  currentVersion?: number;
};

export class HttpError extends Error {
  public readonly body: HttpErrorBody;

  constructor(
    public readonly status: ContentfulStatusCode,
    message: string,
    extra?: HttpErrorExtra,
  ) {
    super(message);
    this.name = 'HttpError';
    this.body = { error: message, ...extra };
  }
}
