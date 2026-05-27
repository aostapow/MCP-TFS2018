import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfig } from '../config.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:dashboards-packaging');
const PREVIEW_API_VERSION = '4.1-preview';

const TeamSchema = z.object({ team: z.string().optional() });
const DashboardIdSchema = TeamSchema.extend({ dashboardId: z.string().min(1) });
const DashboardBodySchema = TeamSchema.extend({ body: z.record(z.unknown()) });
const UpdateDashboardSchema = DashboardIdSchema.extend({
  body: z.record(z.unknown()),
  confirmUpdate: z.boolean().optional().default(false),
});
const DeleteDashboardSchema = DashboardIdSchema.extend({
  confirmDelete: z.boolean().optional().default(false),
});
const WidgetIdSchema = DashboardIdSchema.extend({ widgetId: z.string().min(1) });
const WidgetBodySchema = DashboardIdSchema.extend({ body: z.record(z.unknown()) });
const UpdateWidgetSchema = WidgetIdSchema.extend({
  body: z.record(z.unknown()),
  confirmUpdate: z.boolean().optional().default(false),
});
const DeleteWidgetSchema = WidgetIdSchema.extend({ confirmDelete: z.boolean().optional().default(false) });

const FeedIdSchema = z.object({ feedId: z.string().min(1).describe('Feed ID or name') });
const FeedBodySchema = z.object({ body: z.record(z.unknown()).describe('Feed JSON body expected by TFS') });
const UpdateFeedSchema = FeedIdSchema.extend({ body: z.record(z.unknown()), confirmUpdate: z.boolean().optional().default(false) });
const DeleteFeedSchema = FeedIdSchema.extend({ confirmDelete: z.boolean().optional().default(false) });
const PackageSchema = FeedIdSchema.extend({ packageId: z.string().min(1).describe('Package ID') });
const PackageVersionSchema = PackageSchema.extend({ versionId: z.string().min(1).describe('Package version ID') });
const UpdatePackageVersionSchema = PackageVersionSchema.extend({ body: z.record(z.unknown()), confirmUpdate: z.boolean().optional().default(false) });
const DeletePackageVersionSchema = PackageVersionSchema.extend({ confirmDelete: z.boolean().optional().default(false) });
const UpdateFeedPermissionsSchema = FeedIdSchema.extend({ body: z.unknown(), confirmUpdate: z.boolean().optional().default(false) });

function teamDashboardUrl(resource: string, team?: string): string {
  const cfg = getConfig();
  const base = cfg.baseUrl.replace(/\/+$/, '') + '/' + cfg.collection + '/' + encodeURIComponent(cfg.project);
  const teamSegment = team ? '/' + encodeURIComponent(team) : '';
  return base + teamSegment + '/_apis/dashboard/' + resource.replace(/^\/+/, '');
}

function params(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, 'api-version': PREVIEW_API_VERSION };
}

async function listDashboards(args: z.infer<typeof TeamSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(teamDashboardUrl('dashboards', args.team), params());
  return JSON.stringify(result, null, 2);
}

async function getDashboard(args: z.infer<typeof DashboardIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(teamDashboardUrl('dashboards/' + args.dashboardId, args.team), params());
  return JSON.stringify(result, null, 2);
}

async function createDashboard(args: z.infer<typeof DashboardBodySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.post<unknown>(teamDashboardUrl('dashboards', args.team), args.body, params());
  log.info('Created dashboard');
  return JSON.stringify(result, null, 2);
}

async function updateDashboard(args: z.infer<typeof UpdateDashboardSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a dashboard.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(teamDashboardUrl('dashboards/' + args.dashboardId, args.team), args.body, params());
  log.info('Updated dashboard ' + args.dashboardId);
  return JSON.stringify(result, null, 2);
}

async function deleteDashboard(args: z.infer<typeof DeleteDashboardSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a dashboard.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(teamDashboardUrl('dashboards/' + args.dashboardId, args.team), params());
  log.info('Deleted dashboard ' + args.dashboardId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listWidgets(args: z.infer<typeof DashboardIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(teamDashboardUrl('dashboards/' + args.dashboardId + '/widgets', args.team), params());
  return JSON.stringify(result, null, 2);
}

async function getWidget(args: z.infer<typeof WidgetIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(teamDashboardUrl('dashboards/' + args.dashboardId + '/widgets/' + args.widgetId, args.team), params());
  return JSON.stringify(result, null, 2);
}

async function addWidget(args: z.infer<typeof WidgetBodySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.post<unknown>(teamDashboardUrl('dashboards/' + args.dashboardId + '/widgets', args.team), args.body, params());
  log.info('Added widget to dashboard ' + args.dashboardId);
  return JSON.stringify(result, null, 2);
}

async function updateWidget(args: z.infer<typeof UpdateWidgetSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a widget.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(teamDashboardUrl('dashboards/' + args.dashboardId + '/widgets/' + args.widgetId, args.team), args.body, params());
  log.info('Updated widget ' + args.widgetId);
  return JSON.stringify(result, null, 2);
}

async function deleteWidget(args: z.infer<typeof DeleteWidgetSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a widget.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(teamDashboardUrl('dashboards/' + args.dashboardId + '/widgets/' + args.widgetId, args.team), params());
  log.info('Deleted widget ' + args.widgetId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listFeeds(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('packaging/feeds', ''), params());
  return JSON.stringify(result, null, 2);
}

async function getFeed(args: z.infer<typeof FeedIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('packaging/feeds', args.feedId), params());
  return JSON.stringify(result, null, 2);
}

async function createFeed(args: z.infer<typeof FeedBodySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.post<unknown>(client.collectionApiUrl('packaging/feeds', ''), args.body, params());
  log.info('Created feed');
  return JSON.stringify(result, null, 2);
}

async function updateFeed(args: z.infer<typeof UpdateFeedSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a feed.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(client.collectionApiUrl('packaging/feeds', args.feedId), args.body, params());
  log.info('Updated feed ' + args.feedId);
  return JSON.stringify(result, null, 2);
}

async function deleteFeed(args: z.infer<typeof DeleteFeedSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a feed.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(client.collectionApiUrl('packaging/feeds', args.feedId), params());
  log.info('Deleted feed ' + args.feedId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listPackages(args: z.infer<typeof FeedIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('packaging/feeds', args.feedId + '/packages'), params());
  return JSON.stringify(result, null, 2);
}

async function getPackage(args: z.infer<typeof PackageSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('packaging/feeds', args.feedId + '/packages/' + args.packageId), params());
  return JSON.stringify(result, null, 2);
}

async function listPackageVersions(args: z.infer<typeof PackageSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('packaging/feeds', args.feedId + '/packages/' + args.packageId + '/versions'), params());
  return JSON.stringify(result, null, 2);
}

async function getPackageVersion(args: z.infer<typeof PackageVersionSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('packaging/feeds', args.feedId + '/packages/' + args.packageId + '/versions/' + args.versionId), params());
  return JSON.stringify(result, null, 2);
}

