import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:security');

const NamespaceIdSchema = z.object({
  namespaceId: z.string().min(1).describe('Security namespace ID'),
});

const QueryAclsSchema = NamespaceIdSchema.extend({
  token: z.string().optional().describe('Security token filter'),
  descriptors: z.array(z.string()).optional().describe('Identity descriptors'),
  includeExtendedInfo: z.boolean().optional().default(false),
  recurse: z.boolean().optional().default(false),
});

const AclBodySchema = NamespaceIdSchema.extend({
  body: z.unknown().describe('ACL JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to mutate ACLs'),
});

const RemoveAclSchema = NamespaceIdSchema.extend({
  tokens: z.array(z.string()).min(1).describe('ACL tokens to remove'),
  recurse: z.boolean().optional().default(false),
  confirmRemove: z.boolean().optional().default(false).describe('Required to remove ACLs'),
});

const AceBodySchema = NamespaceIdSchema.extend({
  body: z.unknown().describe('ACE JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to mutate ACEs'),
});

const RemoveAceSchema = NamespaceIdSchema.extend({
  token: z.string().min(1),
  descriptors: z.array(z.string()).min(1),
  confirmRemove: z.boolean().optional().default(false).describe('Required to remove ACEs'),
});

const EvaluatePermissionsSchema = NamespaceIdSchema.extend({
  body: z.unknown().describe('Permission evaluation body expected by TFS'),
});

const InheritFlagSchema = NamespaceIdSchema.extend({
  token: z.string().min(1),
  inherit: z.boolean(),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update inherit flag'),
});

async function listSecurityNamespaces(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('securitynamespaces', ''));
  return JSON.stringify(result, null, 2);
}

async function getSecurityNamespace(args: z.infer<typeof NamespaceIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('securitynamespaces', args.namespaceId));
  return JSON.stringify(result, null, 2);
}

async function queryAcls(args: z.infer<typeof QueryAclsSchema>): Promise<string> {
  const client = getTfsClient();
  const params: Record<string, unknown> = {
    includeExtendedInfo: args.includeExtendedInfo,
    recurse: args.recurse,
  };
  if (args.token) params.token = args.token;
  if (args.descriptors?.length) params.descriptors = args.descriptors.join(',');
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('accesscontrollists', args.namespaceId), params);
  return JSON.stringify(result, null, 2);
}

async function setAcls(args: z.infer<typeof AclBodySchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to set ACLs.');
  const client = getTfsClient();
  const result = await client.post<unknown>(client.collectionApiUrl('accesscontrollists', args.namespaceId), args.body);
  log.info('Set ACLs in namespace ' + args.namespaceId);
  return JSON.stringify(result, null, 2);
}

async function removeAcls(args: z.infer<typeof RemoveAclSchema>): Promise<string> {
  if (!args.confirmRemove) throw new Error('confirmRemove=true is required to remove ACLs.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(client.collectionApiUrl('accesscontrollists', args.namespaceId), {
    tokens: args.tokens.join(','),
    recurse: args.recurse,
  });
  log.info('Removed ACLs in namespace ' + args.namespaceId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function setAces(args: z.infer<typeof AceBodySchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to set ACEs.');
  const client = getTfsClient();
  const result = await client.post<unknown>(client.collectionApiUrl('accesscontrolentries', args.namespaceId), args.body);
  log.info('Set ACEs in namespace ' + args.namespaceId);
  return JSON.stringify(result, null, 2);
}

async function removeAces(args: z.infer<typeof RemoveAceSchema>): Promise<string> {
  if (!args.confirmRemove) throw new Error('confirmRemove=true is required to remove ACEs.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(client.collectionApiUrl('accesscontrolentries', args.namespaceId), {
    token: args.token,
    descriptors: args.descriptors.join(','),
  });
  log.info('Removed ACEs in namespace ' + args.namespaceId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function evaluatePermissions(args: z.infer<typeof EvaluatePermissionsSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.post<unknown>(client.collectionApiUrl('permissions', args.namespaceId), args.body);
  return JSON.stringify(result, null, 2);
}

async function setInheritFlag(args: z.infer<typeof InheritFlagSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update inherit flag.');
  const client = getTfsClient();
  const result = await client.post<unknown>(client.collectionApiUrl('accesscontrollists', args.namespaceId + '/' + encodeURIComponent(args.token)), {
    inheritPermissions: args.inherit,
  });
  log.info('Updated inherit flag in namespace ' + args.namespaceId);
  return JSON.stringify(result, null, 2);
}

function registerTool<TSchema extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  name: string,
  description: string,
  schema: TSchema,
  handler: (args: z.infer<TSchema>) => Promise<string>,
): void {
  server.tool(name, description, schema.shape, async (args: z.infer<TSchema>) => {
    try {
      return { content: [{ type: 'text' as const, text: await handler(args) }] };
    } catch (err) {
      log.error(name + ' failed', { err });
      return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
    }
  });
}

export function registerSecurityTools(server: McpServer): void {
  registerTool(server, 'tfs_list_security_namespaces', 'Lists security namespaces.', z.object({}), listSecurityNamespaces);
  registerTool(server, 'tfs_get_security_namespace', 'Gets one security namespace.', NamespaceIdSchema, getSecurityNamespace);
  registerTool(server, 'tfs_query_access_control_lists', 'Queries access control lists.', QueryAclsSchema, queryAcls);
  registerTool(server, 'tfs_set_access_control_lists', 'Sets ACLs. Requires confirmUpdate.', AclBodySchema, setAcls);
  registerTool(server, 'tfs_remove_access_control_lists', 'Removes ACLs. Requires confirmRemove.', RemoveAclSchema, removeAcls);
  registerTool(server, 'tfs_set_access_control_entries', 'Sets ACEs. Requires confirmUpdate.', AceBodySchema, setAces);
  registerTool(server, 'tfs_remove_access_control_entries', 'Removes ACEs. Requires confirmRemove.', RemoveAceSchema, removeAces);
  registerTool(server, 'tfs_evaluate_permissions', 'Evaluates effective permissions.', EvaluatePermissionsSchema, evaluatePermissions);
  registerTool(server, 'tfs_set_inherit_flag', 'Sets ACL inheritance flag. Requires confirmUpdate.', InheritFlagSchema, setInheritFlag);
}
