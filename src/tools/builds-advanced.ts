import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { Build, BuildDefinition, BuildQueue, TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:builds-advanced');

const ProjectOverride = z.object({
  projectIdOrName: z.string().optional().describe('Project ID or name. Defaults to configured project.'),
});

const BuildIdSchema = z.object({
  buildId: z.number().int().positive().describe('Build ID'),
}).merge(ProjectOverride);

const BuildTagSchema = BuildIdSchema.extend({
  tag: z.string().min(1).describe('Build tag'),
});

const DeleteBuildTagSchema = BuildTagSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to remove a tag from a build'),
});

const GetBuildLogTextSchema = BuildIdSchema.extend({
  logId: z.number().int().positive().describe('Build log ID'),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().positive().optional(),
});

const DownloadBuildArtifactSchema = BuildIdSchema.extend({
  artifactName: z.string().min(1).describe('Artifact name to download'),
  asText: z.boolean().optional().default(false).describe('Return artifact bytes as UTF-8 text instead of base64'),
});

const BuildDefinitionIdSchema = z.object({
  definitionId: z.number().int().positive().describe('Build definition ID'),
}).merge(ProjectOverride);

const WriteBuildDefinitionSchema = z.object({
  definition: z.record(z.unknown()).describe('Full build definition JSON body expected by TFS'),
}).merge(ProjectOverride);

const UpdateBuildDefinitionSchema = BuildDefinitionIdSchema.extend({
  definition: z.record(z.unknown()).describe('Full build definition JSON body expected by TFS'),
});

const DeleteBuildDefinitionSchema = BuildDefinitionIdSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a build definition'),
});

const ListAgentPoolsSchema = z.object({
  poolName: z.string().optional().describe('Optional pool name filter'),
});

const AgentPoolIdSchema = z.object({
  poolId: z.number().int().positive().describe('Agent pool ID'),
});

const ListAgentsSchema = AgentPoolIdSchema.extend({
  agentName: z.string().optional().describe('Optional agent name filter'),
  includeCapabilities: z.boolean().optional().default(false),
  includeAssignedRequest: z.boolean().optional().default(false),
});

const AgentIdSchema = AgentPoolIdSchema.extend({
  agentId: z.number().int().positive().describe('Agent ID'),
  includeCapabilities: z.boolean().optional().default(true),
  includeAssignedRequest: z.boolean().optional().default(true),
});

const ListAgentRequestsSchema = AgentPoolIdSchema.extend({
  top: z.number().int().positive().max(200).optional().default(50),
});

const AgentRequestSchema = AgentPoolIdSchema.extend({
  requestId: z.number().int().positive().describe('Agent request ID'),
});

const ListTaskDefinitionsSchema = z.object({
  taskId: z.string().optional().describe('Optional task GUID'),
  visibility: z.string().optional().describe('Optional visibility filter, e.g. Build or Release'),
});

const VariableGroupIdSchema = z.object({
  groupId: z.number().int().positive().describe('Variable group ID'),
});

const ListVariableGroupsSchema = z.object({
  groupName: z.string().optional().describe('Optional variable group name filter'),
}).merge(ProjectOverride);

const VariableGroupBodySchema = z.object({
  body: z.record(z.unknown()).describe('Variable group JSON body expected by TFS'),
}).merge(ProjectOverride);

const UpdateVariableGroupSchema = VariableGroupIdSchema.extend({
  body: z.record(z.unknown()).describe('Variable group JSON body expected by TFS'),
});

const DeleteVariableGroupSchema = VariableGroupIdSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a variable group'),
});

async function getBuildChanges(args: z.infer<typeof BuildIdSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/builds', args.buildId + '/changes');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function getBuildTags(args: z.infer<typeof BuildIdSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/builds', args.buildId + '/tags');
  const result = await client.get<TfsListResponse<string>>(url);
  return JSON.stringify(result, null, 2);
}

async function addBuildTag(args: z.infer<typeof BuildTagSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/builds', args.buildId + '/tags/' + encodeURIComponent(args.tag));
  const result = await client.put<unknown>(url, {});
  log.info('Added tag ' + args.tag + ' to build #' + args.buildId);
  return JSON.stringify(result, null, 2);
}

