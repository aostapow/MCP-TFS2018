import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { NtlmClient } from 'axios-ntlm';
import { getConfig, collectionUrl, projectUrl } from './config.js';
import { applyAuth } from './auth.js';
import { mapAxiosError } from './utils/errors.js';
import { createChildLogger } from './utils/logger.js';
import type { TfsConfig, TfsListResponse } from './types/tfs.js';

const log = createChildLogger('tfs-client');

export class TfsClient {
  private readonly http: AxiosInstance;
  private readonly config: TfsConfig;

  constructor(config?: TfsConfig) {
    this.config = config ?? getConfig();
    this.http = this.buildAxiosInstance();
  }

  private buildAxiosInstance(): AxiosInstance {
    const { config } = this;
    const baseDefaults: AxiosRequestConfig = {
      timeout: config.timeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      params: {
        'api-version': config.apiVersion,
      },
    };

    let instance: AxiosInstance;

    if (config.auth.type === 'ntlm') {
      // NtlmClient wraps axios and handles the NTLM handshake transparently.
      instance = NtlmClient(
        {
          username: config.auth.username!,
          password: config.auth.password!,
          domain: config.auth.domain ?? '',
          workstation: '',
        },
        baseDefaults,
      );
    } else {
      instance = axios.create(baseDefaults);
    }

    // Request interceptor: inject auth headers for non-NTLM, log outgoing requests
    instance.interceptors.request.use((req) => {
      if (config.auth.type !== 'ntlm') {
        const patched = applyAuth(req, config.auth);
        Object.assign(req, patched);
        if (patched.headers) {
          Object.assign(req.headers ?? {}, patched.headers);
        }
      }
      log.debug('-> ' + (req.method?.toUpperCase() ?? '') + ' ' + req.url, { params: req.params });
      return req;
    });

    // Response interceptor: log responses
    instance.interceptors.response.use(
      (res) => {
        log.debug('<- ' + res.status + ' ' + res.config.url);
        return res;
      },
      (err: unknown) => {
        const axErr = err as { response?: { status: number }; config?: { url: string }; message?: string };
        const status = axErr.response?.status;
        log.warn('<- ' + (status ?? 'ERR') + ' ' + (axErr.config?.url ?? '') + ': ' + (axErr.message ?? ''));
        return Promise.reject(err);
      },
    );

    return instance;
  }

  /** URL for collection-level endpoints: /{collection}/_apis/{area}/{resource} */
  collectionApiUrl(area: string, resource: string): string {
    return collectionUrl(this.config) + '/_apis/' + area + '/' + resource;
  }

  /** URL for project-level endpoints: /{collection}/{project}/_apis/{area}/{resource} */
  projectApiUrl(area: string, resource: string): string {
    return projectUrl(this.config) + '/_apis/' + area + '/' + resource;
  }

  /** URL for TFVC: /{collection}/_apis/tfvc/{resource} */
  tfvcApiUrl(resource: string): string {
    return this.collectionApiUrl('tfvc', resource);
  }

  /** URL for test endpoints: /{collection}/{project}/_apis/test/{resource} */
  testApiUrl(resource: string): string {
    return this.projectApiUrl('test', resource);
  }

  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const res: AxiosResponse<T> = await this.http.get(url, { params });
      return res.data;
    } catch (err) {
      throw mapAxiosError(err, 'GET ' + url);
    }
  }

  async post<T>(
    url: string,
    body: unknown,
    params?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    try {
      const cfg: AxiosRequestConfig = { params };
      if (extraHeaders) cfg.headers = extraHeaders;
      const res: AxiosResponse<T> = await this.http.post(url, body, cfg);
      return res.data;
    } catch (err) {
      throw mapAxiosError(err, 'POST ' + url);
    }
  }

  async getRaw(url: string, params?: Record<string, unknown>): Promise<Buffer> {
    try {
      const res: AxiosResponse<ArrayBuffer> = await this.http.get(url, {
        params,
        responseType: 'arraybuffer',
      });
      return Buffer.from(res.data);
    } catch (err) {
      throw mapAxiosError(err, 'GET ' + url);
    }
  }

  async patch<T>(url: string, body: unknown, params?: Record<string, unknown>, extraHeaders?: Record<string, string>): Promise<T> {
    try {
      const cfg: AxiosRequestConfig = { params };
      if (extraHeaders) cfg.headers = extraHeaders;
      const res: AxiosResponse<T> = await this.http.patch(url, body, cfg);
      return res.data;
    } catch (err) {
      throw mapAxiosError(err, 'PATCH ' + url);
    }
  }

  async put<T>(url: string, body: unknown, params?: Record<string, unknown>): Promise<T> {
    try {
      const res: AxiosResponse<T> = await this.http.put(url, body, { params });
      return res.data;
    } catch (err) {
      throw mapAxiosError(err, 'PUT ' + url);
    }
  }

  async delete<T = void>(url: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const res: AxiosResponse<T> = await this.http.delete(url, { params });
      return res.data;
    } catch (err) {
      throw mapAxiosError(err, 'DELETE ' + url);
    }
  }

  /**
   * Fetches all pages from a TFS list endpoint.
   * TFS 2018 uses $top/$skip for pagination.
   */
  async getAll<T>(url: string, params: Record<string, unknown> = {}, pageSize?: number): Promise<T[]> {
    const top = pageSize ?? this.config.maxPageSize;
    let skip = 0;
    const results: T[] = [];

    while (true) {
      const page = await this.get<TfsListResponse<T>>(url, { ...params, $top: top, $skip: skip });
      if (!page.value || page.value.length === 0) break;
      results.push(...page.value);
      if (page.value.length < top) break;
      skip += top;
    }

    return results;
  }

  /** Verifies connectivity to the TFS server by hitting the projects endpoint. */
  async ping(): Promise<boolean> {
    try {
      await this.get(this.collectionApiUrl('projects', ''), { $top: 1 });
      return true;
    } catch {
      return false;
    }
  }

  get projectName(): string {
    return this.config.project;
  }
}

let _client: TfsClient | null = null;

export function getTfsClient(): TfsClient {
  if (!_client) {
    _client = new TfsClient();
  }
  return _client;
}

/** Clears the TfsClient singleton. Call alongside resetConfig() in tests. */
export function resetTfsClient(): void {
  _client = null;
}
