import { AxiosError } from 'axios';
import type { TfsApiError } from '../types/tfs.js';

// ─── Base error ───────────────────────────────────────────────────────────────

export class TfsError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly tfsError?: TfsApiError;

  constructor(message: string, code: string, statusCode?: number, tfsError?: TfsApiError) {
    super(message);
    this.name = 'TfsError';
    this.code = code;
    this.statusCode = statusCode;
    this.tfsError = tfsError;

    // Restore prototype chain (needed when extending built-ins in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Specific error types ─────────────────────────────────────────────────────

export class TfsAuthError extends TfsError {
  constructor(message: string) {
    super(message, 'TFS_AUTH_ERROR', 401);
    this.name = 'TfsAuthError';
  }
}

export class TfsNotFoundError extends TfsError {
  constructor(resource: string, id?: string | number) {
    const msg = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(msg, 'TFS_NOT_FOUND', 404);
    this.name = 'TfsNotFoundError';
  }
}

export class TfsPermissionError extends TfsError {
  constructor(action: string) {
    super(`Insufficient permissions to ${action}`, 'TFS_PERMISSION_ERROR', 403);
    this.name = 'TfsPermissionError';
  }
}

export class TfsValidationError extends TfsError {
  constructor(message: string) {
    super(message, 'TFS_VALIDATION_ERROR', 400);
    this.name = 'TfsValidationError';
  }
}

export class TfsConnectionError extends TfsError {
  constructor(url: string, cause?: Error) {
    super(
      `Failed to connect to TFS at ${url}${cause ? `: ${cause.message}` : ''}`,
      'TFS_CONNECTION_ERROR',
    );
    this.name = 'TfsConnectionError';
    if (cause) this.cause = cause;
  }
}

export class TfsTimeoutError extends TfsError {
  constructor(url: string, timeoutMs: number) {
    super(
      `Request to ${url} timed out after ${timeoutMs}ms`,
      'TFS_TIMEOUT_ERROR',
    );
    this.name = 'TfsTimeoutError';
  }
}

export class TfsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TfsConfigError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Axios error mapper ───────────────────────────────────────────────────────

/**
 * Converts an AxiosError into a typed TfsError with useful context.
 */
export function mapAxiosError(error: unknown, context = ''): TfsError {
  if (!(error instanceof AxiosError)) {
    if (error instanceof TfsError) return error;
    const msg = error instanceof Error ? error.message : String(error);
    return new TfsError(`Unexpected error${context ? ` in ${context}` : ''}: ${msg}`, 'TFS_UNKNOWN');
  }

  const ax = error as AxiosError<TfsApiError>;
  const status = ax.response?.status;
  const tfsError = ax.response?.data;
  const url = ax.config?.url ?? 'unknown URL';

  if (ax.code === 'ECONNABORTED' || ax.code === 'ETIMEDOUT') {
    // Extract timeout value from Axios config if available
    const timeoutMs = (ax.config as { timeout?: number })?.timeout ?? 0;
    return new TfsTimeoutError(url, timeoutMs);
  }

  if (ax.code === 'ECONNREFUSED' || ax.code === 'ENOTFOUND' || !ax.response) {
    return new TfsConnectionError(url, error as Error);
  }

  const apiMsg =
    tfsError?.message ??
    ax.response?.statusText ??
    ax.message;

  switch (status) {
    case 400:
      return new TfsValidationError(apiMsg ?? 'Bad request');
    case 401:
      return new TfsAuthError(
        'Authentication failed. Check TFS_USERNAME, TFS_PASSWORD, or TFS_PAT.',
      );
    case 403:
      return new TfsPermissionError(context || 'perform this action');
    case 404:
      return new TfsNotFoundError(context || 'Resource');
    default:
      return new TfsError(
        `TFS API error (HTTP ${status ?? 'unknown'})${context ? ` in ${context}` : ''}: ${apiMsg}`,
        'TFS_API_ERROR',
        status,
        tfsError,
      );
  }
}

// ─── MCP tool error formatter ─────────────────────────────────────────────────

/**
 * Formats any error into a user-friendly string suitable for MCP tool responses.
 */
export function formatErrorForMcp(error: unknown): string {
  if (error instanceof TfsAuthError) {
    return `Authentication error: ${error.message}`;
  }
  if (error instanceof TfsNotFoundError) {
    return `Not found: ${error.message}`;
  }
  if (error instanceof TfsPermissionError) {
    return `Permission denied: ${error.message}`;
  }
  if (error instanceof TfsValidationError) {
    return `Validation error: ${error.message}`;
  }
  if (error instanceof TfsConnectionError) {
    return `Connection error: ${error.message}. Verify TFS_BASE_URL and network connectivity.`;
  }
  if (error instanceof TfsTimeoutError) {
    return `Timeout: ${error.message}. Consider increasing TFS_TIMEOUT_MS.`;
  }
  if (error instanceof TfsError) {
    return `TFS error [${error.code}]: ${error.message}`;
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Unknown error: ${String(error)}`;
}