async function deleteBuildTag(args: z.infer<typeof DeleteBuildTagSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to remove a build tag.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/builds', args.buildId + '/tags/' + encodeURIComponent(args.tag));
  const result = await client.delete<unknown>(url);
  log.info('Removed tag ' + args.tag + ' from build #' + args.buildId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listAllBuildTags(): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/tags', ''); // project-level, uses default
  const result = await client.get<TfsListResponse<string>>(url);
  return JSON.stringify(result, null, 2);
}

async function getBuildLogText(args: z.infer<typeof GetBuildLogTextSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/builds', args.buildId + '/logs/' + args.logId);
  const params: Record<string, unknown> = { $format: 'text' };
  if (args.startLine !== undefined) params.startLine = args.startLine;
  if (args.endLine !== undefined) params.endLine = args.endLine;
  const bytes = await client.getRaw(url, params);
  return bytes.toString('utf8');
}

async function downloadBuildArtifact(args: z.infer<typeof DownloadBuildArtifactSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/builds', args.buildId + '/artifacts');
  const bytes = await client.getRaw(url, { artifactName: args.artifactName, $format: 'zip' });
  return JSON.stringify({
    buildId: args.buildId,
    artifactName: args.artifactName,
    encoding: args.asText ? 'utf8' : 'base64',
    content: args.asText ? bytes.toString('utf8') : bytes.toString('base64'),
  }, null, 2);
}

async function getBuildDefinitionRevisions(args: z.infer<typeof BuildDefinitionIdSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/definitions', args.definitionId + '/revisions');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function createBuildDefinition(args: z.infer<typeof WriteBuildDefinitionSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/definitions', '');
  const result = await client.post<BuildDefinition>(url, args.definition);
  log.info('Created build definition');
  return JSON.stringify(result, null, 2);
}

async function updateBuildDefinition(args: z.infer<typeof UpdateBuildDefinitionSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/definitions', String(args.definitionId));
  const result = await client.put<BuildDefinition>(url, args.definition);
  log.info('Updated build definition #' + args.definitionId);
  return JSON.stringify(result, null, 2);
}

