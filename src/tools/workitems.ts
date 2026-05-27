import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type {
  WorkItem,
  WorkItemPatch,
  WorkItemQueryResult,
  WorkItemHistoryEntry,
  WorkItemTypeDefinition,
  WorkItemFieldDefinition,
  SavedQuery,
  TfsListResponse,
} from '../types/tfs.js';

const log = createChildLogger('tool:workitems');

// ─── Input schemas ────────────────────────────────────────────────────────────

const GetWorkItemSchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  expand: z
    .enum(['all', 'fields', 'links', 'none', 'relations'])
    .optional()
    .default('all')
    .describe('Fields to expand in the response'),
});

const QueryWorkItemsSchema = z.object({
  wiql: z
    .string()
    .min(1)
    .describe(
      'WIQL query string. Example: "SELECT [System.Id],[System.Title] FROM WorkItems WHERE [System.WorkItemType]=\'Bug\' AND [System.State]=\'Active\' ORDER BY [System.ChangedDate] DESC"',
    ),
  top: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .default(50)
    .describe('Maximum number of results to return'),
});

const WorkItemFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const CreateWorkItemSchema = z.object({
  type: z
    .string()
    .min(1)
    .describe('Work item type: Bug, Task, User Story, Feature, Epic, etc.'),
  title: z.string().min(1).describe('Title of the work item'),
  description: z.string().optional().describe('HTML description'),
  assignedTo: z
    .string()
    .optional()
    .describe('User display name or email to assign the work item to'),
  areaPath: z.string().optional().describe('Area path (defaults to project root)'),
  iterationPath: z.string().optional().describe('Iteration/sprint path'),
  tags: z.string().optional().describe('Semicolon-separated tags'),
  priority: z.number().int().min(1).max(4).optional().describe('Priority 1–4'),
  storyPoints: z.number().positive().optional().describe('Story points / effort'),
  fields: z
    .record(WorkItemFieldValueSchema)
    .optional()
    .describe(
      'Additional work item fields by reference name. Example: {"Microsoft.VSTS.Common.Severity":"4","Accusys.Modulo":"CARTERA"}',
    ),
  parentId: z.number().int().positive().optional().describe('Parent work item ID'),
});

const UpdateWorkItemSchema = z.object({
  id: z.number().int().positive().describe('Work item ID to update'),
  title: z.string().optional().describe('New title'),
  state: z.string().optional().describe('New state (Active, Resolved, Closed, etc.)'),
  assignedTo: z.string().optional().describe('Reassign to this user'),
  description: z.string().optional().describe('New HTML description'),
  areaPath: z.string().optional().describe('New area path'),
  iterationPath: z.string().optional().describe('New iteration path'),
  tags: z.string().optional().describe('New semicolon-separated tags'),
  priority: z.number().int().min(1).max(4).optional().describe('New priority'),
  storyPoints: z.number().positive().optional().describe('New story points'),
  fields: z
    .record(WorkItemFieldValueSchema)
    .optional()
    .describe('Additional fields to update by reference name'),
  comment: z.string().optional().describe('Comment to add to the history'),
});

const AddCommentSchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  comment: z.string().min(1).describe('Comment text (HTML supported)'),
});

const GetWorkItemsSchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(200)
    .describe('Array of work item IDs to fetch (max 200)'),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      'Specific field reference names to return, e.g. ["System.Id","System.Title"]',
    ),
});

const GetWorkItemHistorySchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  top: z.number().int().positive().max(200).optional().default(50).describe('Maximum revisions to return'),
  skip: z.number().int().nonnegative().optional().default(0).describe('Revisions to skip'),
});

const AddWorkItemLinkSchema = z.object({
  sourceId: z.number().int().positive().describe('ID of the source work item'),
  targetId: z.number().int().positive().describe('ID of the target work item'),
  linkType: z.enum([
    'System.LinkTypes.Hierarchy-Forward',
    'System.LinkTypes.Hierarchy-Reverse',
    'System.LinkTypes.Related',
    'System.LinkTypes.Duplicate-Forward',
    'System.LinkTypes.Duplicate-Reverse',
    'System.LinkTypes.Dependency-Forward',
    'System.LinkTypes.Dependency-Reverse',
  ]).describe(
    'Link type. Hierarchy-Forward = parent->child. Hierarchy-Reverse = child->parent. Related = bidirectional.',
  ),
  comment: z.string().optional().describe('Optional comment for the link'),
});

