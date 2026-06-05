import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { GitPullRequest, GitRef, GitRepository, TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:git-advanced');

const ProjectOverride = z.object({
  projectIdOrName: z.string().optional().describe('Project ID or name. Defaults to configured project.'),
});

const RepositorySchema = z.object({
  repositoryId: z.string().min(1).describe('Repository name or GUID'),
}).merge(ProjectOverride);

const CreateRepoSchema = z.object({
  name: z.string().min(1).describe('Repository name'),
  projectId: z.string().optional().describe('Optional project GUID'),
});

const UpdateRepoSchema = RepositorySchema.extend({
  name: z.string().optional().describe('New repository name'),
  defaultBranch: z.string().optional().describe('Default branch ref, e.g. refs/heads/main'),
});

const DeleteRepoSchema = RepositorySchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a Git repository'),
});

const ListRefsSchema = RepositorySchema.extend({
  filter: z.string().optional().describe('Ref filter, e.g. heads/, tags/ or heads/main'),
  top: z.number().int().positive().max(1000).optional().default(200),
});

const GetRefSchema = RepositorySchema.extend({
  filter: z.string().min(1).describe('Exact or prefix ref filter, e.g. heads/main'),
});

const UpdateRefsSchema = RepositorySchema.extend({
  refUpdates: z.array(z.object({
    name: z.string().min(1).describe('Full ref name, e.g. refs/heads/main'),
    oldObjectId: z.string().min(1).describe('Current object ID, or 40 zeros for create'),
    newObjectId: z.string().min(1).describe('New object ID, or 40 zeros for delete'),
  })).min(1),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update Git refs'),
});

const CreateBranchSchema = RepositorySchema.extend({
  branchName: z.string().min(1).describe('Branch name without refs/heads/'),
  sourceObjectId: z.string().min(1).describe('Commit object ID for the new branch'),
  confirmCreate: z.boolean().optional().default(false).describe('Required to create a branch'),
});

