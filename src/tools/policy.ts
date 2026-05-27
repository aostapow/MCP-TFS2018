import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:policy');
const POLICY_API_VERSION = '4.1-preview';

const PolicyTypeIdSchema = z.object({
  typeId: z.string().min(1).describe('Policy type GUID'),
});

const ListPolicyConfigurationsSchema = z.object({
  scope: z.string().optional().describe('Optional scope filter if supported by TFS'),
  policyType: z.string().optional().describe('Optional policy type GUID filter'),
});

const PolicyConfigurationIdSchema = z.object({
  configurationId: z.number().int().positive().describe('Policy configuration ID'),
});

const PolicyConfigurationBodySchema = z.object({
  body: z.record(z.unknown()).describe('Policy configuration JSON body expected by TFS'),
});

const UpdatePolicyConfigurationSchema = PolicyConfigurationIdSchema.extend({
  body: z.record(z.unknown()).describe('Policy configuration JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update policy configuration'),
});

const DeletePolicyConfigurationSchema = PolicyConfigurationIdSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete policy configuration'),
});

const EvaluatePolicySchema = z.object({
  body: z.record(z.unknown()).describe('Policy evaluation request body expected by TFS'),
});

function policyParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, 'api-version': POLICY_API_VERSION };
}

async function listPolicyTypes(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.projectApiUrl('policy/types', ''), policyParams());
  return JSON.stringify(result, null, 2);
}

async function getPolicyType(args: z.infer<typeof PolicyTypeIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.projectApiUrl('policy/types', encodeURIComponent(args.typeId)), policyParams());
  return JSON.stringify(result, null, 2);
}

async function listPolicyConfigurations(args: z.infer<typeof ListPolicyConfigurationsSchema>): Promise<string> {
  const client = getTfsClient();
  const params: Record<string, unknown> = {};
  if (args.scope) params.scope = args.scope;
  if (args.policyType) params.policyType = args.policyType;
  const result = await client.get<TfsListResponse<unknown>>(client.projectApiUrl('policy/configurations', ''), policyParams(params));
  return JSON.stringify(result, null, 2);
}

async function getPolicyConfiguration(args: z.infer<typeof PolicyConfigurationIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.projectApiUrl('policy/configurations', String(args.configurationId)), policyParams());
  return JSON.stringify(result, null, 2);
}

async function createPolicyConfiguration(args: z.infer<typeof PolicyConfigurationBodySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.post<unknown>(client.projectApiUrl('policy/configurations', ''), args.body, policyParams());
  log.info('Created policy configuration');
  return JSON.stringify(result, null, 2);
}

async function updatePolicyConfiguration(args: z.infer<typeof UpdatePolicyConfigurationSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update policy configuration.');
  const client = getTfsClient();
  const result = await client.put<unknown>(
    client.projectApiUrl('policy/configurations', String(args.configurationId)),
    args.body,
    policyParams(),
  );
  log.info('Updated policy configuration #' + args.configurationId);
  return JSON.stringify(result, null, 2);
}

async function deletePolicyConfiguration(args: z.infer<typeof DeletePolicyConfigurationSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete policy configuration.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(client.projectApiUrl('policy/configurations', String(args.configurationId)), policyParams());
  log.info('Deleted policy configuration #' + args.configurationId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function evaluatePolicy(args: z.infer<typeof EvaluatePolicySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.post<unknown>(client.projectApiUrl('policy/evaluations', ''), args.body, policyParams());
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

export function registerPolicyTools(server: McpServer): void {
  registerTool(server, 'tfs_list_policy_types', 'Lists available policy types.', z.object({}), listPolicyTypes);
  registerTool(server, 'tfs_get_policy_type', 'Gets one policy type by GUID.', PolicyTypeIdSchema, getPolicyType);
  registerTool(server, 'tfs_list_policy_configurations', 'Lists policy configurations.', ListPolicyConfigurationsSchema, listPolicyConfigurations);
  registerTool(server, 'tfs_get_policy_configuration', 'Gets one policy configuration.', PolicyConfigurationIdSchema, getPolicyConfiguration);
  registerTool(server, 'tfs_create_policy_configuration', 'Creates a policy configuration.', PolicyConfigurationBodySchema, createPolicyConfiguration);
  registerTool(server, 'tfs_update_policy_configuration', 'Updates a policy configuration. Requires confirmUpdate.', UpdatePolicyConfigurationSchema, updatePolicyConfiguration);
  registerTool(server, 'tfs_delete_policy_configuration', 'Deletes a policy configuration. Requires confirmDelete.', DeletePolicyConfigurationSchema, deletePolicyConfiguration);
  registerTool(server, 'tfs_evaluate_policy', 'Evaluates policy using a TFS policy evaluation request body.', EvaluatePolicySchema, evaluatePolicy);
}