const RemoveWorkItemLinkSchema = z.object({
  workItemId: z.number().int().positive().describe('Work item ID to modify'),
  relationIndex: z.number().int().nonnegative().describe(
    'Zero-based index of the relation to remove. Use tfs_get_work_item with expand=relations to find the index.',
  ),
});

const ListWorkItemTypesSchema = z.object({
  includeFields: z.boolean().optional().default(false)
    .describe('Include field definitions for each type (slower)'),
});

const GetWorkItemTypeSchema = z.object({
  typeName: z.string().min(1).describe('Work item type name, e.g. "Bug", "Task", "User Story"'),
});

const ListWorkItemFieldsSchema = z.object({
  filter: z.string().optional().describe('Optional text filter on field name or reference name'),
});

const GetSavedQueriesSchema = z.object({
  folder: z.string().optional().describe('Folder path to list (e.g. "My Queries", "Shared Queries")'),
  depth: z.number().int().min(0).max(5).optional().default(2)
    .describe('How many levels of subfolders to expand'),
});

const RunSavedQuerySchema = z.object({
  queryId: z.string().uuid().describe('Saved query ID (GUID). Use tfs_get_saved_queries to find IDs.'),
  top: z.number().int().positive().max(200).optional().default(50).describe('Maximum results'),
});

// ─── Tool implementations ─────────────────────────────────────────────────────

type WorkItemFieldValue = z.infer<typeof WorkItemFieldValueSchema>;

function fieldPath(referenceName: string): string {
  return '/fields/' + referenceName.replace(/~/g, '~0').replace(/\//g, '~1');
}

function addFieldPatch(
  patches: WorkItemPatch[],
  referenceName: string,
  value: WorkItemFieldValue,
): void {
  const path = fieldPath(referenceName);
  const existing = patches.find((patch) => patch.path === path);
  if (existing) {
    existing.value = value;
    return;
  }
  patches.push({ op: 'add', path, value });
}

async function getWorkItem(args: z.infer<typeof GetWorkItemSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', String(args.id));
  const item = await client.get<WorkItem>(url, { $expand: args.expand });
  return JSON.stringify(item, null, 2);
}

async function getWorkItems(args: z.infer<typeof GetWorkItemsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', '');
  const params: Record<string, unknown> = { ids: args.ids.join(',') };
  if (args.fields) params.fields = args.fields.join(',');
  const result = await client.get<TfsListResponse<WorkItem>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function queryWorkItems(args: z.infer<typeof QueryWorkItemsSchema>): Promise<string> {
  const client = getTfsClient();
  const wiqlUrl = client.projectApiUrl('wit/wiql', '');

  // 1. Run WIQL to get IDs
  const queryResult = await client.post<WorkItemQueryResult>(
    wiqlUrl,
    { query: args.wiql },
    { $top: args.top },
  );

  if (!queryResult.workItems || queryResult.workItems.length === 0) {
    return JSON.stringify({ count: 0, workItems: [] }, null, 2);
  }

  // 2. Fetch full details for returned IDs
  const ids = queryResult.workItems.slice(0, args.top).map((wi) => wi.id);
  const detailUrl = client.collectionApiUrl('wit/workitems', '');
  const details = await client.get<TfsListResponse<WorkItem>>(detailUrl, {
    ids: ids.join(','),
    $expand: 'fields',
  });

  return JSON.stringify({ count: details.count, workItems: details.value }, null, 2);
}

async function createWorkItem(args: z.infer<typeof CreateWorkItemSchema>): Promise<string> {
  const client = getTfsClient();
  const encodedType = encodeURIComponent(args.type);
  const url = client.projectApiUrl('wit/workitems', `$${encodedType}`);

  const patches: WorkItemPatch[] = [
    { op: 'add', path: '/fields/System.Title', value: args.title },
  ];

  if (args.description)
    patches.push({ op: 'add', path: '/fields/System.Description', value: args.description });
  if (args.assignedTo)
    patches.push({ op: 'add', path: '/fields/System.AssignedTo', value: args.assignedTo });
  if (args.areaPath)
    patches.push({ op: 'add', path: '/fields/System.AreaPath', value: args.areaPath });
  if (args.iterationPath)
    patches.push({ op: 'add', path: '/fields/System.IterationPath', value: args.iterationPath });
  if (args.tags)
    patches.push({ op: 'add', path: '/fields/System.Tags', value: args.tags });
  if (args.priority !== undefined)
    patches.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: args.priority });
  if (args.storyPoints !== undefined)
    patches.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints',
      value: args.storyPoints,
    });
  if (args.fields) {
    for (const [referenceName, value] of Object.entries(args.fields)) {
      addFieldPatch(patches, referenceName, value);
    }
  }
  if (args.parentId) {
    const parentUrl = client.collectionApiUrl('wit/workitems', String(args.parentId));
    patches.push({
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: parentUrl,
        attributes: { comment: 'Set parent' },
      },
    });
  }

  const created = await client.patch<WorkItem>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });

  log.info(`Created work item #${created.id} (${args.type}): ${args.title}`);
  return JSON.stringify(created, null, 2);
}

