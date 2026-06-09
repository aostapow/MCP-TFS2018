import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from './config.js';
import { getTfsClient } from './tfs-client.js';
import { registerWorkItemTools } from './tools/workitems.js';
import { registerAdvancedWorkItemTools } from './tools/workitems-advanced.js';
import { registerTestCaseTools } from './tools/testcases.js';
import { registerAdvancedTestCaseTools } from './tools/testcases-advanced.js';
import { registerBuildTools } from './tools/builds.js';
import { registerAdvancedBuildTools } from './tools/builds-advanced.js';
import { registerReleaseTools } from './tools/releases.js';
import { registerSourceControlTools } from './tools/sourcecontrol.js';
import { registerAdvancedSourceControlTools } from './tools/sourcecontrol-advanced.js';
import { registerGitTools } from './tools/git.js';
import { registerAdvancedGitTools } from './tools/git-advanced.js';
import { registerWorkTools } from './tools/work.js';
import { registerAdminTools } from './tools/admin.js';
import { registerPolicyTools } from './tools/policy.js';
import { registerIntegrationTools } from './tools/integrations.js';
import { registerSecurityTools } from './tools/security.js';
import { registerDashboardPackagingTools } from './tools/dashboards-packaging.js';
import { registerRestTools } from './tools/rest.js';
import { createChildLogger } from './utils/logger.js';
import { formatErrorForMcp } from './utils/errors.js';
import { APP_VERSION, REPO_SLUG } from './version.js';
import { checkForUpdates } from './utils/version-check.js';

const log = createChildLogger('server');

// Named schema constants so callback args are properly typed
const ListProjectsSchema = z.object({
  top: z.number().int().positive().max(100).optional().default(50)
    .describe('Maximum number of projects to return'),
  stateFilter: z.enum(['wellFormed', 'creating', 'deleting', 'all']).optional().default('wellFormed')
    .describe('Filter projects by state'),
});

const ListTeamsSchema = z.object({
  top: z.number().int().positive().max(100).optional().default(20).describe('Maximum teams to return'),
  skip: z.number().int().nonnegative().optional().default(0).describe('Teams to skip'),
});

const ListIterationsSchema = z.object({
  team: z.string().optional().describe('Team name (uses default team if omitted)'),
  timeframe: z.enum(['past', 'current', 'future']).optional()
    .describe('Filter by timeframe relative to today'),
});

const ListAreaPathsSchema = z.object({
  depth: z.number().int().nonnegative().optional().default(5)
    .describe('Depth of the area tree to return'),
});

const GetTeamMembersSchema = z.object({
  team: z.string().optional().describe('Team name. Defaults to the project default team.'),
  top: z.number().int().positive().max(200).optional().default(100).describe('Maximum members'),
  skip: z.number().int().nonnegative().optional().default(0),
});

const SearchIdentitiesSchema = z.object({
  query: z.string().min(2).describe('Display name, email prefix, or account name to search for'),
  top: z.number().int().positive().max(50).optional().default(10).describe('Maximum results'),
});

