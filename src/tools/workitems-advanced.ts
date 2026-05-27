import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfsListResponse, WorkItem, WorkItemPatch } from '../types/tfs.js';

const log = createChildLogger('tool:workitems-advanced');

const GetWorkItemUpdatesSchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  top: z.number().int().positive().max(200).optional().default(50),
  skip: z.number().int().nonnegative().optional().default(0),
});

const GetWorkItemRevisionsSchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  top: z.number().int().positive().max(200).optional().default(50),
  skip: z.number().int().nonnegative().optional().default(0),
  expand: z.enum(['all', 'fields', 'links', 'none', 'relations']).optional().default('all'),
});

const GetWorkItemRevisionSchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  revision: z.number().int().positive().describe('Revision number'),
  expand: z.enum(['all', 'fields', 'links', 'none', 'relations']).optional().default('all'),
});

const DeleteWorkItemSchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  destroy: z.boolean().optional().default(false).describe('If true, permanently deletes instead of moving to recycle bin'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete or move a work item to recycle bin'),
});

const DeletedWorkItemSchema = z.object({
  id: z.number().int().positive().describe('Deleted work item ID'),
});

const RestoreWorkItemSchema = DeletedWorkItemSchema.extend({
  confirmRestore: z.boolean().optional().default(false).describe('Required to restore a deleted work item'),
});

const DestroyDeletedWorkItemSchema = DeletedWorkItemSchema.extend({
  confirmDestroy: z.boolean().optional().default(false).describe('Required to permanently delete a recycled work item'),
  confirmPermanentDelete: z.literal('PERMANENT_DELETE')
    .describe('Must be exactly PERMANENT_DELETE to avoid accidental data loss'),
});

const UploadAttachmentSchema = z.object({
  fileName: z.string().min(1).describe('Attachment file name shown in TFS'),
  contentText: z.string().optional().describe('Text content to upload. Use for small text files.'),
  contentBase64: z.string().optional().describe('Base64 content to upload. Use for binary files.'),
});

const GetAttachmentSchema = z.object({
  attachmentId: z.string().min(1).describe('Attachment GUID returned by tfs_upload_work_item_attachment'),
  fileName: z.string().optional().describe('Optional file name hint'),
  asText: z.boolean().optional().default(false).describe('Decode returned bytes as UTF-8 text instead of base64'),
});

const AddAttachmentToWorkItemSchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  attachmentUrl: z.string().url().describe('URL returned by tfs_upload_work_item_attachment'),
  comment: z.string().optional().describe('Optional relation comment'),
});

const RemoveAttachmentFromWorkItemSchema = z.object({
  id: z.number().int().positive().describe('Work item ID'),
  relationIndex: z.number().int().nonnegative().describe('Index from work item relations array'),
  confirmRemove: z.boolean().optional().default(false).describe('Required to remove the attachment relation'),
});

const GetCategorySchema = z.object({
  categoryName: z.string().min(1).describe('Category reference/name, e.g. Microsoft.BugCategory'),
});

const TagNameSchema = z.object({
  tagName: z.string().min(1).describe('Tag name'),
});

const DeleteTagSchema = TagNameSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a tag'),
});

const SavedQueryBodySchema = z.object({
  path: z.string().optional().describe('Parent query folder path. Empty means root queries folder.'),
  name: z.string().min(1).describe('Query or folder name'),
  wiql: z.string().optional().describe('WIQL text. Omit when creating a folder.'),
  isFolder: z.boolean().optional().default(false).describe('Create/update a query folder instead of a WIQL query'),
});

const UpdateSavedQuerySchema = z.object({
  queryIdOrPath: z.string().min(1).describe('Query GUID or path below wit/queries'),
  name: z.string().optional(),
  wiql: z.string().optional(),
  isFolder: z.boolean().optional(),
});

