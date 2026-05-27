import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfvcBranch, TfvcChange, TfvcItem, TfvcLabel, TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:sourcecontrol-advanced');

const ChangesetIdSchema = z.object({
  changesetId: z.number().int().positive().describe('TFVC changeset ID'),
});

const ChangesetDetailsSchema = ChangesetIdSchema.extend({
  includeDetails: z.boolean().optional().default(true),
  includeWorkItems: z.boolean().optional().default(true),
  includeSourceRename: z.boolean().optional().default(false),
  maxChangeCount: z.number().int().nonnegative().optional().default(1000),
});

const ChangesetChangesSchema = ChangesetIdSchema.extend({
  top: z.number().int().positive().max(1000).optional().default(100),
  skip: z.number().int().nonnegative().optional().default(0),
});

const BranchSchema = z.object({
  path: z.string().min(1).describe('TFVC branch path, e.g. $/Project/Main'),
  includeChildren: z.boolean().optional().default(false),
  includeDeleted: z.boolean().optional().default(false),
});

const ItemBatchSchema = z.object({
  itemDescriptors: z.array(z.record(z.unknown())).min(1)
    .describe('TFVC item descriptor objects expected by TFS'),
  includeContentMetadata: z.boolean().optional().default(true),
  includeLinks: z.boolean().optional().default(false),
});

const GetBinaryContentSchema = z.object({
  path: z.string().min(1).describe('TFVC server path to a file'),
  version: z.string().optional().describe('Version spec, e.g. C1234, Llabel, T'),
  asText: z.boolean().optional().default(false).describe('Return bytes as UTF-8 text instead of base64'),
});

const LabelBodySchema = z.object({
  label: z.record(z.unknown()).describe('Full TFVC label JSON body expected by TFS'),
});

const LabelIdSchema = z.object({
  labelId: z.number().int().positive().describe('TFVC label ID'),
});

const UpdateLabelSchema = LabelIdSchema.extend({
  label: z.record(z.unknown()).describe('Full or partial TFVC label JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a TFVC label'),
});

const DeleteLabelSchema = LabelIdSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a TFVC label'),
});