async function updateWorkItem(args: z.infer<typeof UpdateWorkItemSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', String(args.id));

  const patches: WorkItemPatch[] = [];

  // TFS JSON Patch: use 'add' for all fields — it creates if absent, replaces if present.
  // 'replace' on a non-existent field returns 400, so 'add' is always safer.
  if (args.title)       patches.push({ op: 'add', path: '/fields/System.Title', value: args.title });
  if (args.state)       patches.push({ op: 'add', path: '/fields/System.State', value: args.state });
  if (args.assignedTo)  patches.push({ op: 'add', path: '/fields/System.AssignedTo', value: args.assignedTo });
  if (args.description) patches.push({ op: 'add', path: '/fields/System.Description', value: args.description });
  if (args.areaPath)    patches.push({ op: 'add', path: '/fields/System.AreaPath', value: args.areaPath });
  if (args.iterationPath) patches.push({ op: 'add', path: '/fields/System.IterationPath', value: args.iterationPath });
  if (args.tags)        patches.push({ op: 'add', path: '/fields/System.Tags', value: args.tags });
  if (args.priority !== undefined)
    patches.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: args.priority });
  if (args.storyPoints !== undefined)
    patches.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: args.storyPoints });
  if (args.fields) {
    for (const [referenceName, value] of Object.entries(args.fields)) {
      addFieldPatch(patches, referenceName, value);
    }
  }
  if (args.comment)
    patches.push({ op: 'add', path: '/fields/System.History', value: args.comment });

  if (patches.length === 0) {
    return JSON.stringify({ message: 'No fields to update were provided.' });
  }

  const updated = await client.patch<WorkItem>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });

  log.info(`Updated work item #${args.id}`);
  return JSON.stringify(updated, null, 2);
}

async function addComment(args: z.infer<typeof AddCommentSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', String(args.id));

  const patches: WorkItemPatch[] = [
    { op: 'add', path: '/fields/System.History', value: args.comment },
  ];

  const updated = await client.patch<WorkItem>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });

  log.info(`Added comment to work item #${args.id}`);
  return JSON.stringify(
    { message: `Comment added to work item #${args.id}`, rev: updated.rev },
    null,
    2,
  );
}

async function getWorkItemHistory(args: z.infer<typeof GetWorkItemHistorySchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', args.id + '/updates');
  const result = await client.get<TfsListResponse<WorkItemHistoryEntry>>(url, {
    $top: args.top,
    $skip: args.skip,
  });
  return JSON.stringify(result, null, 2);
}

