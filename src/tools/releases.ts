import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:releases');
const RELEASE_API_VERSION = '4.1-preview';

const ListReleaseDefinitionsSchema = z.object({
  searchText: z.string().optional().describe('Filter release definitions by name/text'),
  path: z.string().optional().describe('Folder path filter'),
  top: z.number().int().positive().max(200).optional().default(50),
});

const ReleaseDefinitionIdSchema = z.object({
  definitionId: z.number().int().positive().describe('Release definition ID'),
});

const CreateReleaseDefinitionSchema = z.object({
  definition: z.record(z.unknown()).describe('Full release definition JSON body expected by TFS'),
});

const UpdateReleaseDefinitionSchema = ReleaseDefinitionIdSchema.extend({
  definition: z.record(z.unknown()).describe('Full release definition JSON body expected by TFS'),
});

const DeleteReleaseDefinitionSchema = ReleaseDefinitionIdSchema.extend({
  comment: z.string().optional().describe('Optional deletion comment'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a release definition'),
});

const ListReleasesSchema = z.object({
  definitionId: z.number().int().positive().optional().describe('Filter by release definition ID'),
  statusFilter: z.string().optional().describe('Optional status filter supported by TFS'),
  searchText: z.string().optional().describe('Filter by release name/text'),
  top: z.number().int().positive().max(200).optional().default(50),
});

const ReleaseIdSchema = z.object({
  releaseId: z.number().int().positive().describe('Release ID'),
});

const GetReleaseSchema = ReleaseIdSchema.extend({
  expand: z.string().optional().describe('Optional $expand value, e.g. environments, artifacts, approvals'),
});

const CreateReleaseSchema = z.object({
  definitionId: z.number().int().positive().describe('Release definition ID'),
  description: z.string().optional(),
  artifacts: z.array(z.record(z.unknown())).optional().describe('Optional artifact metadata overrides'),
  variables: z.record(z.unknown()).optional().describe('Optional release variables'),
  isDraft: z.boolean().optional().default(false),
  reason: z.string().optional().describe('Audit reason/comment for creating the release'),
  confirmCreate: z.boolean().optional().default(false).describe('Required to create a release'),
});

const UpdateReleaseSchema = ReleaseIdSchema.extend({
  body: z.record(z.unknown()).describe('Partial release update JSON body expected by TFS'),
  reason: z.string().optional().describe('Audit reason/comment'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a release'),
});

const AbandonReleaseSchema = ReleaseIdSchema.extend({
  comment: z.string().optional().describe('Optional abandon comment'),
  confirmAbandon: z.boolean().optional().default(false).describe('Required to abandon a release'),
});

const EnvironmentSchema = ReleaseIdSchema.extend({
  environmentId: z.number().int().positive().describe('Release environment ID'),
});

const UpdateEnvironmentSchema = EnvironmentSchema.extend({
  body: z.record(z.unknown()).describe('Environment update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a release environment'),
});

const ListDeploymentsSchema = z.object({
  definitionId: z.number().int().positive().optional(),
  definitionEnvironmentId: z.number().int().positive().optional(),
  deploymentStatus: z.string().optional(),
  operationStatus: z.string().optional(),
  top: z.number().int().positive().max(200).optional().default(50),
});

const DeploymentIdSchema = z.object({
  deploymentId: z.number().int().positive().describe('Deployment ID'),
});

const ListApprovalsSchema = z.object({
  assignedToFilter: z.string().optional().describe('Approver identity filter'),
  statusFilter: z.string().optional().describe('Approval status filter, e.g. pending, approved, rejected'),
  typeFilter: z.string().optional().describe('Approval type filter, e.g. preDeploy, postDeploy'),
  releaseIdsFilter: z.array(z.number().int().positive()).optional().describe('Release IDs filter'),
  top: z.number().int().positive().max(200).optional().default(50),
});

const ApprovalIdSchema = z.object({
  approvalId: z.number().int().positive().describe('Approval ID'),
});

const UpdateApprovalSchema = ApprovalIdSchema.extend({
  status: z.string().describe('Approval status to set, e.g. approved, rejected, reassigned'),
  comments: z.string().optional(),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update an approval'),
});

const ApprovalDecisionSchema = ApprovalIdSchema.extend({
  comments: z.string().optional(),
  confirmDecision: z.boolean().optional().default(false).describe('Required to approve/reject'),
});

const GetReleaseLogsSchema = ReleaseIdSchema.extend({
  asText: z.boolean().optional().default(false).describe('Return log archive bytes as UTF-8 text instead of base64'),
});

function releaseParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, 'api-version': RELEASE_API_VERSION };
}

async function listReleaseDefinitions(args: z.infer<typeof ListReleaseDefinitionsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/definitions', '');
  const params: Record<string, unknown> = { $top: args.top };
  if (args.searchText) params.searchText = args.searchText;
  if (args.path) params.path = args.path;
  const result = await client.get<TfsListResponse<unknown>>(url, releaseParams(params));
  return JSON.stringify(result, null, 2);
}