const DeleteBranchSchema = RepositorySchema.extend({
  branchName: z.string().min(1).describe('Branch name without refs/heads/'),
  oldObjectId: z.string().min(1).describe('Current branch object ID'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a branch'),
});

const ListPushesSchema = RepositorySchema.extend({
  top: z.number().int().positive().max(200).optional().default(50),
  skip: z.number().int().nonnegative().optional().default(0),
});

const PushIdSchema = RepositorySchema.extend({
  pushId: z.number().int().positive().describe('Push ID'),
});

const CreatePushSchema = RepositorySchema.extend({
  push: z.record(z.unknown()).describe('Full Git push JSON body expected by TFS'),
  confirmCreate: z.boolean().optional().default(false).describe('Required to create a push'),
});

const CommitChangesSchema = RepositorySchema.extend({
  commitId: z.string().min(1).describe('Commit SHA'),
  top: z.number().int().positive().max(1000).optional().default(100),
  skip: z.number().int().nonnegative().optional().default(0),
});

const DiffsSchema = RepositorySchema.extend({
  baseVersion: z.string().min(1).describe('Base version, branch or commit'),
  targetVersion: z.string().min(1).describe('Target version, branch or commit'),
  baseVersionType: z.enum(['branch', 'commit', 'tag']).optional().default('branch'),
  targetVersionType: z.enum(['branch', 'commit', 'tag']).optional().default('branch'),
  top: z.number().int().positive().max(1000).optional().default(100),
  skip: z.number().int().nonnegative().optional().default(0),
});

const BlobSchema = RepositorySchema.extend({
  objectId: z.string().min(1).describe('Blob object ID'),
  asText: z.boolean().optional().default(false).describe('Return as UTF-8 text instead of base64'),
});

const TreeSchema = RepositorySchema.extend({
  objectId: z.string().min(1).describe('Tree object ID'),
  recursive: z.boolean().optional().default(false).describe('Include recursive tree entries'),
});

const DownloadZipSchema = RepositorySchema.extend({
  path: z.string().optional().default('/').describe('Path to download as zip'),
  version: z.string().optional().describe('Branch, tag or commit. Defaults to default branch'),
  versionType: z.enum(['branch', 'commit', 'tag']).optional().default('branch'),
});

const CreatePullRequestSchema = RepositorySchema.extend({
  sourceRefName: z.string().min(1).describe('Source ref, e.g. refs/heads/feature/x'),
  targetRefName: z.string().min(1).describe('Target ref, e.g. refs/heads/main'),
  title: z.string().min(1),
  description: z.string().optional(),
  reviewers: z.array(z.record(z.unknown())).optional().describe('Optional reviewer objects expected by TFS'),
  workItemRefs: z.array(z.object({ id: z.string() })).optional().describe('Optional work item refs'),
  confirmCreate: z.boolean().optional().default(false).describe('Required to create a pull request'),
});

const PullRequestSchema = RepositorySchema.extend({
  pullRequestId: z.number().int().positive().describe('Pull request ID'),
});

const UpdatePullRequestSchema = PullRequestSchema.extend({
  body: z.record(z.unknown()).describe('Partial PR update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a pull request'),
});

const CompletePullRequestSchema = PullRequestSchema.extend({
  lastMergeSourceCommit: z.string().optional().describe('Optional last merge source commit ID'),
  completionOptions: z.record(z.unknown()).optional().describe('Optional completionOptions object'),
  confirmComplete: z.boolean().optional().default(false).describe('Required to complete a pull request'),
});

const AbandonPullRequestSchema = PullRequestSchema.extend({
  confirmAbandon: z.boolean().optional().default(false).describe('Required to abandon a pull request'),
});

const ThreadSchema = PullRequestSchema.extend({
  threadId: z.number().int().positive().describe('Thread ID'),
});

const CreateThreadSchema = PullRequestSchema.extend({
  thread: z.record(z.unknown()).describe('Thread JSON body expected by TFS'),
  confirmCreate: z.boolean().optional().default(false).describe('Required to create a PR thread'),
});

const UpdateThreadSchema = ThreadSchema.extend({
  body: z.record(z.unknown()).describe('Thread update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a PR thread'),
});

const AddCommentSchema = ThreadSchema.extend({
  content: z.string().min(1).describe('Comment content'),
  commentType: z.string().optional().default('text'),
  parentCommentId: z.number().int().positive().optional(),
  confirmCreate: z.boolean().optional().default(false).describe('Required to add a PR comment'),
});

const CommentSchema = ThreadSchema.extend({
  commentId: z.number().int().positive().describe('Comment ID'),
});

const UpdateCommentSchema = CommentSchema.extend({
  content: z.string().optional(),
  isDeleted: z.boolean().optional(),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a PR comment'),
});

const DeleteCommentSchema = CommentSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a PR comment'),
});

const ReviewerSchema = PullRequestSchema.extend({
  reviewerId: z.string().min(1).describe('Reviewer identity ID'),
});

const AddReviewerSchema = ReviewerSchema.extend({
  reviewer: z.record(z.unknown()).optional().describe('Optional reviewer JSON body expected by TFS'),
  confirmAdd: z.boolean().optional().default(false).describe('Required to add a reviewer'),
});

const RemoveReviewerSchema = ReviewerSchema.extend({
  confirmRemove: z.boolean().optional().default(false).describe('Required to remove a reviewer'),
});

const VoteSchema = ReviewerSchema.extend({
  vote: z.number().int().min(-10).max(10).describe('TFS vote value, e.g. 10 approve, -10 reject, 0 no vote'),
  confirmVote: z.boolean().optional().default(false).describe('Required to vote on a PR'),
});

const PullRequestWorkItemSchema = PullRequestSchema.extend({
  workItemId: z.number().int().positive().describe('Work item ID'),
  confirmAdd: z.boolean().optional().default(false).describe('Required to link a work item to a PR'),
});

const ZERO_OBJECT_ID = '0000000000000000000000000000000000000000';

async function createRepository(args: z.infer<typeof CreateRepoSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectId);
  const url = client.projectApiUrl('git/repositories', '');
  const body: Record<string, unknown> = { name: args.name };
  if (args.projectId) body.project = { id: args.projectId };
  const result = await client.post<GitRepository>(url, body);
  log.info('Created Git repository ' + args.name);
  return JSON.stringify(result, null, 2);
}

