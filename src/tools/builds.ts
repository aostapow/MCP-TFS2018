import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type {
  Build,
  BuildDefinitionRef,
  BuildDefinition,
  BuildLog,
  BuildArtifact,
  BuildTimeline,
  BuildQueue,
  BuildQueueRequest,
  TfsListResponse,
} from '../types/tfs.js';

const log = createChildLogger('tool:builds');

// ─── Input schemas ────────────────────────────────────────────────────────────

const ListBuildDefinitionsSchema = z.object({
  name: z.string().optional().describe('Filter definitions by name (supports wildcards with *)'),
  type: z.enum(['build', 'xaml', 'all']).optional().default('build').describe('Definition type'),
  top: z.number().int().positive().max(200).optional().default(50).describe('Maximum results'),
});

const GetBuildDefinitionSchema = z.object({
  definitionId: z.number().int().positive().describe('Build definition ID'),
  revision: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Specific revision to retrieve (latest if omitted)'),
});

const ListBuildsSchema = z.object({
  definitionIds: z
    .array(z.number().int().positive())
    .optional()
    .describe('Filter by specific definition IDs'),
  statusFilter: z
    .enum(['inProgress', 'completed', 'cancelling', 'postponed', 'notStarted', 'all'])
    .optional()
    .describe('Filter by build status'),
  resultFilter: z
    .enum(['succeeded', 'partiallySucceeded', 'failed', 'canceled', 'none'])
    .optional()
    .describe('Filter by build result'),
  top: z.number().int().positive().max(100).optional().default(20).describe('Maximum builds to return'),
  branchName: z.string().optional().describe('Filter by source branch (e.g., $/MyProject/main)'),
  requestedFor: z.string().optional().describe('Filter by the user who requested the build'),
  minFinishTime: z.string().optional().describe('ISO 8601 date — only return builds finished after this time'),
  maxFinishTime: z.string().optional().describe('ISO 8601 date — only return builds finished before this time'),
});

const GetBuildSchema = z.object({
  buildId: z.number().int().positive().describe('Build ID'),
});

const QueueBuildSchema = z.object({
  definitionId: z.number().int().positive().describe('Build definition ID to queue'),
  sourceBranch: z
    .string()
    .optional()
    .describe('Source branch override (e.g., $/MyProject/branches/dev)'),
  sourceVersion: z.string().optional().describe('Specific changeset/shelveset to build'),
  parameters: z
    .record(z.string())
    .optional()
    .describe('Key-value build parameters to override'),
  priority: z
    .enum(['low', 'belowNormal', 'normal', 'aboveNormal', 'high'])
    .optional()
    .default('normal')
    .describe('Queue priority'),
});

const GetBuildLogsSchema = z.object({
  buildId: z.number().int().positive().describe('Build ID'),
  logId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Specific log entry ID. If omitted, lists available logs.'),
  startLine: z.number().int().nonnegative().optional().describe('First line to retrieve (0-based)'),
  endLine: z.number().int().positive().optional().describe('Last line to retrieve'),
});

const CancelBuildSchema = z.object({
  buildId: z.number().int().positive().describe('Build ID to cancel'),
});

const GetBuildArtifactsSchema = z.object({
  buildId: z.number().int().positive().describe('Build ID'),
});

const GetBuildTimelineSchema = z.object({
  buildId: z.number().int().positive().describe('Build ID'),
});

const GetBuildWorkItemsSchema = z.object({
  buildId: z.number().int().positive().describe('Build ID'),
  top: z.number().int().positive().max(100).optional().default(20)
    .describe('Maximum work items to return'),
});

const ListBuildQueuesSchema = z.object({
  name: z.string().optional().describe('Filter queues by name'),
});

// ─── Tool implementations ─────────────────────────────────────────────────────