const ShelvesetDeleteSchema = z.object({
  shelvesetId: z.string().min(1).describe('Shelveset name;owner format, e.g. MyShelveset;DOMAIN\\user'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a shelveset'),
});

async function getChangesetChanges(args: z.infer<typeof ChangesetChangesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('changesets/' + args.changesetId + '/changes');
  const result = await client.get<TfsListResponse<TfvcChange>>(url, {
    $top: args.top,
    $skip: args.skip,
  });
  return JSON.stringify(result, null, 2);
}

async function getChangesetWorkItems(args: z.infer<typeof ChangesetIdSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('changesets/' + args.changesetId + '/workitems');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function getChangesetPolicyDetails(args: z.infer<typeof ChangesetDetailsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('changesets/' + args.changesetId);
  const result = await client.get<unknown>(url, {
    includeDetails: args.includeDetails,
    includeWorkItems: args.includeWorkItems,
    includeSourceRename: args.includeSourceRename,
    maxChangeCount: args.maxChangeCount,
  });
  return JSON.stringify(result, null, 2);
}

async function getBranch(args: z.infer<typeof BranchSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('branches');
  const result = await client.get<TfvcBranch[]>(url, {
    scopePath: args.path,
    includeChildren: args.includeChildren,
    includeDeleted: args.includeDeleted,
    includeLinks: true,
  });
  return JSON.stringify(result, null, 2);
}

async function getItemBatch(args: z.infer<typeof ItemBatchSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('itembatch');
  const result = await client.post<TfsListResponse<TfvcItem>>(url, {
    itemDescriptors: args.itemDescriptors,
    includeContentMetadata: args.includeContentMetadata,
    includeLinks: args.includeLinks,
  });
  return JSON.stringify(result, null, 2);
}

async function getItemsBatch(args: z.infer<typeof ItemBatchSchema>): Promise<string> {
  return getItemBatch(args);
}

async function getFileContentBinary(args: z.infer<typeof GetBinaryContentSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('items');
  const params: Record<string, unknown> = {
    path: args.path,
    $format: 'octetStream',
  };
  if (args.version) params['versionDescriptor.version'] = args.version;
  const bytes = await client.getRaw(url, params);
  return JSON.stringify({
    path: args.path,
    version: args.version,
    encoding: args.asText ? 'utf8' : 'base64',
    content: args.asText ? bytes.toString('utf8') : bytes.toString('base64'),
  }, null, 2);
}

async function createLabel(args: z.infer<typeof LabelBodySchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.tfvcApiUrl('labels');
  const result = await client.post<TfvcLabel>(url, args.label);
  log.info('Created TFVC label');
  return JSON.stringify(result, null, 2);
}

async function updateLabel(args: z.infer<typeof UpdateLabelSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a TFVC label.');
  const client = getTfsClient();
  const url = client.tfvcApiUrl('labels/' + args.labelId);
  const result = await client.put<TfvcLabel>(url, args.label);
  log.info('Updated TFVC label #' + args.labelId);
  return JSON.stringify(result, null, 2);
}

async function deleteLabel(args: z.infer<typeof DeleteLabelSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a TFVC label.');
  const client = getTfsClient();
  const url = client.tfvcApiUrl('labels/' + args.labelId);
  const result = await client.delete<unknown>(url);
  log.info('Deleted TFVC label #' + args.labelId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function deleteShelveset(args: z.infer<typeof ShelvesetDeleteSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a TFVC shelveset.');
  const client = getTfsClient();
  const url = client.tfvcApiUrl('shelvesets');
  const result = await client.delete<unknown>(url, { shelvesetId: args.shelvesetId });
  log.info('Deleted TFVC shelveset ' + args.shelvesetId);
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

export function registerAdvancedSourceControlTools(server: McpServer): void {
  registerTool(server, 'tfs_get_tfvc_changeset_changes', 'Lists changes contained in a TFVC changeset.', ChangesetChangesSchema, getChangesetChanges);
  registerTool(server, 'tfs_get_tfvc_changeset_work_items', 'Lists work items associated with a TFVC changeset.', ChangesetIdSchema, getChangesetWorkItems);
  registerTool(server, 'tfs_get_tfvc_changeset_policy_details', 'Gets TFVC changeset details including policy/check-in data when available.', ChangesetDetailsSchema, getChangesetPolicyDetails);
  registerTool(server, 'tfs_get_tfvc_branch', 'Gets TFVC branch information for a branch path.', BranchSchema, getBranch);
  registerTool(server, 'tfs_get_tfvc_item_batch', 'Gets TFVC items using TFS itembatch descriptors.', ItemBatchSchema, getItemBatch);
  registerTool(server, 'tfs_get_tfvc_items_batch', 'Gets multiple TFVC items using TFS itembatch descriptors.', ItemBatchSchema, getItemsBatch);
  registerTool(server, 'tfs_get_tfvc_file_content_binary', 'Downloads TFVC file content as base64 or UTF-8 text.', GetBinaryContentSchema, getFileContentBinary);
  registerTool(server, 'tfs_create_tfvc_label', 'Creates a TFVC label from a full TFS JSON body.', LabelBodySchema, createLabel);
  registerTool(server, 'tfs_update_tfvc_label', 'Updates a TFVC label. Requires confirmUpdate.', UpdateLabelSchema, updateLabel);
  registerTool(server, 'tfs_delete_tfvc_label', 'Deletes a TFVC label. Requires confirmDelete.', DeleteLabelSchema, deleteLabel);
  registerTool(server, 'tfs_delete_shelveset', 'Deletes a TFVC shelveset. Requires confirmDelete.', ShelvesetDeleteSchema, deleteShelveset);
}