async function updateRepository(args: z.infer<typeof UpdateRepoSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId);
  const body: Record<string, unknown> = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.defaultBranch !== undefined) body.defaultBranch = args.defaultBranch;
  if (Object.keys(body).length === 0) throw new Error('At least one field is required to update a repository.');
  const result = await client.patch<GitRepository>(url, body);
  log.info('Updated Git repository ' + args.repositoryId);
  return JSON.stringify(result, null, 2);
}

async function deleteRepository(args: z.infer<typeof DeleteRepoSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a Git repository.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId);
  const result = await client.delete<unknown>(url);
  log.info('Deleted Git repository ' + args.repositoryId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listRefs(args: z.infer<typeof ListRefsSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/refs');
  const params: Record<string, unknown> = { $top: args.top };
  if (args.filter) params.filter = args.filter;
  const result = await client.get<TfsListResponse<GitRef>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getRef(args: z.infer<typeof GetRefSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/refs');
  const result = await client.get<TfsListResponse<GitRef>>(url, { filter: args.filter, $top: 1 });
  return JSON.stringify(result, null, 2);
}

async function updateRefs(args: z.infer<typeof UpdateRefsSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update Git refs.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/refs');
  const result = await client.post<TfsListResponse<GitRef>>(url, args.refUpdates);
  log.info('Updated ' + args.refUpdates.length + ' Git ref(s) in repository ' + args.repositoryId);
  return JSON.stringify(result, null, 2);
}

async function createBranch(args: z.infer<typeof CreateBranchSchema>): Promise<string> {
  if (!args.confirmCreate) throw new Error('confirmCreate=true is required to create a branch.');
  return updateRefs({
    repositoryId: args.repositoryId,
    refUpdates: [{
      name: 'refs/heads/' + args.branchName.replace(/^refs\/heads\//, ''),
      oldObjectId: ZERO_OBJECT_ID,
      newObjectId: args.sourceObjectId,
    }],
    confirmUpdate: true,
  });
}

async function deleteBranch(args: z.infer<typeof DeleteBranchSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a branch.');
  return updateRefs({
    repositoryId: args.repositoryId,
    refUpdates: [{
      name: 'refs/heads/' + args.branchName.replace(/^refs\/heads\//, ''),
      oldObjectId: args.oldObjectId,
      newObjectId: ZERO_OBJECT_ID,
    }],
    confirmUpdate: true,
  });
}

async function listPushes(args: z.infer<typeof ListPushesSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pushes');
  const result = await client.get<TfsListResponse<unknown>>(url, { $top: args.top, $skip: args.skip });
  return JSON.stringify(result, null, 2);
}

async function getPush(args: z.infer<typeof PushIdSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pushes/' + args.pushId);
  const result = await client.get<unknown>(url);
  return JSON.stringify(result, null, 2);
}

async function createPush(args: z.infer<typeof CreatePushSchema>): Promise<string> {
  if (!args.confirmCreate) throw new Error('confirmCreate=true is required to create a push.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pushes');
  const result = await client.post<unknown>(url, args.push);
  log.info('Created Git push in repository ' + args.repositoryId);
  return JSON.stringify(result, null, 2);
}

async function getCommitChanges(args: z.infer<typeof CommitChangesSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/commits/' + args.commitId + '/changes');
  const result = await client.get<unknown>(url, { $top: args.top, $skip: args.skip });
  return JSON.stringify(result, null, 2);
}

async function getDiffs(args: z.infer<typeof DiffsSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/diffs/commits');
  const result = await client.get<unknown>(url, {
    'baseVersionDescriptor.version': args.baseVersion,
    'baseVersionDescriptor.versionType': args.baseVersionType,
    'targetVersionDescriptor.version': args.targetVersion,
    'targetVersionDescriptor.versionType': args.targetVersionType,
    $top: args.top,
    $skip: args.skip,
  });
  return JSON.stringify(result, null, 2);
}

async function getBlob(args: z.infer<typeof BlobSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/blobs/' + args.objectId);
  const bytes = await client.getRaw(url);
  return JSON.stringify({
    objectId: args.objectId,
    encoding: args.asText ? 'utf8' : 'base64',
    content: args.asText ? bytes.toString('utf8') : bytes.toString('base64'),
  }, null, 2);
}

async function getTree(args: z.infer<typeof TreeSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/trees/' + args.objectId);
  const result = await client.get<unknown>(url, { recursive: args.recursive });
  return JSON.stringify(result, null, 2);
}

async function downloadZip(args: z.infer<typeof DownloadZipSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/items');
  const params: Record<string, unknown> = {
    scopePath: args.path,
    $format: 'zip',
    'versionDescriptor.versionType': args.versionType,
  };
  if (args.version) params['versionDescriptor.version'] = args.version;
  const bytes = await client.getRaw(url, params);
  return JSON.stringify({
    repositoryId: args.repositoryId,
    path: args.path,
    encoding: 'base64',
    content: bytes.toString('base64'),
  }, null, 2);
}

async function createPullRequest(args: z.infer<typeof CreatePullRequestSchema>): Promise<string> {
  if (!args.confirmCreate) throw new Error('confirmCreate=true is required to create a pull request.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests');
  const result = await client.post<GitPullRequest>(url, {
    sourceRefName: args.sourceRefName,
    targetRefName: args.targetRefName,
    title: args.title,
    description: args.description,
    reviewers: args.reviewers,
    workItemRefs: args.workItemRefs,
  });
  log.info('Created pull request #' + result.pullRequestId + ' in repository ' + args.repositoryId);
  return JSON.stringify(result, null, 2);
}

async function updatePullRequest(args: z.infer<typeof UpdatePullRequestSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a pull request.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId);
  const result = await client.patch<GitPullRequest>(url, args.body);
  log.info('Updated pull request #' + args.pullRequestId);
  return JSON.stringify(result, null, 2);
}

async function completePullRequest(args: z.infer<typeof CompletePullRequestSchema>): Promise<string> {
  if (!args.confirmComplete) throw new Error('confirmComplete=true is required to complete a pull request.');
  const body: Record<string, unknown> = { status: 'completed' };
  if (args.lastMergeSourceCommit) body.lastMergeSourceCommit = { commitId: args.lastMergeSourceCommit };
  if (args.completionOptions) body.completionOptions = args.completionOptions;
  return updatePullRequest({ repositoryId: args.repositoryId, pullRequestId: args.pullRequestId, body, confirmUpdate: true });
}

async function abandonPullRequest(args: z.infer<typeof AbandonPullRequestSchema>): Promise<string> {
  if (!args.confirmAbandon) throw new Error('confirmAbandon=true is required to abandon a pull request.');
  return updatePullRequest({
    repositoryId: args.repositoryId,
    pullRequestId: args.pullRequestId,
    body: { status: 'abandoned' },
    confirmUpdate: true,
  });
}

async function listThreads(args: z.infer<typeof PullRequestSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/threads');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function getThread(args: z.infer<typeof ThreadSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/threads/' + args.threadId);
  const result = await client.get<unknown>(url);
  return JSON.stringify(result, null, 2);
}

async function createThread(args: z.infer<typeof CreateThreadSchema>): Promise<string> {
  if (!args.confirmCreate) throw new Error('confirmCreate=true is required to create a pull request thread.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/threads');
  const result = await client.post<unknown>(url, args.thread);
  log.info('Created thread on pull request #' + args.pullRequestId);
  return JSON.stringify(result, null, 2);
}

async function updateThread(args: z.infer<typeof UpdateThreadSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a pull request thread.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/threads/' + args.threadId);
  const result = await client.patch<unknown>(url, args.body);
  log.info('Updated thread #' + args.threadId + ' on pull request #' + args.pullRequestId);
  return JSON.stringify(result, null, 2);
}

async function addComment(args: z.infer<typeof AddCommentSchema>): Promise<string> {
  if (!args.confirmCreate) throw new Error('confirmCreate=true is required to add a pull request comment.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/threads/' + args.threadId + '/comments');
  const result = await client.post<unknown>(url, {
    content: args.content,
    commentType: args.commentType,
    parentCommentId: args.parentCommentId,
  });
  log.info('Added comment to thread #' + args.threadId + ' on pull request #' + args.pullRequestId);
  return JSON.stringify(result, null, 2);
}

async function updateComment(args: z.infer<typeof UpdateCommentSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a pull request comment.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/threads/' + args.threadId + '/comments/' + args.commentId);
  const body: Record<string, unknown> = {};
  if (args.content !== undefined) body.content = args.content;
  if (args.isDeleted !== undefined) body.isDeleted = args.isDeleted;
  if (Object.keys(body).length === 0) throw new Error('At least one field is required to update a pull request comment.');
  const result = await client.patch<unknown>(url, body);
  log.info('Updated comment #' + args.commentId + ' on pull request #' + args.pullRequestId);
  return JSON.stringify(result, null, 2);
}

async function deleteComment(args: z.infer<typeof DeleteCommentSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a pull request comment.');
  return updateComment({ ...args, isDeleted: true, confirmUpdate: true });
}

async function addReviewer(args: z.infer<typeof AddReviewerSchema>): Promise<string> {
  if (!args.confirmAdd) throw new Error('confirmAdd=true is required to add a pull request reviewer.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/reviewers/' + encodeURIComponent(args.reviewerId));
  const result = await client.put<unknown>(url, args.reviewer ?? {});
  log.info('Added reviewer ' + args.reviewerId + ' to pull request #' + args.pullRequestId);
  return JSON.stringify(result, null, 2);
}

async function removeReviewer(args: z.infer<typeof RemoveReviewerSchema>): Promise<string> {
  if (!args.confirmRemove) throw new Error('confirmRemove=true is required to remove a pull request reviewer.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/reviewers/' + encodeURIComponent(args.reviewerId));
  const result = await client.delete<unknown>(url);
  log.info('Removed reviewer ' + args.reviewerId + ' from pull request #' + args.pullRequestId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function votePullRequest(args: z.infer<typeof VoteSchema>): Promise<string> {
  if (!args.confirmVote) throw new Error('confirmVote=true is required to vote on a pull request.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/reviewers/' + encodeURIComponent(args.reviewerId));
  const result = await client.put<unknown>(url, { vote: args.vote });
  log.info('Set vote ' + args.vote + ' for reviewer ' + args.reviewerId + ' on pull request #' + args.pullRequestId);
  return JSON.stringify(result, null, 2);
}

async function getPullRequestWorkItems(args: z.infer<typeof PullRequestSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/workitems');
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function addPullRequestWorkItem(args: z.infer<typeof PullRequestWorkItemSchema>): Promise<string> {
  if (!args.confirmAdd) throw new Error('confirmAdd=true is required to link a work item to a pull request.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests/' + args.pullRequestId + '/workitems/' + args.workItemId);
  const result = await client.post<unknown>(url, {});
  log.info('Linked work item #' + args.workItemId + ' to pull request #' + args.pullRequestId);
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

export function registerAdvancedGitTools(server: McpServer): void {
  registerTool(server, 'tfs_create_git_repo', 'Creates a Git repository in the configured project.', CreateRepoSchema, createRepository);
  registerTool(server, 'tfs_update_git_repo', 'Updates Git repository metadata.', UpdateRepoSchema, updateRepository);
  registerTool(server, 'tfs_delete_git_repo', 'Deletes a Git repository. Requires confirmDelete.', DeleteRepoSchema, deleteRepository);
  registerTool(server, 'tfs_list_git_refs', 'Lists Git refs in a repository.', ListRefsSchema, listRefs);
  registerTool(server, 'tfs_get_git_ref', 'Gets refs matching a Git ref filter.', GetRefSchema, getRef);
  registerTool(server, 'tfs_update_git_refs', 'Updates one or more Git refs. Requires confirmUpdate.', UpdateRefsSchema, updateRefs);
  registerTool(server, 'tfs_create_git_branch', 'Creates a branch from a commit object ID. Requires confirmCreate.', CreateBranchSchema, createBranch);
  registerTool(server, 'tfs_delete_git_branch', 'Deletes a branch by setting it to the zero object ID. Requires confirmDelete.', DeleteBranchSchema, deleteBranch);
  registerTool(server, 'tfs_list_git_pushes', 'Lists Git pushes in a repository.', ListPushesSchema, listPushes);
  registerTool(server, 'tfs_get_git_push', 'Gets one Git push by ID.', PushIdSchema, getPush);
  registerTool(server, 'tfs_create_git_push', 'Creates a Git push from a full TFS JSON body. Requires confirmCreate.', CreatePushSchema, createPush);
  registerTool(server, 'tfs_get_git_commit_changes', 'Lists file changes in a Git commit.', CommitChangesSchema, getCommitChanges);
  registerTool(server, 'tfs_get_git_diffs', 'Gets diffs between two Git versions.', DiffsSchema, getDiffs);
  registerTool(server, 'tfs_get_git_blob', 'Gets a Git blob as base64 or UTF-8 text.', BlobSchema, getBlob);
  registerTool(server, 'tfs_get_git_tree', 'Gets a Git tree object.', TreeSchema, getTree);
  registerTool(server, 'tfs_download_git_zip', 'Downloads a Git folder/repository path as a zip in base64.', DownloadZipSchema, downloadZip);
  registerTool(server, 'tfs_create_pull_request', 'Creates a pull request. Requires confirmCreate.', CreatePullRequestSchema, createPullRequest);
  registerTool(server, 'tfs_update_pull_request', 'Updates a pull request from a partial TFS JSON body. Requires confirmUpdate.', UpdatePullRequestSchema, updatePullRequest);
  registerTool(server, 'tfs_complete_pull_request', 'Completes a pull request. Requires confirmComplete.', CompletePullRequestSchema, completePullRequest);
  registerTool(server, 'tfs_abandon_pull_request', 'Abandons a pull request. Requires confirmAbandon.', AbandonPullRequestSchema, abandonPullRequest);
  registerTool(server, 'tfs_list_pull_request_threads', 'Lists pull request discussion threads.', PullRequestSchema, listThreads);
  registerTool(server, 'tfs_get_pull_request_thread', 'Gets one pull request thread.', ThreadSchema, getThread);
  registerTool(server, 'tfs_create_pull_request_thread', 'Creates a pull request thread. Requires confirmCreate.', CreateThreadSchema, createThread);
  registerTool(server, 'tfs_update_pull_request_thread', 'Updates a pull request thread. Requires confirmUpdate.', UpdateThreadSchema, updateThread);
  registerTool(server, 'tfs_add_pull_request_comment', 'Adds a comment to a pull request thread. Requires confirmCreate.', AddCommentSchema, addComment);
  registerTool(server, 'tfs_update_pull_request_comment', 'Updates a pull request comment. Requires confirmUpdate.', UpdateCommentSchema, updateComment);
  registerTool(server, 'tfs_delete_pull_request_comment', 'Soft-deletes a pull request comment. Requires confirmDelete.', DeleteCommentSchema, deleteComment);
  registerTool(server, 'tfs_add_pull_request_reviewer', 'Adds a pull request reviewer. Requires confirmAdd.', AddReviewerSchema, addReviewer);
  registerTool(server, 'tfs_remove_pull_request_reviewer', 'Removes a pull request reviewer. Requires confirmRemove.', RemoveReviewerSchema, removeReviewer);
  registerTool(server, 'tfs_vote_pull_request', 'Sets the current reviewer vote on a pull request. Requires confirmVote.', VoteSchema, votePullRequest);
  registerTool(server, 'tfs_get_pull_request_work_items', 'Lists work items linked to a pull request.', PullRequestSchema, getPullRequestWorkItems);
  registerTool(server, 'tfs_add_pull_request_work_item', 'Links a work item to a pull request. Requires confirmAdd.', PullRequestWorkItemSchema, addPullRequestWorkItem);
}