async function listBuildDefinitions(
  args: z.infer<typeof ListBuildDefinitionsSchema>,
): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/definitions', '');

  const params: Record<string, unknown> = { $top: args.top };
  if (args.name) params.name = args.name;
  if (args.type && args.type !== 'all') params.type = args.type;

  const result = await client.get<TfsListResponse<BuildDefinitionRef>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getBuildDefinition(
  args: z.infer<typeof GetBuildDefinitionSchema>,
): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/definitions', String(args.definitionId));

  const params: Record<string, unknown> = {};
  if (args.revision) params.revision = args.revision;

  const definition = await client.get<BuildDefinition>(url, params);
  return JSON.stringify(definition, null, 2);
}

async function listBuilds(args: z.infer<typeof ListBuildsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/builds', '');

  const params: Record<string, unknown> = { $top: args.top };
  if (args.definitionIds?.length) params.definitions = args.definitionIds.join(',');
  if (args.statusFilter) params.statusFilter = args.statusFilter;
  if (args.resultFilter) params.resultFilter = args.resultFilter;
  if (args.branchName) params.branchName = args.branchName;
  if (args.requestedFor) params.requestedFor = args.requestedFor;
  if (args.minFinishTime) params.minFinishTime = args.minFinishTime;
  if (args.maxFinishTime) params.maxFinishTime = args.maxFinishTime;

  const result = await client.get<TfsListResponse<Build>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getBuild(args: z.infer<typeof GetBuildSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/builds', String(args.buildId));
  const build = await client.get<Build>(url);
  return JSON.stringify(build, null, 2);
}

async function queueBuild(args: z.infer<typeof QueueBuildSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/builds', '');

  const body: BuildQueueRequest = {
    definition: { id: args.definitionId },
    priority: args.priority,
  };
  if (args.sourceBranch) body.sourceBranch = args.sourceBranch;
  if (args.sourceVersion) body.sourceVersion = args.sourceVersion;
  if (args.parameters && Object.keys(args.parameters).length > 0) {
    body.parameters = JSON.stringify(args.parameters);
  }

  const build = await client.post<Build>(url, body);
  log.info(`Queued build #${build.id} from definition ${args.definitionId}`);
  return JSON.stringify(build, null, 2);
}

async function getBuildLogs(args: z.infer<typeof GetBuildLogsSchema>): Promise<string> {
  const client = getTfsClient();

  if (args.logId !== undefined) {
    // TFS returns plain text for log content — must request responseType: 'text'
    // to prevent Axios from auto-parsing as JSON
    const url = client.projectApiUrl('build/builds', args.buildId + '/logs/' + args.logId);
    const params: Record<string, unknown> = { $format: 'text' };
    if (args.startLine !== undefined) params.startLine = args.startLine;
    if (args.endLine !== undefined) params.endLine = args.endLine;
    const text = await client.get<string>(url, params);
    return typeof text === 'string' ? text : JSON.stringify(text, null, 2);
  }

  // List available log entries (returns JSON)
  const url = client.projectApiUrl('build/builds', args.buildId + '/logs');
  const result = await client.get<TfsListResponse<BuildLog>>(url);
  return JSON.stringify(result, null, 2);
}

async function cancelBuild(args: z.infer<typeof CancelBuildSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/builds', String(args.buildId));

  // TFS 2018 supports cancelling a build via JSON Patch — requires application/json-patch+json
  const patches = [{ op: 'replace', path: '/status', value: 'cancelling' }];
  const updated = await client.patch<Build>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });
  log.info('Cancelling build #' + args.buildId);
  return JSON.stringify(
    { message: 'Build #' + args.buildId + ' cancellation requested', status: updated.status },
    null,
    2,
  );
}

async function getBuildArtifacts(args: z.infer<typeof GetBuildArtifactsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/builds', args.buildId + '/artifacts');
  const result = await client.get<TfsListResponse<BuildArtifact>>(url);
  return JSON.stringify(result, null, 2);
}

async function getBuildTimeline(args: z.infer<typeof GetBuildTimelineSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/builds', args.buildId + '/timeline');
  const result = await client.get<BuildTimeline>(url);
  return JSON.stringify(result, null, 2);
}