const DeleteSavedQuerySchema = z.object({
  queryIdOrPath: z.string().min(1).describe('Query GUID or path below wit/queries'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a saved query/folder'),
});

const ClassificationNodePathSchema = z.object({
  structureGroup: z.enum(['areas', 'iterations']).describe('Classification tree'),
  path: z.string().optional().describe('Optional node path below areas/iterations'),
  depth: z.number().int().min(0).max(20).optional().default(2),
});

const CreateClassificationNodeSchema = z.object({
  structureGroup: z.enum(['areas', 'iterations']),
  parentPath: z.string().optional().describe('Parent path below areas/iterations. Empty creates below root.'),
  name: z.string().min(1),
  startDate: z.string().optional().describe('Iteration start date ISO string'),
  finishDate: z.string().optional().describe('Iteration finish date ISO string'),
});

const UpdateClassificationNodeSchema = z.object({
  structureGroup: z.enum(['areas', 'iterations']),
  path: z.string().min(1).describe('Node path below areas/iterations'),
  name: z.string().optional(),
  startDate: z.string().optional(),
  finishDate: z.string().optional(),
});

const DeleteClassificationNodeSchema = z.object({
  structureGroup: z.enum(['areas', 'iterations']),
  path: z.string().min(1).describe('Node path below areas/iterations'),
  reclassifyId: z.number().int().positive().optional()
    .describe('Optional target classification node ID for existing work items'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a classification node'),
});

function encodePath(value: string): string {
  return value.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function classificationResource(structureGroup: 'areas' | 'iterations', path?: string): string {
  return path ? structureGroup + '/' + encodePath(path) : structureGroup;
}

function savedQueryResource(path?: string): string {
  return path ? encodePath(path) : '';
}

function buildAttachmentContent(args: z.infer<typeof UploadAttachmentSchema>): Buffer {
  if (args.contentBase64 && args.contentText) {
    throw new Error('Provide either contentBase64 or contentText, not both.');
  }
  if (args.contentBase64) return Buffer.from(args.contentBase64, 'base64');
  if (args.contentText !== undefined) return Buffer.from(args.contentText, 'utf8');
  throw new Error('Either contentBase64 or contentText is required.');
}

async function getWorkItemUpdates(args: z.infer<typeof GetWorkItemUpdatesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', args.id + '/updates');
  const result = await client.get<TfsListResponse<unknown>>(url, { $top: args.top, $skip: args.skip });
  return JSON.stringify(result, null, 2);
}

async function getWorkItemRevisions(args: z.infer<typeof GetWorkItemRevisionsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', args.id + '/revisions');
  const result = await client.get<TfsListResponse<WorkItem>>(url, {
    $top: args.top,
    $skip: args.skip,
    $expand: args.expand,
  });
  return JSON.stringify(result, null, 2);
}

async function getWorkItemRevision(args: z.infer<typeof GetWorkItemRevisionSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', args.id + '/revisions/' + args.revision);
  const result = await client.get<WorkItem>(url, { $expand: args.expand });
  return JSON.stringify(result, null, 2);
}

async function deleteWorkItem(args: z.infer<typeof DeleteWorkItemSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a work item.');
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', String(args.id));
  const result = await client.delete<unknown>(url, { destroy: args.destroy });
  log.info('Deleted work item #' + args.id + (args.destroy ? ' permanently' : ' to recycle bin'));
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listDeletedWorkItems(): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/recyclebin', '');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function getDeletedWorkItem(args: z.infer<typeof DeletedWorkItemSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/recyclebin', String(args.id));
  const result = await client.get<unknown>(url);
  return JSON.stringify(result, null, 2);
}

async function restoreWorkItem(args: z.infer<typeof RestoreWorkItemSchema>): Promise<string> {
  if (!args.confirmRestore) throw new Error('confirmRestore=true is required to restore a work item.');
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/recyclebin', String(args.id));
  const result = await client.patch<unknown>(url, { isDeleted: false });
  log.info('Restored work item #' + args.id + ' from recycle bin');
  return JSON.stringify(result, null, 2);
}

async function destroyDeletedWorkItem(args: z.infer<typeof DestroyDeletedWorkItemSchema>): Promise<string> {
  if (!args.confirmDestroy) throw new Error('confirmDestroy=true is required to permanently delete a work item.');
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/recyclebin', String(args.id));
  const result = await client.delete<unknown>(url);
  log.info('Permanently deleted recycled work item #' + args.id);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function uploadAttachment(args: z.infer<typeof UploadAttachmentSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/attachments', '');
  const body = buildAttachmentContent(args);
  const result = await client.post<unknown>(
    url,
    body,
    { fileName: args.fileName, uploadType: 'Simple' },
    { 'Content-Type': 'application/octet-stream' },
  );
  log.info('Uploaded work item attachment ' + args.fileName);
  return JSON.stringify(result, null, 2);
}

async function getAttachment(args: z.infer<typeof GetAttachmentSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/attachments', encodeURIComponent(args.attachmentId));
  const bytes = await client.getRaw(url, args.fileName ? { fileName: args.fileName } : undefined);
  return JSON.stringify({
    attachmentId: args.attachmentId,
    fileName: args.fileName,
    encoding: args.asText ? 'utf8' : 'base64',
    content: args.asText ? bytes.toString('utf8') : bytes.toString('base64'),
  }, null, 2);
}

async function addAttachmentToWorkItem(args: z.infer<typeof AddAttachmentToWorkItemSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', String(args.id));
  const patches: WorkItemPatch[] = [{
    op: 'add',
    path: '/relations/-',
    value: {
      rel: 'AttachedFile',
      url: args.attachmentUrl,
      attributes: { comment: args.comment ?? '' },
    },
  }];
  const result = await client.patch<WorkItem>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });
  log.info('Added attachment relation to work item #' + args.id);
  return JSON.stringify(result, null, 2);
}

async function removeAttachmentFromWorkItem(args: z.infer<typeof RemoveAttachmentFromWorkItemSchema>): Promise<string> {
  if (!args.confirmRemove) throw new Error('confirmRemove=true is required to remove an attachment relation.');
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitems', String(args.id));
  const patches: WorkItemPatch[] = [{ op: 'remove', path: '/relations/' + args.relationIndex }];
  const result = await client.patch<WorkItem>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });
  log.info('Removed attachment relation #' + args.relationIndex + ' from work item #' + args.id);
  return JSON.stringify(result, null, 2);
}

