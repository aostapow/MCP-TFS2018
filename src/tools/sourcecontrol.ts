import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type {
  TfvcItem,
  TfvcChangeset,
  TfvcLabel,
  TfvcShelveset,
  TfvcBranch,
  TfsListResponse,
} from '../types/tfs.js';

const log = createChildLogger('tool:sourcecontrol');

// ─── Input schemas ────────────────────────────────────────────────────────────

const GetItemSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('TFVC server path (e.g. $/MyProject/Main/src/MyFile.cs)'),
  version: z
    .string()
    .optional()
    .describe('Version spec: C<n> for changeset, L<label>, T for latest, W for workspace'),
  includeContent: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include file content in the response (only for files, not folders)'),
});

const ListItemsSchema = z.object({
  scopePath: z
    .string()
    .min(1)
    .describe('TFVC server path to list (e.g. $/MyProject/Main/src)'),
  recursionLevel: z
    .enum([
      'none',
      'oneLevel',
      'full',
      'oneHundredLevels',
      'None',
      'OneLevel',
      'Full',
      'OneHundredLevels',
    ])
    .optional()
    .default('oneLevel')
    .describe('How deep to recurse into subfolders'),
  version: z.string().optional().describe('Version spec (default: latest)'),
  includeContentMetadata: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include content type metadata'),
});

function tfvcRecursionLevel(level: z.infer<typeof ListItemsSchema>['recursionLevel']): string {
  const map: Record<string, string> = {
    none: 'None',
    oneLevel: 'OneLevel',
    full: 'Full',
    oneHundredLevels: 'OneHundredLevels',
    None: 'None',
    OneLevel: 'OneLevel',
    Full: 'Full',
    OneHundredLevels: 'OneHundredLevels',
  };
  return map[level ?? 'oneLevel'];
}

const GetChangesetSchema = z.object({
  changesetId: z.number().int().positive().describe('Changeset ID'),
  includeDetails: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include policy details and checkin notes'),
  includeWorkItems: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include associated work items'),
  includeSourceRename: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include source rename information in changes'),
  maxChangeCount: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(100)
    .describe('Max number of changes to return (0 = all)'),
});

const ListChangesetsSchema = z.object({
  itemPath: z
    .string()
    .optional()
    .describe('Filter changesets touching this TFVC path'),
  author: z.string().optional().describe('Filter by author display name or email'),
  fromId: z.number().int().positive().optional().describe('Minimum changeset ID'),
  toId: z.number().int().positive().optional().describe('Maximum changeset ID'),
  fromDate: z.string().optional().describe('ISO 8601 start date filter'),
  toDate: z.string().optional().describe('ISO 8601 end date filter'),
  top: z.number().int().positive().max(100).optional().default(20).describe('Max results'),
  skip: z.number().int().nonnegative().optional().default(0).describe('Results to skip'),
  searchCriteria: z
    .object({
      comment: z.string().optional().describe('Filter by comment text'),
    })
    .optional(),
});

const GetLabelSchema = z.object({
  labelId: z.number().int().positive().describe('Label ID'),
  top: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .default(100)
    .describe('Max labeled items to return'),
  skip: z.number().int().nonnegative().optional().default(0),
});

const ListLabelsSchema = z.object({
  name: z.string().optional().describe('Filter labels by name (supports wildcards)'),
  owner: z.string().optional().describe('Filter labels by owner'),
  top: z.number().int().positive().max(100).optional().default(20),
  skip: z.number().int().nonnegative().optional().default(0),
});

const ListShelvesetSchema = z.object({
  owner: z
    .string()
    .optional()
    .describe('Filter by owner (defaults to authenticated user if omitted)'),
  top: z.number().int().positive().max(100).optional().default(20),
  skip: z.number().int().nonnegative().optional().default(0),
  includeDetails: z.boolean().optional().default(false),
  includeWorkItems: z.boolean().optional().default(true),
});

const GetShelvesetSchema = z.object({
  shelvesetId: z.string().min(1).describe('Shelveset name;owner format, e.g. "MyShelveset;DOMAIN\\user"'),
  includeDetails: z.boolean().optional().default(false),
  includeWorkItems: z.boolean().optional().default(true),
  maxChangeCount: z.number().int().nonnegative().optional().default(50),
});