async function updatePackageVersion(args: z.infer<typeof UpdatePackageVersionSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update package version.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(client.collectionApiUrl('packaging/feeds', args.feedId + '/packages/' + args.packageId + '/versions/' + args.versionId), args.body, params());
  return JSON.stringify(result, null, 2);
}

async function deletePackageVersion(args: z.infer<typeof DeletePackageVersionSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete package version.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(client.collectionApiUrl('packaging/feeds', args.feedId + '/packages/' + args.packageId + '/versions/' + args.versionId), params());
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function listFeedPermissions(args: z.infer<typeof FeedIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('packaging/feeds', args.feedId + '/permissions'), params());
  return JSON.stringify(result, null, 2);
}

async function updateFeedPermissions(args: z.infer<typeof UpdateFeedPermissionsSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update feed permissions.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(client.collectionApiUrl('packaging/feeds', args.feedId + '/permissions'), args.body, params());
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

export function registerDashboardPackagingTools(server: McpServer): void {
  registerTool(server, 'tfs_list_dashboards', 'Lists dashboards.', TeamSchema, listDashboards);
  registerTool(server, 'tfs_get_dashboard', 'Gets one dashboard.', DashboardIdSchema, getDashboard);
  registerTool(server, 'tfs_create_dashboard', 'Creates a dashboard.', DashboardBodySchema, createDashboard);
  registerTool(server, 'tfs_update_dashboard', 'Updates a dashboard. Requires confirmUpdate.', UpdateDashboardSchema, updateDashboard);
  registerTool(server, 'tfs_delete_dashboard', 'Deletes a dashboard. Requires confirmDelete.', DeleteDashboardSchema, deleteDashboard);
  registerTool(server, 'tfs_list_widgets', 'Lists dashboard widgets.', DashboardIdSchema, listWidgets);
  registerTool(server, 'tfs_get_widget', 'Gets one dashboard widget.', WidgetIdSchema, getWidget);
  registerTool(server, 'tfs_add_widget', 'Adds a dashboard widget.', WidgetBodySchema, addWidget);
  registerTool(server, 'tfs_update_widget', 'Updates a dashboard widget. Requires confirmUpdate.', UpdateWidgetSchema, updateWidget);
  registerTool(server, 'tfs_delete_widget', 'Deletes a dashboard widget. Requires confirmDelete.', DeleteWidgetSchema, deleteWidget);
  registerTool(server, 'tfs_list_feeds', 'Lists Package Management feeds.', z.object({}), listFeeds);
  registerTool(server, 'tfs_get_feed', 'Gets one Package Management feed.', FeedIdSchema, getFeed);
  registerTool(server, 'tfs_create_feed', 'Creates a Package Management feed.', FeedBodySchema, createFeed);
  registerTool(server, 'tfs_update_feed', 'Updates a Package Management feed. Requires confirmUpdate.', UpdateFeedSchema, updateFeed);
  registerTool(server, 'tfs_delete_feed', 'Deletes a Package Management feed. Requires confirmDelete.', DeleteFeedSchema, deleteFeed);
  registerTool(server, 'tfs_list_packages', 'Lists packages in a feed.', FeedIdSchema, listPackages);
  registerTool(server, 'tfs_get_package', 'Gets one package.', PackageSchema, getPackage);
  registerTool(server, 'tfs_list_package_versions', 'Lists package versions.', PackageSchema, listPackageVersions);
  registerTool(server, 'tfs_get_package_version', 'Gets one package version.', PackageVersionSchema, getPackageVersion);
  registerTool(server, 'tfs_update_package_version', 'Updates a package version. Requires confirmUpdate.', UpdatePackageVersionSchema, updatePackageVersion);
  registerTool(server, 'tfs_delete_package_version', 'Deletes a package version. Requires confirmDelete.', DeletePackageVersionSchema, deletePackageVersion);
  registerTool(server, 'tfs_list_feed_permissions', 'Lists feed permissions.', FeedIdSchema, listFeedPermissions);
  registerTool(server, 'tfs_update_feed_permissions', 'Updates feed permissions. Requires confirmUpdate.', UpdateFeedPermissionsSchema, updateFeedPermissions);
}