async function addWorkItemLink(args: z.infer<typeof AddWorkItemLinkSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', String(args.sourceId));
  const targetUrl = client.collectionApiUrl('wit/workitems', String(args.targetId));

  const patches: WorkItemPatch[] = [
    {
      op: 'add',
      path: '/relations/-',
      value: {
        rel: args.linkType,
        url: targetUrl,
        attributes: { comment: args.comment ?? '' },
      },
    },
  ];

  const updated = await client.patch<WorkItem>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });
  log.info('Link added: #' + args.sourceId + ' -> #' + args.targetId + ' (' + args.linkType + ')');
  return JSON.stringify(
    { message: 'Link added successfully', sourceId: args.sourceId, targetId: args.targetId, rev: updated.rev },
    null, 2,
  );
}

async function removeWorkItemLink(args: z.infer<typeof RemoveWorkItemLinkSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', String(args.workItemId));

  const patches: WorkItemPatch[] = [
    { op: 'remove', path: '/relations/' + args.relationIndex },
  ];

  const updated = await client.patch<WorkItem>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });
  log.info('Relation #' + args.relationIndex + ' removed from work item #' + args.workItemId);
  return JSON.stringify(
    { message: 'Link removed successfully', workItemId: args.workItemId, rev: updated.rev },
    null, 2,
  );
}