async function getBuildWorkItems(args: z.infer<typeof GetBuildWorkItemsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('build/builds', args.buildId + '/workitems');
  const result = await client.get<TfsListResponse<{ id: number; url: string }>>(url, {
    $top: args.top,
  });
  return JSON.stringify(result, null, 2);
}

async function listBuildQueues(args: z.infer<typeof ListBuildQueuesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('distributedtask/queues', '');
  const params: Record<string, unknown> = {};
  params['api-version'] = '4.1-preview';
  if (args.name) params.name = args.name;
  const result = await client.get<TfsListResponse<BuildQueue>>(url, params);
  return JSON.stringify(result, null, 2);
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerBuildTools(server: McpServer): void {
  server.tool(
    'tfs_list_build_definitions',
    'Lists build definitions in the TFS project, optionally filtered by name.',
    ListBuildDefinitionsSchema.shape,
    async (args: z.infer<typeof ListBuildDefinitionsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listBuildDefinitions(args) }] };
      } catch (err) {
        log.error('tfs_list_build_definitions failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_build_definition',
    'Gets full details of a specific build definition, including steps, variables, and triggers.',
    GetBuildDefinitionSchema.shape,
    async (args: z.infer<typeof GetBuildDefinitionSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getBuildDefinition(args) }] };
      } catch (err) {
        log.error('tfs_get_build_definition failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_builds',
    'Lists builds in the project with rich filtering options (status, result, branch, definition, date range).',
    ListBuildsSchema.shape,
    async (args: z.infer<typeof ListBuildsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listBuilds(args) }] };
      } catch (err) {
        log.error('tfs_list_builds failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_build',
    'Gets complete details for a single build by ID, including status, result, timing, and source info.',
    GetBuildSchema.shape,
    async (args: z.infer<typeof GetBuildSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getBuild(args) }] };
      } catch (err) {
        log.error('tfs_get_build failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_queue_build',
    'Queues a new build from a build definition. Optionally override branch, source version, and parameters.',
    QueueBuildSchema.shape,
    async (args: z.infer<typeof QueueBuildSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await queueBuild(args) }] };
      } catch (err) {
        log.error('tfs_queue_build failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_build_logs',
    'Lists available build log files or fetches the content of a specific log file. Use without logId first to discover available logs.',
    GetBuildLogsSchema.shape,
    async (args: z.infer<typeof GetBuildLogsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getBuildLogs(args) }] };
      } catch (err) {
        log.error('tfs_get_build_logs failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_cancel_build',
    'Cancels an in-progress TFS build.',
    CancelBuildSchema.shape,
    async (args: z.infer<typeof CancelBuildSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await cancelBuild(args) }] };
      } catch (err) {
        log.error('tfs_cancel_build failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_build_artifacts',
    'Lists all artifacts produced by a build (binaries, packages, test results, drop folders, etc.) with their download URLs.',
    GetBuildArtifactsSchema.shape,
    async (args: z.infer<typeof GetBuildArtifactsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getBuildArtifacts(args) }] };
      } catch (err) {
        log.error('tfs_get_build_artifacts failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_build_timeline',
    'Returns the full execution timeline of a build: each step/task with its name, state, result, start/finish times, and any error messages.',
    GetBuildTimelineSchema.shape,
    async (args: z.infer<typeof GetBuildTimelineSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getBuildTimeline(args) }] };
      } catch (err) {
        log.error('tfs_get_build_timeline failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_build_work_items',
    'Lists work items (bugs, tasks, user stories) associated with a specific build.',
    GetBuildWorkItemsSchema.shape,
    async (args: z.infer<typeof GetBuildWorkItemsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getBuildWorkItems(args) }] };
      } catch (err) {
        log.error('tfs_get_build_work_items failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_build_queues',
    'Lists available build agent queues (pools) in the project. Useful to find queue IDs when queuing builds on a specific agent pool.',
    ListBuildQueuesSchema.shape,
    async (args: z.infer<typeof ListBuildQueuesSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listBuildQueues(args) }] };
      } catch (err) {
        log.error('tfs_list_build_queues failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );
}