const ListBranchesSchema = z.object({
  scopePath: z.string().optional().describe('Root path to start from (default: $/). E.g. $/MyProject'),
  includeDeleted: z.boolean().optional().default(false),
  includeLinks: z.boolean().optional().default(false),
});

const GetFileContentSchema = z.object({
  path: z.string().min(1).describe('TFVC server path to the file (e.g. $/MyProject/Main/src/MyFile.cs)'),
  version: z.string().optional()
    .describe('Version spec: C<n> for changeset, T for latest (default), L<label>'),
});

// ─── Tool implementations ─────────────────────────────────────────────────────

async function getItem(args: z.infer<typeof GetItemSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('items');

  const params: Record<string, unknown> = {
    path: args.path,
    includeContent: args.includeContent,
  };
  if (args.version) params['versionDescriptor.version'] = args.version;

  const item = await client.get<TfvcItem>(url, params);
  return JSON.stringify(item, null, 2);
}

async function listItems(args: z.infer<typeof ListItemsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('items');

  const params: Record<string, unknown> = {
    scopePath: args.scopePath,
    recursionLevel: tfvcRecursionLevel(args.recursionLevel),
    includeContentMetadata: args.includeContentMetadata,
  };
  if (args.version) params['versionDescriptor.version'] = args.version;

  const result = await client.get<TfsListResponse<TfvcItem>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getChangeset(args: z.infer<typeof GetChangesetSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl(`changesets/${args.changesetId}`);

  const params: Record<string, unknown> = {
    includeDetails: args.includeDetails,
    includeWorkItems: args.includeWorkItems,
    includeSourceRename: args.includeSourceRename,
  };
  if (args.maxChangeCount) params.maxChangeCount = args.maxChangeCount;

  const changeset = await client.get<TfvcChangeset>(url, params);
  return JSON.stringify(changeset, null, 2);
}

async function listChangesets(args: z.infer<typeof ListChangesetsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('changesets');

  const params: Record<string, unknown> = {
    $top: args.top,
    $skip: args.skip,
  };
  if (args.itemPath) params['searchCriteria.itemPath'] = args.itemPath;
  if (args.author) params['searchCriteria.author'] = args.author;
  if (args.fromId) params['searchCriteria.fromId'] = args.fromId;
  if (args.toId) params['searchCriteria.toId'] = args.toId;
  if (args.fromDate) params['searchCriteria.fromDate'] = args.fromDate;
  if (args.toDate) params['searchCriteria.toDate'] = args.toDate;
  if (args.searchCriteria?.comment)
    params['searchCriteria.comment'] = args.searchCriteria.comment;

  const result = await client.get<TfsListResponse<TfvcChangeset>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getLabel(args: z.infer<typeof GetLabelSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl(`labels/${args.labelId}`);
  const label = await client.get<TfvcLabel>(url, { $top: args.top, $skip: args.skip });
  return JSON.stringify(label, null, 2);
}

async function listLabels(args: z.infer<typeof ListLabelsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('labels');

  const params: Record<string, unknown> = { $top: args.top, $skip: args.skip };
  if (args.name) params['requestData.name'] = args.name;
  if (args.owner) params['requestData.owner'] = args.owner;

  const result = await client.get<TfsListResponse<TfvcLabel>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function listShelvesets(args: z.infer<typeof ListShelvesetSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('shelvesets');

  const params: Record<string, unknown> = {
    $top: args.top,
    $skip: args.skip,
    includeDetails: args.includeDetails,
    includeWorkItems: args.includeWorkItems,
  };
  if (args.owner) params.owner = args.owner;

  const result = await client.get<TfsListResponse<TfvcShelveset>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getShelveset(args: z.infer<typeof GetShelvesetSchema>): Promise<string> {
  const client = getTfsClient();
  // TFS 2018: individual shelveset endpoint uses shelvesetId as query param on the base url
  // Format: GET /_apis/tfvc/shelvesets?shelvesetId={name};{owner}
  // Returns a single TfvcShelveset (not a list) when shelvesetId is specified
  const url = client.tfvcApiUrl('shelvesets');
  const params: Record<string, unknown> = {
    shelvesetId: args.shelvesetId,
    $expand: [
      args.includeDetails ? 'details' : '',
      args.includeWorkItems ? 'workItems' : '',
      args.maxChangeCount > 0 ? 'changes' : '',
    ].filter(Boolean).join(',') || undefined,
    maxChangeCount: args.maxChangeCount,
  };
  const shelveset = await client.get<TfvcShelveset>(url, params);
  return JSON.stringify(shelveset, null, 2);
}

async function listBranches(args: z.infer<typeof ListBranchesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('branches');

  const params: Record<string, unknown> = {
    includeDeleted: args.includeDeleted,
    includeLinks: args.includeLinks,
  };
  if (args.scopePath) params.scopePath = args.scopePath;

  const result = await client.get<TfvcBranch[]>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getFileContent(args: z.infer<typeof GetFileContentSchema>): Promise<string> {
  const client = getTfsClient();
  // Request raw content via $format=text so Axios receives plain text
  const url = client.tfvcApiUrl('items');
  const params: Record<string, unknown> = {
    path: args.path,
    $format: 'text',
  };
  if (args.version) params['versionDescriptor.version'] = args.version;
  // The API returns raw file content as text/plain
  const content = await client.get<string>(url, params);
  return typeof content === 'string' ? content : JSON.stringify(content);
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerSourceControlTools(server: McpServer): void {
  server.tool(
    'tfs_get_item',
    'Gets metadata (or content) for a single file or folder in TFVC by its server path.',
    GetItemSchema.shape,
    async (args: z.infer<typeof GetItemSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getItem(args) }] };
      } catch (err) {
        log.error('tfs_get_item failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_items',
    'Lists files and folders in TFVC under a given server path, with configurable recursion depth.',
    ListItemsSchema.shape,
    async (args: z.infer<typeof ListItemsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listItems(args) }] };
      } catch (err) {
        log.error('tfs_list_items failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_changeset',
    'Gets full details of a TFVC changeset by ID, including changes, work items, and author information.',
    GetChangesetSchema.shape,
    async (args: z.infer<typeof GetChangesetSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getChangeset(args) }] };
      } catch (err) {
        log.error('tfs_get_changeset failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_changesets',
    'Lists TFVC changesets with rich filters: by path, author, date range, ID range, or comment text.',
    ListChangesetsSchema.shape,
    async (args: z.infer<typeof ListChangesetsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listChangesets(args) }] };
      } catch (err) {
        log.error('tfs_list_changesets failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_label',
    'Gets details and labeled items for a specific TFVC label.',
    GetLabelSchema.shape,
    async (args: z.infer<typeof GetLabelSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getLabel(args) }] };
      } catch (err) {
        log.error('tfs_get_label failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_labels',
    'Lists TFVC labels, optionally filtered by name or owner.',
    ListLabelsSchema.shape,
    async (args: z.infer<typeof ListLabelsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listLabels(args) }] };
      } catch (err) {
        log.error('tfs_list_labels failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_shelvesets',
    'Lists TFVC shelvesets, optionally filtered by owner. Returns pending shelveset names and metadata.',
    ListShelvesetSchema.shape,
    async (args: z.infer<typeof ListShelvesetSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listShelvesets(args) }] };
      } catch (err) {
        log.error('tfs_list_shelvesets failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_shelveset',
    'Gets detailed information about a specific TFVC shelveset, including its pending changes and associated work items.',
    GetShelvesetSchema.shape,
    async (args: z.infer<typeof GetShelvesetSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getShelveset(args) }] };
      } catch (err) {
        log.error('tfs_get_shelveset failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_branches',
    'Lists TFVC branches in the repository, optionally scoped to a root path.',
    ListBranchesSchema.shape,
    async (args: z.infer<typeof ListBranchesSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listBranches(args) }] };
      } catch (err) {
        log.error('tfs_list_branches failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_file_content',
    'Retrieves the raw text content of a specific file in TFVC. Returns the file as plain text, not metadata. Ideal for reading source code, configs, or scripts directly.',
    GetFileContentSchema.shape,
    async (args: z.infer<typeof GetFileContentSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getFileContent(args) }] };
      } catch (err) {
        log.error('tfs_get_file_content failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );
}