async function listRelationTypes(): Promise<string> {
  const client = getTfsClient();
  const url = client.collectionApiUrl('wit/workitemrelationtypes', '');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function listCategories(): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/workitemtypecategories', '');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function getCategory(args: z.infer<typeof GetCategorySchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/workitemtypecategories', encodeURIComponent(args.categoryName));
  const result = await client.get<unknown>(url);
  return JSON.stringify(result, null, 2);
}

async function listTags(): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/tags', '');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function getTag(args: z.infer<typeof TagNameSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/tags', encodeURIComponent(args.tagName));
  const result = await client.get<unknown>(url);
  return JSON.stringify(result, null, 2);
}

async function createTag(args: z.infer<typeof TagNameSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/tags', encodeURIComponent(args.tagName));
  const result = await client.put<unknown>(url, {});
  log.info('Created work item tag ' + args.tagName);
  return JSON.stringify(result, null, 2);
}

async function deleteTag(args: z.infer<typeof DeleteTagSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a tag.');
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/tags', encodeURIComponent(args.tagName));
  const result = await client.delete<unknown>(url);
  log.info('Deleted work item tag ' + args.tagName);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function createSavedQuery(args: z.infer<typeof SavedQueryBodySchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/queries', savedQueryResource(args.path));
  const body = args.isFolder
    ? { name: args.name, isFolder: true }
    : { name: args.name, wiql: args.wiql, isFolder: false };
  if (!args.isFolder && !args.wiql) throw new Error('wiql is required when creating a saved query.');
  const result = await client.post<unknown>(url, body);
  log.info('Created saved query ' + args.name);
  return JSON.stringify(result, null, 2);
}

async function updateSavedQuery(args: z.infer<typeof UpdateSavedQuerySchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/queries', savedQueryResource(args.queryIdOrPath));
  const body: Record<string, unknown> = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.wiql !== undefined) body.wiql = args.wiql;
  if (args.isFolder !== undefined) body.isFolder = args.isFolder;
  if (Object.keys(body).length === 0) throw new Error('At least one field is required to update a saved query.');
  const result = await client.patch<unknown>(url, body);
  log.info('Updated saved query ' + args.queryIdOrPath);
  return JSON.stringify(result, null, 2);
}

async function deleteSavedQuery(args: z.infer<typeof DeleteSavedQuerySchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a saved query.');
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/queries', savedQueryResource(args.queryIdOrPath));
  const result = await client.delete<unknown>(url);
  log.info('Deleted saved query ' + args.queryIdOrPath);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function getClassificationNode(args: z.infer<typeof ClassificationNodePathSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/classificationnodes', classificationResource(args.structureGroup, args.path));
  const result = await client.get<unknown>(url, { '$depth': args.depth });
  return JSON.stringify(result, null, 2);
}

async function createClassificationNode(args: z.infer<typeof CreateClassificationNodeSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/classificationnodes', classificationResource(args.structureGroup, args.parentPath));
  const body: Record<string, unknown> = { name: args.name };
  if (args.startDate || args.finishDate) {
    body.attributes = {
      startDate: args.startDate,
      finishDate: args.finishDate,
    };
  }
  const result = await client.post<unknown>(url, body);
  log.info('Created classification node ' + args.structureGroup + '/' + args.name);
  return JSON.stringify(result, null, 2);
}

async function updateClassificationNode(args: z.infer<typeof UpdateClassificationNodeSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/classificationnodes', classificationResource(args.structureGroup, args.path));
  const body: Record<string, unknown> = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.startDate !== undefined || args.finishDate !== undefined) {
    body.attributes = {
      startDate: args.startDate,
      finishDate: args.finishDate,
    };
  }
  if (Object.keys(body).length === 0) throw new Error('At least one field is required to update a classification node.');
  const result = await client.patch<unknown>(url, body);
  log.info('Updated classification node ' + args.structureGroup + '/' + args.path);
  return JSON.stringify(result, null, 2);
}

