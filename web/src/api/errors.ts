import type { AppError } from '../types';

export class ProjectClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'ProjectClientError';
    this.code = error.code;
    this.retryable = error.retryable;
  }

  toAppError(): AppError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function notImplemented(command: string): never {
  throw new ProjectClientError({
    code: 'not_implemented',
    message: `${command} is not wired yet`,
    retryable: false,
  });
}
