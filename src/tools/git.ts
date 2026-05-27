import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type {
  GitRepository,
  GitRef,
  GitCommitRef,
  GitPullRequest,
  GitItem,
  TfsListResponse,
} from '../types/tfs.js';

const log = createChildLogger('tool:git');

// ─── Input schemas ────────────────────────────────────────────────────────────

const ListGitReposSchema = z.object({
  includeHidden: z.boolean().optional().default(false)
    .describe('Include hidden repositories'),
  includeAllUrls: z.boolean().optional().default(false)
    .describe('Include all clone URLs (SSH, HTTPS, etc.)'),
});

const ListGitBranchesSchema = z.object({
  repositoryId: z.string().min(1).describe('Repository name or GUID'),
  filter: z.string().optional().describe('Filter branches by name prefix (e.g. "feature/")'),
  top: z.number().int().positive().max(200).optional().default(50).describe('Maximum branches'),
});

const ListGitCommitsSchema = z.object({
  repositoryId: z.string().min(1).describe('Repository name or GUID'),
  branch: z.string().optional().describe('Branch or ref name (e.g. "main", "refs/heads/dev"). Defaults to default branch.'),
  author: z.string().optional().describe('Filter by author display name or email'),
  fromDate: z.string().optional().describe('ISO 8601 start date'),
  toDate: z.string().optional().describe('ISO 8601 end date'),
  top: z.number().int().positive().max(100).optional().default(20).describe('Maximum commits'),
  skip: z.number().int().nonnegative().optional().default(0),
});

const GetGitCommitSchema = z.object({
  repositoryId: z.string().min(1).describe('Repository name or GUID'),
  commitId: z.string().min(1).describe('Full or abbreviated commit SHA'),
  changeCount: z.number().int().nonnegative().optional().default(0)
    .describe('Number of file changes to include (0 = none)'),
});

const GetGitFileContentSchema = z.object({
  repositoryId: z.string().min(1).describe('Repository name or GUID'),
  path: z.string().min(1).describe('File path within the repo (e.g. /src/Program.cs)'),
  branch: z.string().optional().describe('Branch name or commit SHA. Defaults to default branch.'),
});

const ListGitItemsSchema = z.object({
  repositoryId: z.string().min(1).describe('Repository name or GUID'),
  path: z.string().optional().default('/').describe('Folder path to list (e.g. /src)'),
  branch: z.string().optional().describe('Branch or commit SHA. Defaults to default branch.'),
  recursionLevel: z.enum(['none', 'oneLevel', 'full']).optional().default('oneLevel')
    .describe('Directory recursion depth'),
});

const ListGitPullRequestsSchema = z.object({
  repositoryId: z.string().min(1).describe('Repository name or GUID'),
  status: z.enum(['active', 'abandoned', 'completed', 'all']).optional().default('active')
    .describe('Filter by pull request status'),
  creatorId: z.string().optional().describe('Filter by creator display name or email'),
  reviewerId: z.string().optional().describe('Filter by reviewer display name or email'),
  targetBranch: z.string().optional()
    .describe('Filter by target branch (e.g. "refs/heads/main")'),
  top: z.number().int().positive().max(100).optional().default(20),
});

const GetGitPullRequestSchema = z.object({
  repositoryId: z.string().min(1).describe('Repository name or GUID'),
  pullRequestId: z.number().int().positive().describe('Pull request ID'),
});

// ─── Tool implementations ─────────────────────────────────────────────────────