async function deleteClassificationNode(args: z.infer<typeof DeleteClassificationNodeSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a classification node.');
  const client = getTfsClient();
  const url = client.projectApiUrl('wit/classificationnodes', classificationResource(args.structureGroup, args.path));
  const params = args.reclassifyId ? { reclassifyId: args.reclassifyId } : undefined;
  const result = await client.delete<unknown>(url, params);
  log.info('Deleted classification node ' + args.structureGroup + '/' + args.path);
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

export function registerAdvancedWorkItemTools(server: McpServer): void {
  registerTool(server, 'tfs_get_work_item_updates', 'Lists update deltas for a work item, including changed fields and relations.', GetWorkItemUpdatesSchema, getWorkItemUpdates);
  registerTool(server, 'tfs_get_work_item_revisions', 'Lists full historical revisions for a work item.', GetWorkItemRevisionsSchema, getWorkItemRevisions);
  registerTool(server, 'tfs_get_work_item_revision', 'Gets one specific historical revision of a work item.', GetWorkItemRevisionSchema, getWorkItemRevision);
  registerTool(server, 'tfs_delete_work_item', 'Deletes a work item to recycle bin, or permanently when destroy=true. Requires confirmDelete.', DeleteWorkItemSchema, deleteWorkItem);
  registerTool(server, 'tfs_list_deleted_work_items', 'Lists work items currently in the project recycle bin.', z.object({}), listDeletedWorkItems);
  registerTool(server, 'tfs_get_deleted_work_item', 'Gets metadata for a work item in the recycle bin.', DeletedWorkItemSchema, getDeletedWorkItem);
  registerTool(server, 'tfs_restore_work_item', 'Restores a work item from the recycle bin. Requires confirmRestore.', RestoreWorkItemSchema, restoreWorkItem);
  registerTool(server, 'tfs_destroy_deleted_work_item', 'Permanently deletes a recycled work item. Requires confirmDestroy and confirmPermanentDelete.', DestroyDeletedWorkItemSchema, destroyDeletedWorkItem);
  registerTool(server, 'tfs_upload_work_item_attachment', 'Uploads a work item attachment and returns its attachment URL.', UploadAttachmentSchema, uploadAttachment);
  registerTool(server, 'tfs_get_work_item_attachment', 'Downloads a work item attachment as base64 or UTF-8 text.', GetAttachmentSchema, getAttachment);
  registerTool(server, 'tfs_add_work_item_attachment', 'Adds an uploaded attachment relation to a work item.', AddAttachmentToWorkItemSchema, addAttachmentToWorkItem);
  registerTool(server, 'tfs_remove_work_item_attachment', 'Removes an attachment relation from a work item by relation index. Requires confirmRemove.', RemoveAttachmentFromWorkItemSchema, removeAttachmentFromWorkItem);
  registerTool(server, 'tfs_list_work_item_relation_types', 'Lists all available work item relation/link types in the collection.', z.object({}), listRelationTypes);
  registerTool(server, 'tfs_list_work_item_categories', 'Lists work item type categories in the configured project.', z.object({}), listCategories);
  registerTool(server, 'tfs_get_work_item_category', 'Gets one work item type category by name/reference.', GetCategorySchema, getCategory);
  registerTool(server, 'tfs_list_work_item_tags', 'Lists work item tags in the configured project.', z.object({}), listTags);
  registerTool(server, 'tfs_get_work_item_tag', 'Gets one work item tag by name.', TagNameSchema, getTag);
  registerTool(server, 'tfs_create_work_item_tag', 'Creates a work item tag.', TagNameSchema, createTag);
  registerTool(server, 'tfs_delete_work_item_tag', 'Deletes a work item tag. Requires confirmDelete.', DeleteTagSchema, deleteTag);
  registerTool(server, 'tfs_create_saved_query', 'Creates a saved WIQL query or query folder.', SavedQueryBodySchema, createSavedQuery);
  registerTool(server, 'tfs_update_saved_query', 'Updates a saved WIQL query or query folder.', UpdateSavedQuerySchema, updateSavedQuery);
  registerTool(server, 'tfs_delete_saved_query', 'Deletes a saved WIQL query or query folder. Requires confirmDelete.', DeleteSavedQuerySchema, deleteSavedQuery);
  registerTool(server, 'tfs_get_classification_node', 'Gets an area or iteration classification node tree.', ClassificationNodePathSchema, getClassificationNode);
  registerTool(server, 'tfs_create_classification_node', 'Creates an area or iteration classification node.', CreateClassificationNodeSchema, createClassificationNode);
  registerTool(server, 'tfs_update_classification_node', 'Updates an area or iteration classification node.', UpdateClassificationNodeSchema, updateClassificationNode);
  registerTool(server, 'tfs_delete_classification_node', 'Deletes an area or iteration classification node. Requires confirmDelete.', DeleteClassificationNodeSchema, deleteClassificationNode);
}
