import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfig } from '../config.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:rest');

const QueryValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);

const RestRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).default('GET')
    .describe('HTTP method to execute against the TFS REST API.'),
  scope: z.enum(['server', 'collection', 'project']).default('project')
    .describe('URL scope: server = /_apis, collection = /{collection}/_apis, project = /{collection}/{project}/_apis.'),
  area: z.string().min(1).describe('REST API area, e.g. "test", "wit", "build", "git", "release", "distributedtask".'),
  resource: z.string().optional().default('')
    .describe('Resource path below the area, e.g. "plans/37/suites/38/testcases/39".'),
  query: z.record(QueryValueSchema).optional()
    .describe('Query string parameters. Do not include api-version here; use apiVersion instead.'),
  body: z.unknown().optional().describe('JSON body for POST, PATCH, or PUT requests.'),
  apiVersion: z.string().optional()
    .describe('Override api-version, e.g. "4.1" or "4.1-preview". Defaults to TFS_API_VERSION.'),
  contentType: z.enum(['application/json', 'application/json-patch+json']).optional()
    .default('application/json')
    .describe('Content-Type for write requests. Use application/json-patch+json for JSON Patch bodies.'),
  confirmWrite: z.boolean().optional().default(false)
    .describe('Required for POST, PATCH, PUT, and DELETE. Prevents accidental writes.'),
  confirmDelete: z.boolean().optional().default(false)
    .describe('Required in addition to confirmWrite for DELETE requests.'),
  reason: z.string().optional()
    .describe('Human-readable reason for write requests; useful for audit/logs.'),
});

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function buildApiUrl(scope: 'server' | 'collection' | 'project', area: string, resource: string): string {
  const cfg = getConfig();
  const cleanArea = trimSlashes(area);
  const cleanResource = trimSlashes(resource);
  const suffix = cleanResource ? cleanArea + '/' + cleanResource : cleanArea;

  if (scope === 'server') {
    return cfg.baseUrl + '/_apis/' + suffix;
  }

  const client = getTfsClient();
  if (scope === 'collection') {
    return client.collectionApiUrl(cleanArea, cleanResource);
  }

  return client.projectApiUrl(cleanArea, cleanResource);
}

async function restRequest(args: z.infer<typeof RestRequestSchema>): Promise<string> {
  const method = args.method;
  const isWrite = method !== 'GET';

  if (isWrite && !args.confirmWrite) {
    throw new Error('confirmWrite=true is required for POST, PATCH, PUT, and DELETE requests.');
  }

  if (method === 'DELETE' && !args.confirmDelete) {
    throw new Error('confirmDelete=true is required for DELETE requests.');
  }

  if (isWrite && !args.reason) {
    throw new Error('A reason is required for write requests.');
  }

  const client = getTfsClient();
  const url = buildApiUrl(args.scope, args.area, args.resource ?? '');
  const params: Record<string, unknown> = { ...(args.query ?? {}) };
  if (args.apiVersion) params['api-version'] = args.apiVersion;

  log.info('Executing generic TFS REST request', {
    method,
    scope: args.scope,
    area: args.area,
    resource: args.resource,
    reason: args.reason,
  });

  let result: unknown;
  if (method === 'GET') {
    result = await client.get<unknown>(url, params);
  } else if (method === 'POST') {
    result = await client.post<unknown>(url, args.body ?? {}, params);
  } else if (method === 'PATCH') {
    const headers = args.contentType ? { 'Content-Type': args.contentType } : undefined;
    result = await client.patch<unknown>(url, args.body ?? {}, params, headers);
  } else if (method === 'PUT') {
    result = await client.put<unknown>(url, args.body ?? {}, params);
  } else {
    result = await client.delete<unknown>(url, params);
  }

  if (result === undefined || result === null || result === '') {
    return JSON.stringify({ ok: true, status: 'empty-response' }, null, 2);
  }

  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

export function registerRestTools(server: McpServer): void {
  server.tool(
    'tfs_rest_request',
    'Executes a generic TFS 2018 REST API request for endpoints not yet exposed as dedicated MCP tools. Writes require confirmWrite and a reason; DELETE also requires confirmDelete.',
    RestRequestSchema.shape,
    async (args: z.infer<typeof RestRequestSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await restRequest(args) }] };
      } catch (err) {
        log.error('tfs_rest_request failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );
}