async function listGitRepos(args: z.infer<typeof ListGitReposSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('git/repositories', '');
  const params: Record<string, unknown> = {};
  if (args.includeHidden) params.includeHidden = true;
  if (args.includeAllUrls) params.includeAllUrls = true;
  const result = await client.get<TfsListResponse<GitRepository>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function listGitBranches(args: z.infer<typeof ListGitBranchesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/refs');
  const params: Record<string, unknown> = {
    filter: 'heads/' + (args.filter ?? ''),
    $top: args.top,
  };
  const result = await client.get<TfsListResponse<GitRef>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function listGitCommits(args: z.infer<typeof ListGitCommitsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/commits');
  const params: Record<string, unknown> = { $top: args.top, $skip: args.skip };
  if (args.branch) params['searchCriteria.itemVersion.version'] = args.branch;
  if (args.author) params['searchCriteria.author'] = args.author;
  if (args.fromDate) params['searchCriteria.fromDate'] = args.fromDate;
  if (args.toDate) params['searchCriteria.toDate'] = args.toDate;
  const result = await client.get<TfsListResponse<GitCommitRef>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getGitCommit(args: z.infer<typeof GetGitCommitSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/commits/' + args.commitId);
  const params: Record<string, unknown> = {};
  if (args.changeCount > 0) params.changeCount = args.changeCount;
  const commit = await client.get<GitCommitRef>(url, params);
  return JSON.stringify(commit, null, 2);
}

async function getGitFileContent(args: z.infer<typeof GetGitFileContentSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/items');
  const params: Record<string, unknown> = {
    path: args.path,
    $format: 'text',
    includeContent: true,
  };
  if (args.branch) {
    params['versionDescriptor.version'] = args.branch;
    params['versionDescriptor.versionType'] = 'branch';
  }
  const content = await client.get<string>(url, params);
  return typeof content === 'string' ? content : JSON.stringify(content);
}

async function listGitItems(args: z.infer<typeof ListGitItemsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/items');
  const params: Record<string, unknown> = {
    scopePath: args.path,
    recursionLevel: args.recursionLevel,
    includeContentMetadata: true,
  };
  if (args.branch) {
    params['versionDescriptor.version'] = args.branch;
    params['versionDescriptor.versionType'] = 'branch';
  }
  const result = await client.get<TfsListResponse<GitItem>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function listGitPullRequests(args: z.infer<typeof ListGitPullRequestsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl('git/repositories', args.repositoryId + '/pullrequests');
  const params: Record<string, unknown> = {
    'searchCriteria.status': args.status,
    $top: args.top,
  };
  if (args.creatorId) params['searchCriteria.creatorId'] = args.creatorId;
  if (args.reviewerId) params['searchCriteria.reviewerId'] = args.reviewerId;
  if (args.targetBranch) params['searchCriteria.targetRefName'] = args.targetBranch;
  const result = await client.get<TfsListResponse<GitPullRequest>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getGitPullRequest(args: z.infer<typeof GetGitPullRequestSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.projectApiUrl(
    'git/repositories',
    args.repositoryId + '/pullrequests/' + args.pullRequestId,
  );
  const pr = await client.get<GitPullRequest>(url);
  return JSON.stringify(pr, null, 2);
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerGitTools(server: McpServer): void {
  server.tool(
    'tfs_list_git_repos',
    'Lists all Git repositories hosted in the TFS project. TFS 2018 supports both TFVC and Git repos in the same project.',
    ListGitReposSchema.shape,
    async (args: z.infer<typeof ListGitReposSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listGitRepos(args) }] };
      } catch (err) {
        log.error('tfs_list_git_repos failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_git_branches',
    'Lists branches in a Git repository hosted in TFS.',
    ListGitBranchesSchema.shape,
    async (args: z.infer<typeof ListGitBranchesSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listGitBranches(args) }] };
      } catch (err) {
        log.error('tfs_list_git_branches failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_git_commits',
    'Lists commits in a Git repository with filters for branch, author, and date range.',
    ListGitCommitsSchema.shape,
    async (args: z.infer<typeof ListGitCommitsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listGitCommits(args) }] };
      } catch (err) {
        log.error('tfs_list_git_commits failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_git_commit',
    'Gets detailed information about a specific Git commit including author, message, and optionally file changes.',
    GetGitCommitSchema.shape,
    async (args: z.infer<typeof GetGitCommitSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getGitCommit(args) }] };
      } catch (err) {
        log.error('tfs_get_git_commit failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_git_file_content',
    'Retrieves the raw text content of a file from a Git repository in TFS, at a specific branch or commit.',
    GetGitFileContentSchema.shape,
    async (args: z.infer<typeof GetGitFileContentSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getGitFileContent(args) }] };
      } catch (err) {
        log.error('tfs_get_git_file_content failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_git_items',
    'Lists files and folders in a Git repository directory at a specific branch or commit.',
    ListGitItemsSchema.shape,
    async (args: z.infer<typeof ListGitItemsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listGitItems(args) }] };
      } catch (err) {
        log.error('tfs_list_git_items failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_git_pull_requests',
    'Lists pull requests in a Git repository, filterable by status (active/completed/abandoned), creator, reviewer, and target branch.',
    ListGitPullRequestsSchema.shape,
    async (args: z.infer<typeof ListGitPullRequestsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listGitPullRequests(args) }] };
      } catch (err) {
        log.error('tfs_list_git_pull_requests failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_git_pull_request',
    'Gets full details of a specific Git pull request including reviewers, their votes, source/target branches, and merge status.',
    GetGitPullRequestSchema.shape,
    async (args: z.infer<typeof GetGitPullRequestSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getGitPullRequest(args) }] };
      } catch (err) {
        log.error('tfs_get_git_pull_request failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );
}
