import https from 'https';
import type { AxiosRequestConfig } from 'axios';
import type { AuthConfig, TfsConfig } from './types/tfs.js';
import { TfsConfigError } from './utils/errors.js';
import { createChildLogger } from './utils/logger.js';

const log = createChildLogger('auth');

function buildBasicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(username + ':' + password).toString('base64');
  return 'Basic ' + token;
}

function buildPatAuthHeader(pat: string): string {
  const token = Buffer.from(':' + pat).toString('base64');
  return 'Basic ' + token;
}

/**
 * Derives the Kerberos SPN from the TFS base URL when not explicitly configured.
 * TFS uses HTTP/<hostname> as the SPN.
 */
function deriveSpn(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return 'HTTP/' + u.hostname;
  } catch {
    throw new TfsConfigError('Cannot derive Kerberos SPN from invalid URL: ' + baseUrl);
  }
}

/**
 * Obtains a Kerberos Negotiate token for the given SPN.
 * Requires the `kerberos` npm package and a valid Kerberos session (kinit on
 * Linux/macOS, or Windows domain login via SSPI).
 */
async function buildKerberosAuthHeader(spn: string): Promise<string> {
  let kerberosModule: { initializeClient: (spn: string) => Promise<{ step: (input: string) => Promise<string> }> };
  try {
    // Dynamic import so the package is optional — server still starts without it
    kerberosModule = await import('kerberos') as typeof kerberosModule;
  } catch {
    throw new TfsConfigError(
      'The "kerberos" package is not installed. Run: npm install kerberos\n' +
      'On Linux/macOS you also need: kinit <username>@<DOMAIN>',
    );
  }

  try {
    const client = await kerberosModule.initializeClient(spn);
    const token = await client.step('');
    log.debug('Kerberos token obtained for SPN: ' + spn);
    return 'Negotiate ' + token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TfsConfigError(
      'Kerberos authentication failed for SPN "' + spn + '": ' + msg + '\n' +
      'Ensure you have a valid Kerberos ticket (run "kinit" on Linux/macOS).',
    );
  }
}

/**
 * Applies authentication to an Axios request config.
 * For NTLM: handled by NtlmClient in tfs-client.ts — returns config unchanged.
 * For Kerberos: async, use applyAuthAsync instead.
 */
export function applyAuth(
  axiosConfig: AxiosRequestConfig,
  auth: AuthConfig,
): AxiosRequestConfig {
  switch (auth.type) {
    case 'pat': {
      if (!auth.pat) throw new TfsConfigError('PAT is undefined');
      log.debug('Using PAT authentication');
      return {
        ...axiosConfig,
        headers: { ...axiosConfig.headers, Authorization: buildPatAuthHeader(auth.pat) },
      };
    }
    case 'basic': {
      if (!auth.username || !auth.password) {
        throw new TfsConfigError('Username and password are required for Basic auth');
      }
      log.debug('Using Basic authentication', { username: auth.username });
      return {
        ...axiosConfig,
        headers: {
          ...axiosConfig.headers,
          Authorization: buildBasicAuthHeader(auth.username, auth.password),
        },
      };
    }
    case 'ntlm': {
      // NtlmClient handles this at the adapter level — nothing to do here
      log.debug('NTLM auth handled by NtlmClient adapter');
      return { ...axiosConfig };
    }
    case 'kerberos': {
      // Kerberos is async — call applyAuthAsync() instead
      log.debug('Kerberos auth requires applyAuthAsync()');
      return { ...axiosConfig };
    }
    default: {
      const _exhaustive: never = auth.type;
      throw new TfsConfigError('Unknown auth type: ' + (_exhaustive as string));
    }
  }
}

/**
 * Async version of applyAuth, required for Kerberos token acquisition.
 */
export async function applyAuthAsync(
  axiosConfig: AxiosRequestConfig,
  auth: AuthConfig,
  baseUrl?: string,
): Promise<AxiosRequestConfig> {
  if (auth.type === 'kerberos') {
    const spn = auth.spn ?? (baseUrl ? deriveSpn(baseUrl) : undefined);
    if (!spn) throw new TfsConfigError('Cannot determine Kerberos SPN — provide TFS_KERBEROS_SPN or TFS_BASE_URL');
    const header = await buildKerberosAuthHeader(spn);
    return {
      ...axiosConfig,
      headers: { ...axiosConfig.headers, Authorization: header },
    };
  }
  return applyAuth(axiosConfig, auth);
}

/**
 * Builds Axios agent options for proxy and TLS configuration.
 */
export function buildAgentOptions(config: TfsConfig): Partial<AxiosRequestConfig> {
  const result: Partial<AxiosRequestConfig> = {};

  if (!config.tlsRejectUnauthorized) {
    log.warn('TLS certificate validation is DISABLED (TFS_TLS_REJECT_UNAUTHORIZED=false)');
    result.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }

  if (config.proxyUrl) {
    log.info('Using proxy: ' + config.proxyUrl);
    try {
      const proxy = new URL(config.proxyUrl);
      result.proxy = {
        host: proxy.hostname,
        port: parseInt(proxy.port, 10) || (proxy.protocol === 'https:' ? 443 : 80),
        protocol: proxy.protocol,
        auth: proxy.username
          ? { username: proxy.username, password: proxy.password }
          : undefined,
      };
    } catch {
      throw new TfsConfigError('Invalid TFS_PROXY_URL: ' + config.proxyUrl);
    }
  }

  return result;
}