async function deleteBuildDefinition(args: z.infer<typeof DeleteBuildDefinitionSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a build definition.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('build/definitions', String(args.definitionId));
  const result = await client.delete<unknown>(url);
  log.info('Deleted build definition #' + args.definitionId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listAgentPools(args: z.infer<typeof ListAgentPoolsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('distributedtask/pools', '');
  const params: Record<string, unknown> = { 'api-version': '4.1-preview' };
  if (args.poolName) params.poolName = args.poolName;
  const result = await client.get<TfsListResponse<unknown>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getAgentPool(args: z.infer<typeof AgentPoolIdSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('distributedtask/pools', String(args.poolId));
  const result = await client.get<unknown>(url, { 'api-version': '4.1-preview' });
  return JSON.stringify(result, null, 2);
}

async function listAgents(args: z.infer<typeof ListAgentsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('distributedtask/pools', args.poolId + '/agents');
  const params: Record<string, unknown> = {
    'api-version': '4.1-preview',
    includeCapabilities: args.includeCapabilities,
    includeAssignedRequest: args.includeAssignedRequest,
  };
  if (args.agentName) params.agentName = args.agentName;
  const result = await client.get<TfsListResponse<unknown>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getAgent(args: z.infer<typeof AgentIdSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('distributedtask/pools', args.poolId + '/agents/' + args.agentId);
  const result = await client.get<unknown>(url, {
    'api-version': '4.1-preview',
    includeCapabilities: args.includeCapabilities,
    includeAssignedRequest: args.includeAssignedRequest,
  });
  return JSON.stringify(result, null, 2);
}

async function listAgentRequests(args: z.infer<typeof ListAgentRequestsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('distributedtask/pools', args.poolId + '/jobrequests');
  const result = await client.get<TfsListResponse<unknown>>(url, {
    'api-version': '4.1-preview',
    $top: args.top,
  });
  return JSON.stringify(result, null, 2);
}

async function getAgentRequest(args: z.infer<typeof AgentRequestSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('distributedtask/pools', args.poolId + '/jobrequests/' + args.requestId);
  const result = await client.get<unknown>(url, { 'api-version': '4.1-preview' });
  return JSON.stringify(result, null, 2);
}

async function listTaskDefinitions(args: z.infer<typeof ListTaskDefinitionsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('distributedtask/tasks', args.taskId ? encodeURIComponent(args.taskId) : '');
  const params: Record<string, unknown> = { 'api-version': '4.1-preview' };
  if (args.visibility) params.visibility = args.visibility;
  const result = await client.get<TfsListResponse<unknown>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function listVariableGroups(args: z.infer<typeof ListVariableGroupsSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('distributedtask/variablegroups', '');
  const params: Record<string, unknown> = { 'api-version': '4.1-preview' };
  if (args.groupName) params.groupName = args.groupName;
  const result = await client.get<TfsListResponse<unknown>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getVariableGroup(args: z.infer<typeof VariableGroupIdSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('distributedtask/variablegroups', String(args.groupId));
  const result = await client.get<unknown>(url, { 'api-version': '4.1-preview' });
  return JSON.stringify(result, null, 2);
}

async function createVariableGroup(args: z.infer<typeof VariableGroupBodySchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('distributedtask/variablegroups', '');
  const result = await client.post<unknown>(url, args.body, { 'api-version': '4.1-preview' });
  log.info('Created variable group');
  return JSON.stringify(result, null, 2);
}

async function updateVariableGroup(args: z.infer<typeof UpdateVariableGroupSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('distributedtask/variablegroups', String(args.groupId));
  const result = await client.put<unknown>(url, args.body, { 'api-version': '4.1-preview' });
  log.info('Updated variable group #' + args.groupId);
  return JSON.stringify(result, null, 2);
}

async function deleteVariableGroup(args: z.infer<typeof DeleteVariableGroupSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a variable group.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('distributedtask/variablegroups', String(args.groupId));
  const result = await client.delete<unknown>(url, { 'api-version': '4.1-preview' });
  log.info('Deleted variable group #' + args.groupId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
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

export function registerAdvancedBuildTools(server: McpServer): void {
  registerTool(server, 'tfs_get_build_changes', 'Lists source changes associated with a build.', BuildIdSchema, getBuildChanges);
  registerTool(server, 'tfs_get_build_tags', 'Lists tags on a build.', BuildIdSchema, getBuildTags);
  registerTool(server, 'tfs_add_build_tag', 'Adds a tag to a build.', BuildTagSchema, addBuildTag);
  registerTool(server, 'tfs_delete_build_tag', 'Removes a tag from a build. Requires confirmDelete.', DeleteBuildTagSchema, deleteBuildTag);
  registerTool(server, 'tfs_list_all_build_tags', 'Lists all build tags in the project.', z.object({}), listAllBuildTags);
  registerTool(server, 'tfs_get_build_log_text', 'Gets raw text for one build log.', GetBuildLogTextSchema, getBuildLogText);
  registerTool(server, 'tfs_download_build_artifact', 'Downloads a build artifact zip as base64 or text.', DownloadBuildArtifactSchema, downloadBuildArtifact);
  registerTool(server, 'tfs_get_build_definition_revisions', 'Lists revision history for a build definition.', BuildDefinitionIdSchema, getBuildDefinitionRevisions);
  registerTool(server, 'tfs_create_build_definition', 'Creates a build definition from a full TFS JSON body.', WriteBuildDefinitionSchema, createBuildDefinition);
  registerTool(server, 'tfs_update_build_definition', 'Updates a build definition from a full TFS JSON body.', UpdateBuildDefinitionSchema, updateBuildDefinition);
  registerTool(server, 'tfs_delete_build_definition', 'Deletes a build definition. Requires confirmDelete.', DeleteBuildDefinitionSchema, deleteBuildDefinition);
  registerTool(server, 'tfs_list_agent_pools', 'Lists Distributed Task agent pools.', ListAgentPoolsSchema, listAgentPools);
  registerTool(server, 'tfs_get_agent_pool', 'Gets one Distributed Task agent pool.', AgentPoolIdSchema, getAgentPool);
  registerTool(server, 'tfs_list_agents', 'Lists agents in an agent pool.', ListAgentsSchema, listAgents);
  registerTool(server, 'tfs_get_agent', 'Gets one agent in an agent pool.', AgentIdSchema, getAgent);
  registerTool(server, 'tfs_list_agent_requests', 'Lists job requests in an agent pool.', ListAgentRequestsSchema, listAgentRequests);
  registerTool(server, 'tfs_get_agent_request', 'Gets one job request in an agent pool.', AgentRequestSchema, getAgentRequest);
  registerTool(server, 'tfs_list_task_definitions', 'Lists installed build/release task definitions.', ListTaskDefinitionsSchema, listTaskDefinitions);
  registerTool(server, 'tfs_list_variable_groups', 'Lists Distributed Task variable groups.', ListVariableGroupsSchema, listVariableGroups);
  registerTool(server, 'tfs_get_variable_group', 'Gets one variable group.', VariableGroupIdSchema, getVariableGroup);
  registerTool(server, 'tfs_create_variable_group', 'Creates a variable group from a full TFS JSON body.', VariableGroupBodySchema, createVariableGroup);
  registerTool(server, 'tfs_update_variable_group', 'Updates a variable group from a full TFS JSON body.', UpdateVariableGroupSchema, updateVariableGroup);
  registerTool(server, 'tfs_delete_variable_group', 'Deletes a variable group. Requires confirmDelete.', DeleteVariableGroupSchema, deleteVariableGroup);
}