async function listWorkItemTypes(args: z.infer<typeof ListWorkItemTypesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/workitemtypes', '');
  const params: Record<string, unknown> = {};
  if (args.includeFields) params.$expand = 'fields';
  const result = await client.get<TfsListResponse<WorkItemTypeDefinition>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getWorkItemType(args: z.infer<typeof GetWorkItemTypeSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/workitemtypes', encodeURIComponent(args.typeName));
  const result = await client.get<WorkItemTypeDefinition>(url, { $expand: 'fields' });
  return JSON.stringify(result, null, 2);
}

async function listWorkItemFields(args: z.infer<typeof ListWorkItemFieldsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/fields', '');
  const result = await client.get<TfsListResponse<WorkItemFieldDefinition>>(url);
  let fields = result.value ?? [];
  if (args.filter) {
    const f = args.filter.toLowerCase();
    fields = fields.filter(
      (field) => field.name.toLowerCase().includes(f) || field.referenceName.toLowerCase().includes(f),
    );
  }
  return JSON.stringify({ count: fields.length, value: fields }, null, 2);
}

async function getSavedQueries(args: z.infer<typeof GetSavedQueriesSchema>): Promise<string> {
  const client = getTfsClient();
  const basePath = args.folder ? encodeURIComponent(args.folder) : '';
  const url = client.projectApiUrl('wit/queries', basePath);
  const result = await client.get<SavedQuery>(url, { $depth: args.depth, $expand: 'all' });
  return JSON.stringify(result, null, 2);
}

async function runSavedQuery(args: z.infer<typeof RunSavedQuerySchema>): Promise<string> {
  const client = getTfsClient();
  const wiqlUrl = client.projectApiUrl('wit/wiql', args.queryId);
  const queryResult = await client.get<WorkItemQueryResult>(wiqlUrl, { $top: args.top });

  if (!queryResult.workItems || queryResult.workItems.length === 0) {
    return JSON.stringify({ count: 0, workItems: [] }, null, 2);
  }

  const ids = queryResult.workItems.slice(0, args.top).map((wi) => wi.id);
  const detailUrl = client.collectionApiUrl('wit/workitems', '');
  const details = await client.get<TfsListResponse<WorkItem>>(detailUrl, {
    ids: ids.join(','),
    $expand: 'fields',
  });

  return JSON.stringify({ count: details.count, workItems: details.value }, null, 2);
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerWorkItemTools(server: McpServer): void {
  server.tool(
    'tfs_get_work_item',
    'Retrieves a single TFS work item by its numeric ID, including all fields and relations.',
    GetWorkItemSchema.shape,
    async (args: z.infer<typeof GetWorkItemSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getWorkItem(args) }] };
      } catch (err) {
        log.error('tfs_get_work_item failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_work_items',
    'Retrieves multiple TFS work items by their IDs in a single request (max 200).',
    GetWorkItemsSchema.shape,
    async (args: z.infer<typeof GetWorkItemsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getWorkItems(args) }] };
      } catch (err) {
        log.error('tfs_get_work_items failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_query_work_items',
    'Executes a WIQL (Work Item Query Language) query against TFS and returns matching work items with their full fields.',
    QueryWorkItemsSchema.shape,
    async (args: z.infer<typeof QueryWorkItemsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await queryWorkItems(args) }] };
      } catch (err) {
        log.error('tfs_query_work_items failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_create_work_item',
    'Creates a new TFS work item of the specified type (Bug, Task, User Story, Feature, etc.) with the provided fields.',
    CreateWorkItemSchema.shape,
    async (args: z.infer<typeof CreateWorkItemSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await createWorkItem(args) }] };
      } catch (err) {
        log.error('tfs_create_work_item failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_update_work_item',
    'Updates fields on an existing TFS work item. Only provide fields you want to change.',
    UpdateWorkItemSchema.shape,
    async (args: z.infer<typeof UpdateWorkItemSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await updateWorkItem(args) }] };
      } catch (err) {
        log.error('tfs_update_work_item failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_add_work_item_comment',
    'Adds a comment (history entry) to an existing TFS work item.',
    AddCommentSchema.shape,
    async (args: z.infer<typeof AddCommentSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await addComment(args) }] };
      } catch (err) {
        log.error('tfs_add_work_item_comment failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_work_item_history',
    'Returns the full revision history of a work item, showing what fields changed in each revision and who made the changes.',
    GetWorkItemHistorySchema.shape,
    async (args: z.infer<typeof GetWorkItemHistorySchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getWorkItemHistory(args) }] };
      } catch (err) {
        log.error('tfs_get_work_item_history failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_add_work_item_link',
    'Adds a link (relation) between two work items. Supports parent/child hierarchy, related, duplicate, and dependency link types.',
    AddWorkItemLinkSchema.shape,
    async (args: z.infer<typeof AddWorkItemLinkSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await addWorkItemLink(args) }] };
      } catch (err) {
        log.error('tfs_add_work_item_link failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_remove_work_item_link',
    'Removes a specific relation/link from a work item by its zero-based index in the relations array. Use tfs_get_work_item with expand=relations first to identify the index.',
    RemoveWorkItemLinkSchema.shape,
    async (args: z.infer<typeof RemoveWorkItemLinkSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await removeWorkItemLink(args) }] };
      } catch (err) {
        log.error('tfs_remove_work_item_link failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_work_item_types',
    'Lists all work item types available in the project (Bug, Task, User Story, Feature, etc.) with their descriptions.',
    ListWorkItemTypesSchema.shape,
    async (args: z.infer<typeof ListWorkItemTypesSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listWorkItemTypes(args) }] };
      } catch (err) {
        log.error('tfs_list_work_item_types failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_work_item_type',
    'Gets the definition of a specific work item type including all its fields, required fields, and valid state transitions.',
    GetWorkItemTypeSchema.shape,
    async (args: z.infer<typeof GetWorkItemTypeSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getWorkItemType(args) }] };
      } catch (err) {
        log.error('tfs_get_work_item_type failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_work_item_fields',
    'Lists all available work item fields in the collection with their reference names and types. Optionally filter by name.',
    ListWorkItemFieldsSchema.shape,
    async (args: z.infer<typeof ListWorkItemFieldsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listWorkItemFields(args) }] };
      } catch (err) {
        log.error('tfs_list_work_item_fields failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_saved_queries',
    'Lists saved WIQL queries in the project, organized by folder. Returns IDs that can be used with tfs_run_saved_query.',
    GetSavedQueriesSchema.shape,
    async (args: z.infer<typeof GetSavedQueriesSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getSavedQueries(args) }] };
      } catch (err) {
        log.error('tfs_get_saved_queries failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_run_saved_query',
    'Executes a previously saved WIQL query by its ID and returns the matching work items with full field details.',
    RunSavedQuerySchema.shape,
    async (args: z.infer<typeof RunSavedQuerySchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await runSavedQuery(args) }] };
      } catch (err) {
        log.error('tfs_run_saved_query failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );
}