export function createServer(): McpServer {
  const config = getConfig();

  const server = new McpServer(
    { name: 'mcp-tfs2018', version: APP_VERSION },
    { capabilities: { tools: {} } },
  );

  log.info('Initializing MCP TFS 2018 server', {
    tfsUrl: config.baseUrl,
    collection: config.collection,
    project: config.project,
    authType: config.auth.type,
  });

  server.tool(
    'tfs_ping',
    'Checks connectivity to the TFS server and returns version/project information.',
    {},
    async () => {
      try {
        const client = getTfsClient();
        const alive = await client.ping();
        const cfg = getConfig();
        const info = {
          connected: alive,
          server: cfg.baseUrl,
          collection: cfg.collection,
          project: cfg.project,
          apiVersion: cfg.apiVersion,
          authType: cfg.auth.type,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_server_info',
    'Returns MCP server version, Node.js runtime info, and whether a newer release is available on GitHub.',
    {},
    async () => {
      try {
        const updateInfo = await checkForUpdates({ force: true });
        const info = {
          mcpServerName: 'mcp-tfs2018',
          mcpServerVersion: APP_VERSION,
          nodeVersion: process.version,
          installPath: process.cwd(),
          updateAvailable: updateInfo.updateAvailable,
          latestVersion: updateInfo.latest,
          releaseUrl: updateInfo.releaseUrl ?? `https://github.com/${REPO_SLUG}/releases/latest`,
          releaseNotes: updateInfo.releaseNotes,
          updateCommand: 'npm run update',
          repository: `https://github.com/${REPO_SLUG}`,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_projects',
    'Lists all TFS team projects in the configured collection.',
    ListProjectsSchema.shape,
    async (args: z.infer<typeof ListProjectsSchema>) => {
      try {
        const client = getTfsClient();
        const url = client.collectionApiUrl('projects', '');
        const result = await client.get(url, { $top: args.top, stateFilter: args.stateFilter });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        log.error('tfs_list_projects failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_project',
    'Gets detailed information about the configured TFS project, including capabilities and process template.',
    {},
    async () => {
      try {
        const client = getTfsClient();
        const cfg = getConfig();
        const url = client.collectionApiUrl('projects', encodeURIComponent(cfg.project));
        const result = await client.get(url, { includeCapabilities: true });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        log.error('tfs_get_project failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_teams',
    'Lists teams in the configured TFS project.',
    ListTeamsSchema.shape,
    async (args: z.infer<typeof ListTeamsSchema>) => {
      try {
        const client = getTfsClient();
        const cfg = getConfig();
        const url = client.collectionApiUrl('projects',
          encodeURIComponent(cfg.project) + '/teams');
        const result = await client.get(url, { $top: args.top, $skip: args.skip });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        log.error('tfs_list_teams failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_iterations',
    'Lists sprint iterations for the project or a specific team.',
    ListIterationsSchema.shape,
    async (args: z.infer<typeof ListIterationsSchema>) => {
      try {
        const client = getTfsClient();
        const cfg = getConfig();
        // TFS 2018 work iterations endpoint:
        // /{collection}/{project}/_apis/work/TeamSettings/Iterations
        // /{collection}/{project}/{team}/_apis/work/TeamSettings/Iterations
        const collBase = cfg.baseUrl.replace(/\/+$/, '') + '/' + cfg.collection;
        const teamSeg = args.team
          ? encodeURIComponent(cfg.project) + '/' + encodeURIComponent(args.team)
          : encodeURIComponent(cfg.project);
        const url = collBase + '/' + teamSeg + '/_apis/work/TeamSettings/Iterations';
        const params: Record<string, unknown> = {};
        if (args.timeframe) params.$timeframe = args.timeframe;
        const result = await client.get(url, params);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        log.error('tfs_list_iterations failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_area_paths',
    'Lists area paths (hierarchical classification nodes) for the project.',
    ListAreaPathsSchema.shape,
    async (args: z.infer<typeof ListAreaPathsSchema>) => {
      try {
        const client = getTfsClient();
        // Pass $depth as a proper query parameter, not embedded in the URL string
        const url = client.projectApiUrl('wit/classificationnodes', 'areas');
        const result = await client.get(url, { '$depth': args.depth });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        log.error('tfs_list_area_paths failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  registerWorkItemTools(server);
  log.debug('Work item tools registered');

  registerAdvancedWorkItemTools(server);
  log.debug('Advanced work item tools registered');

  registerTestCaseTools(server);
  log.debug('Test case tools registered');

  registerAdvancedTestCaseTools(server);
  log.debug('Advanced test case tools registered');

  registerBuildTools(server);
  log.debug('Build tools registered');

  registerAdvancedBuildTools(server);
  log.debug('Advanced build tools registered');

  registerReleaseTools(server);
  log.debug('Release tools registered');

  registerSourceControlTools(server);
  log.debug('Source control tools registered');

  registerAdvancedSourceControlTools(server);
  log.debug('Advanced source control tools registered');

  registerGitTools(server);
  log.debug('Git tools registered');

  registerAdvancedGitTools(server);
  log.debug('Advanced Git tools registered');

  registerWorkTools(server);
  log.debug('Work/Boards tools registered');

  registerAdminTools(server);
  log.debug('Admin/Identity tools registered');

  registerPolicyTools(server);
  log.debug('Policy tools registered');

  registerIntegrationTools(server);
  log.debug('Integration tools registered');

  registerSecurityTools(server);
  log.debug('Security tools registered');

  registerDashboardPackagingTools(server);
  log.debug('Dashboard/Packaging tools registered');

  registerRestTools(server);
  log.debug('Generic REST tools registered');

  // Team members and identity tools
  server.tool(
    'tfs_get_team_members',
    'Lists all members of a team in the project, including their display names, email addresses, and whether they are team admins.',
    GetTeamMembersSchema.shape,
    async (args: z.infer<typeof GetTeamMembersSchema>) => {
      try {
        const client = getTfsClient();
        const cfg = getConfig();
        const teamName = args.team ?? cfg.project + ' Team';
        const url = client.collectionApiUrl(
          'projects',
          encodeURIComponent(cfg.project) + '/teams/' + encodeURIComponent(teamName) + '/members',
        );
        const result = await client.get(url, { $top: args.top, $skip: args.skip });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        log.error('tfs_get_team_members failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_search_identities',
    'Searches for TFS users or groups by display name, email, or account name. Useful for finding the correct identity string before assigning work items.',
    SearchIdentitiesSchema.shape,
    async (args: z.infer<typeof SearchIdentitiesSchema>) => {
      try {
        const client = getTfsClient();
        // TFS 2018 identity search endpoint
        const url = client.collectionApiUrl('identities', '');
        const result = await client.get(url, {
          searchFilter: 'DisplayName',
          filterValue: args.query,
          queryMembership: 'None',
          $top: args.top,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        log.error('tfs_search_identities failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  log.info('MCP server initialized - all tools registered');

  return server;
}