async function getReleaseDefinition(args: z.infer<typeof ReleaseDefinitionIdSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/definitions', String(args.definitionId));
  const result = await client.get<unknown>(url, releaseParams());
  return JSON.stringify(result, null, 2);
}

async function createReleaseDefinition(args: z.infer<typeof CreateReleaseDefinitionSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/definitions', '');
  const result = await client.post<unknown>(url, args.definition, releaseParams());
  log.info('Created release definition');
  return JSON.stringify(result, null, 2);
}

async function updateReleaseDefinition(args: z.infer<typeof UpdateReleaseDefinitionSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/definitions', String(args.definitionId));
  const result = await client.put<unknown>(url, args.definition, releaseParams());
  log.info('Updated release definition #' + args.definitionId);
  return JSON.stringify(result, null, 2);
}

async function deleteReleaseDefinition(args: z.infer<typeof DeleteReleaseDefinitionSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a release definition.');
  const client = getTfsClient();
  const url = client.projectApiUrl('release/definitions', String(args.definitionId));
  const result = await client.delete<unknown>(url, releaseParams(args.comment ? { comment: args.comment } : {}));
  log.info('Deleted release definition #' + args.definitionId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listReleases(args: z.infer<typeof ListReleasesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/releases', '');
  const params: Record<string, unknown> = { $top: args.top };
  if (args.definitionId) params.definitionId = args.definitionId;
  if (args.statusFilter) params.statusFilter = args.statusFilter;
  if (args.searchText) params.searchText = args.searchText;
  const result = await client.get<TfsListResponse<unknown>>(url, releaseParams(params));
  return JSON.stringify(result, null, 2);
}

async function getRelease(args: z.infer<typeof GetReleaseSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/releases', String(args.releaseId));
  const result = await client.get<unknown>(url, releaseParams(args.expand ? { '$expand': args.expand } : {}));
  return JSON.stringify(result, null, 2);
}

async function createRelease(args: z.infer<typeof CreateReleaseSchema>): Promise<string> {
  if (!args.confirmCreate) throw new Error('confirmCreate=true is required to create a release.');
  const client = getTfsClient();
  const url = client.projectApiUrl('release/releases', '');
  const result = await client.post<unknown>(url, {
    definitionId: args.definitionId,
    description: args.description ?? args.reason,
    artifacts: args.artifacts,
    variables: args.variables,
    isDraft: args.isDraft,
  }, releaseParams());
  log.info('Created release from definition #' + args.definitionId);
  return JSON.stringify(result, null, 2);
}

async function updateRelease(args: z.infer<typeof UpdateReleaseSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a release.');
  const client = getTfsClient();
  const url = client.projectApiUrl('release/releases', String(args.releaseId));
  const result = await client.patch<unknown>(url, args.body, releaseParams(args.reason ? { comment: args.reason } : {}));
  log.info('Updated release #' + args.releaseId);
  return JSON.stringify(result, null, 2);
}

async function abandonRelease(args: z.infer<typeof AbandonReleaseSchema>): Promise<string> {
  if (!args.confirmAbandon) throw new Error('confirmAbandon=true is required to abandon a release.');
  const client = getTfsClient();
  const url = client.projectApiUrl('release/releases', String(args.releaseId));
  const result = await client.patch<unknown>(url, {
    status: 'abandoned',
    comment: args.comment,
  }, releaseParams());
  log.info('Abandoned release #' + args.releaseId);
  return JSON.stringify(result, null, 2);
}

async function getReleaseEnvironment(args: z.infer<typeof EnvironmentSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/releases', args.releaseId + '/environments/' + args.environmentId);
  const result = await client.get<unknown>(url, releaseParams());
  return JSON.stringify(result, null, 2);
}

async function updateReleaseEnvironment(args: z.infer<typeof UpdateEnvironmentSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a release environment.');
  const client = getTfsClient();
  const url = client.projectApiUrl('release/releases', args.releaseId + '/environments/' + args.environmentId);
  const result = await client.patch<unknown>(url, args.body, releaseParams());
  log.info('Updated release environment #' + args.environmentId + ' in release #' + args.releaseId);
  return JSON.stringify(result, null, 2);
}

async function listDeployments(args: z.infer<typeof ListDeploymentsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/deployments', '');
  const params: Record<string, unknown> = { $top: args.top };
  if (args.definitionId) params.definitionId = args.definitionId;
  if (args.definitionEnvironmentId) params.definitionEnvironmentId = args.definitionEnvironmentId;
  if (args.deploymentStatus) params.deploymentStatus = args.deploymentStatus;
  if (args.operationStatus) params.operationStatus = args.operationStatus;
  const result = await client.get<TfsListResponse<unknown>>(url, releaseParams(params));
  return JSON.stringify(result, null, 2);
}

async function getDeployment(args: z.infer<typeof DeploymentIdSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/deployments', String(args.deploymentId));
  const result = await client.get<unknown>(url, releaseParams());
  return JSON.stringify(result, null, 2);
}

async function listApprovals(args: z.infer<typeof ListApprovalsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/approvals', '');
  const params: Record<string, unknown> = { $top: args.top };
  if (args.assignedToFilter) params.assignedToFilter = args.assignedToFilter;
  if (args.statusFilter) params.statusFilter = args.statusFilter;
  if (args.typeFilter) params.typeFilter = args.typeFilter;
  if (args.releaseIdsFilter?.length) params.releaseIdsFilter = args.releaseIdsFilter.join(',');
  const result = await client.get<TfsListResponse<unknown>>(url, releaseParams(params));
  return JSON.stringify(result, null, 2);
}

async function getApproval(args: z.infer<typeof ApprovalIdSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/approvals', String(args.approvalId));
  const result = await client.get<unknown>(url, releaseParams());
  return JSON.stringify(result, null, 2);
}

async function updateApproval(args: z.infer<typeof UpdateApprovalSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a release approval.');
  const client = getTfsClient();
  const url = client.projectApiUrl('release/approvals', String(args.approvalId));
  const result = await client.patch<unknown>(url, {
    status: args.status,
    comments: args.comments,
  }, releaseParams());
  log.info('Updated release approval #' + args.approvalId + ' -> ' + args.status);
  return JSON.stringify(result, null, 2);
}

async function approveRelease(args: z.infer<typeof ApprovalDecisionSchema>): Promise<string> {
  if (!args.confirmDecision) throw new Error('confirmDecision=true is required to approve a release.');
  return updateApproval({ ...args, status: 'approved', confirmUpdate: true });
}

async function rejectRelease(args: z.infer<typeof ApprovalDecisionSchema>): Promise<string> {
  if (!args.confirmDecision) throw new Error('confirmDecision=true is required to reject a release.');
  return updateApproval({ ...args, status: 'rejected', confirmUpdate: true });
}

async function getReleaseLogs(args: z.infer<typeof GetReleaseLogsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('release/releases', args.releaseId + '/logs');
  const bytes = await client.getRaw(url, releaseParams());
  return JSON.stringify({
    releaseId: args.releaseId,
    encoding: args.asText ? 'utf8' : 'base64',
    content: args.asText ? bytes.toString('utf8') : bytes.toString('base64'),
  }, null, 2);
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

export function registerReleaseTools(server: McpServer): void {
  registerTool(server, 'tfs_list_release_definitions', 'Lists release definitions in the configured project.', ListReleaseDefinitionsSchema, listReleaseDefinitions);
  registerTool(server, 'tfs_get_release_definition', 'Gets one release definition by ID.', ReleaseDefinitionIdSchema, getReleaseDefinition);
  registerTool(server, 'tfs_create_release_definition', 'Creates a release definition from a full TFS JSON body.', CreateReleaseDefinitionSchema, createReleaseDefinition);
  registerTool(server, 'tfs_update_release_definition', 'Updates a release definition from a full TFS JSON body.', UpdateReleaseDefinitionSchema, updateReleaseDefinition);
  registerTool(server, 'tfs_delete_release_definition', 'Deletes a release definition. Requires confirmDelete.', DeleteReleaseDefinitionSchema, deleteReleaseDefinition);
  registerTool(server, 'tfs_list_releases', 'Lists releases in the configured project.', ListReleasesSchema, listReleases);
  registerTool(server, 'tfs_get_release', 'Gets one release by ID.', GetReleaseSchema, getRelease);
  registerTool(server, 'tfs_create_release', 'Creates a release from a definition. Requires confirmCreate.', CreateReleaseSchema, createRelease);
  registerTool(server, 'tfs_update_release', 'Updates a release. Requires confirmUpdate.', UpdateReleaseSchema, updateRelease);
  registerTool(server, 'tfs_abandon_release', 'Abandons a release. Requires confirmAbandon.', AbandonReleaseSchema, abandonRelease);
  registerTool(server, 'tfs_get_release_environment', 'Gets one environment from a release.', EnvironmentSchema, getReleaseEnvironment);
  registerTool(server, 'tfs_update_release_environment', 'Updates a release environment. Requires confirmUpdate.', UpdateEnvironmentSchema, updateReleaseEnvironment);
  registerTool(server, 'tfs_list_release_deployments', 'Lists release deployments.', ListDeploymentsSchema, listDeployments);
  registerTool(server, 'tfs_get_release_deployment', 'Gets one release deployment by ID.', DeploymentIdSchema, getDeployment);
  registerTool(server, 'tfs_list_release_approvals', 'Lists release approvals.', ListApprovalsSchema, listApprovals);
  registerTool(server, 'tfs_get_release_approval', 'Gets one release approval by ID.', ApprovalIdSchema, getApproval);
  registerTool(server, 'tfs_update_release_approval', 'Updates a release approval status/comments. Requires confirmUpdate.', UpdateApprovalSchema, updateApproval);
  registerTool(server, 'tfs_approve_release', 'Approves a pending release approval. Requires confirmDecision.', ApprovalDecisionSchema, approveRelease);
  registerTool(server, 'tfs_reject_release', 'Rejects a pending release approval. Requires confirmDecision.', ApprovalDecisionSchema, rejectRelease);
  registerTool(server, 'tfs_get_release_logs', 'Downloads release logs as base64 or UTF-8 text.', GetReleaseLogsSchema, getReleaseLogs);
}
