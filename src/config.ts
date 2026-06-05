import dotenv from 'dotenv';
import { z } from 'zod';
import { TfsConfigError } from './utils/errors.js';
import type { TfsConfig, AuthConfig, AuthType } from './types/tfs.js';

dotenv.config();

const envSchema = z.object({
  // TFS connection
  TFS_BASE_URL: z.string().url('TFS_BASE_URL must be a valid URL'),
  TFS_COLLECTION: z.string().default('DefaultCollection'),
  TFS_PROJECT: z.string().min(1, 'TFS_PROJECT is required'),
  TFS_API_VERSION: z.string().default('4.1'),
  TFS_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  TFS_MAX_PAGE_SIZE: z.coerce.number().int().positive().max(500).default(200),

  // Auth
  TFS_AUTH_TYPE: z.enum(['ntlm', 'basic', 'pat', 'kerberos']).default('ntlm'),
  TFS_USERNAME: z.string().optional(),
  TFS_PASSWORD: z.string().optional(),
  TFS_DOMAIN: z.string().optional(),
  TFS_PAT: z.string().optional(),
  TFS_KERBEROS_SPN: z.string().optional(),

  // Network
  TFS_PROXY_URL: z.string().url().optional(),
  TFS_TLS_REJECT_UNAUTHORIZED: z.coerce.boolean().default(true),

  // MCP transport
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_PORT: z.coerce.number().int().positive().default(3000),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty'),
});

type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => '  - ' + i.path.join('.') + ': ' + i.message)
      .join('\n');
    throw new TfsConfigError('Invalid environment configuration:\n' + issues);
  }
  return result.data;
}

function buildAuth(env: Env): AuthConfig {
  const type: AuthType = env.TFS_AUTH_TYPE;

  if (type === 'pat') {
    if (!env.TFS_PAT) {
      throw new TfsConfigError('TFS_PAT is required when TFS_AUTH_TYPE=pat');
    }
    return { type, pat: env.TFS_PAT };
  }

  if (type === 'kerberos') {
    // Kerberos uses the current OS session ticket — no password needed.
    // SPN is optional; auto-derived from TFS_BASE_URL if omitted.
    return { type, spn: env.TFS_KERBEROS_SPN };
  }

  if (type === 'ntlm' || type === 'basic') {
    if (!env.TFS_USERNAME || !env.TFS_PASSWORD) {
      throw new TfsConfigError(
        'TFS_USERNAME and TFS_PASSWORD are required when TFS_AUTH_TYPE=' + type,
      );
    }
    return {
      type,
      username: env.TFS_USERNAME,
      password: env.TFS_PASSWORD,
      domain: env.TFS_DOMAIN,
    };
  }

  throw new TfsConfigError('Unsupported TFS_AUTH_TYPE: ' + (type as string));
}

let _config: TfsConfig | null = null;

export function getConfig(): TfsConfig {
  if (_config) return _config;

  const env = parseEnv();
  const auth = buildAuth(env);
  const baseUrl = env.TFS_BASE_URL.replace(/\/+$/, '');

  _config = {
    baseUrl,
    collection: env.TFS_COLLECTION,
    project: env.TFS_PROJECT,
    apiVersion: env.TFS_API_VERSION,
    timeoutMs: env.TFS_TIMEOUT_MS,
    maxPageSize: env.TFS_MAX_PAGE_SIZE,
    auth,
    proxyUrl: env.TFS_PROXY_URL,
    tlsRejectUnauthorized: env.TFS_TLS_REJECT_UNAUTHORIZED,
  };

  return _config;
}

export function resetConfig(): void {
  _config = null;
}

export function collectionUrl(config: TfsConfig): string {
  return config.baseUrl + '/' + config.collection;
}

export function projectUrl(config: TfsConfig): string {
  return collectionUrl(config) + '/' + encodeURIComponent(config.project);
}

export function resolveProject(override?: string): string {
  return override ?? getConfig().project;
}

export type { TfsConfig };
