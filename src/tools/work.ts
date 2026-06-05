import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfig } from '../config.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:work');
const WORK_API_VERSION = '4.1-preview';

const TeamSchema = z.object({
  team: z.string().optional().describe('Optional team name. Defaults to project-level work endpoint.'),
  projectIdOrName: z.string().optional().describe('Project ID or name. Defaults to configured project.'),
});

const BoardSchema = TeamSchema.extend({
  board: z.string().min(1).describe('Board ID or board name'),
});

const UpdateBoardPartSchema = BoardSchema.extend({
  body: z.unknown().describe('JSON body expected by the TFS Work API'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update board settings'),
});

const ChartSchema = BoardSchema.extend({
  chart: z.string().min(1).describe('Chart name, e.g. cumulativeFlow'),
});

const UpdateChartSchema = ChartSchema.extend({
  body: z.record(z.unknown()).describe('Chart update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a board chart'),
});

const BacklogSchema = TeamSchema.extend({
  backlogId: z.string().min(1).describe('Backlog ID or name'),
});

const UpdateTeamSettingsSchema = TeamSchema.extend({
  body: z.record(z.unknown()).describe('Team settings update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update team settings'),
});

const UpdateTeamFieldValuesSchema = TeamSchema.extend({
  body: z.record(z.unknown()).describe('Team field values update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update team field values'),
});

const IterationsSchema = TeamSchema.extend({
  timeframe: z.enum(['past', 'current', 'future']).optional().describe('Optional iteration timeframe filter'),
});

const TeamIterationSchema = TeamSchema.extend({
  iterationId: z.string().min(1).describe('Iteration GUID or identifier'),
});

const AddTeamIterationSchema = TeamIterationSchema.extend({
  confirmAdd: z.boolean().optional().default(false).describe('Required to add a team iteration'),
});

const RemoveTeamIterationSchema = TeamIterationSchema.extend({
  confirmRemove: z.boolean().optional().default(false).describe('Required to remove a team iteration'),
});

const CapacitySchema = TeamIterationSchema.extend({});

const MemberCapacitySchema = CapacitySchema.extend({
  teamMemberId: z.string().min(1).describe('Team member identity ID'),
});

const UpdateMemberCapacitySchema = MemberCapacitySchema.extend({
  body: z.record(z.unknown()).describe('Capacity update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update capacity'),
});

const UpdateDaysOffSchema = CapacitySchema.extend({
  body: z.record(z.unknown()).describe('Days off update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update team days off'),
});

function workUrl(resource: string, team?: string, project?: string): string {
  const cfg = getConfig();
  const cleanBase = cfg.baseUrl.replace(/\/+$/, '');
  const proj = encodeURIComponent(project ?? cfg.project);
  const teamSegment = team ? '/' + encodeURIComponent(team) : '';
  const cleanResource = resource.replace(/^\/+/, '');
  return cleanBase + '/' + cfg.collection + '/' + proj + teamSegment + '/_apis/work/' + cleanResource;
}

function workParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, 'api-version': WORK_API_VERSION };
}

async function listBoards(args: z.infer<typeof TeamSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(workUrl('boards', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function getBoard(args: z.infer<typeof BoardSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('boards/' + encodeURIComponent(args.board), args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function getBoardColumns(args: z.infer<typeof BoardSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/columns', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function updateBoardColumns(args: z.infer<typeof UpdateBoardPartSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update board columns.');
  const client = getTfsClient();
  const result = await client.put<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/columns', args.team, args.projectIdOrName), args.body, workParams());
  log.info('Updated columns for board ' + args.board);
  return JSON.stringify(result, null, 2);
}

async function getBoardRows(args: z.infer<typeof BoardSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/rows', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function updateBoardRows(args: z.infer<typeof UpdateBoardPartSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update board rows.');
  const client = getTfsClient();
  const result = await client.put<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/rows', args.team, args.projectIdOrName), args.body, workParams());
  log.info('Updated rows for board ' + args.board);
  return JSON.stringify(result, null, 2);
}

async function getCardFields(args: z.infer<typeof BoardSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/cardsettings', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function updateCardFields(args: z.infer<typeof UpdateBoardPartSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update board card fields.');
  const client = getTfsClient();
  const result = await client.put<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/cardsettings', args.team, args.projectIdOrName), args.body, workParams());
  log.info('Updated card fields/settings for board ' + args.board);
  return JSON.stringify(result, null, 2);
}

async function getCardRules(args: z.infer<typeof BoardSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/cardrulesettings', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function updateCardRules(args: z.infer<typeof UpdateBoardPartSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update board card rules.');
  const client = getTfsClient();
  const result = await client.put<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/cardrulesettings', args.team, args.projectIdOrName), args.body, workParams());
  log.info('Updated card rules for board ' + args.board);
  return JSON.stringify(result, null, 2);
}

async function listBoardCharts(args: z.infer<typeof BoardSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(workUrl('boards/' + encodeURIComponent(args.board) + '/charts', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function getBoardChart(args: z.infer<typeof ChartSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('boards/' + encodeURIComponent(args.board) + '/charts/' + encodeURIComponent(args.chart), args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function updateBoardChart(args: z.infer<typeof UpdateChartSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a board chart.');
  const client = getTfsClient();
  const result = await client.put<unknown>(
    workUrl('boards/' + encodeURIComponent(args.board) + '/charts/' + encodeURIComponent(args.chart), args.team, args.projectIdOrName),
    args.body,
    workParams(),
  );
  log.info('Updated chart ' + args.chart + ' for board ' + args.board);
  return JSON.stringify(result, null, 2);
}

async function listBacklogs(args: z.infer<typeof TeamSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(workUrl('backlogs', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function getBacklog(args: z.infer<typeof BacklogSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('backlogs/' + encodeURIComponent(args.backlogId), args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function getBacklogWorkItems(args: z.infer<typeof BacklogSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('backlogs/' + encodeURIComponent(args.backlogId) + '/workItems', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function getProcessConfiguration(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('processconfiguration'), workParams());
  return JSON.stringify(result, null, 2);
}

async function getTeamSettings(args: z.infer<typeof TeamSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('teamsettings', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function updateTeamSettings(args: z.infer<typeof UpdateTeamSettingsSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update team settings.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(workUrl('teamsettings', args.team, args.projectIdOrName), args.body, workParams());
  log.info('Updated team settings' + (args.team ? ' for ' + args.team : ''));
  return JSON.stringify(result, null, 2);
}

async function getTeamFieldValues(args: z.infer<typeof TeamSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('teamsettings/teamfieldvalues', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function updateTeamFieldValues(args: z.infer<typeof UpdateTeamFieldValuesSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update team field values.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(workUrl('teamsettings/teamfieldvalues', args.team, args.projectIdOrName), args.body, workParams());
  log.info('Updated team field values' + (args.team ? ' for ' + args.team : ''));
  return JSON.stringify(result, null, 2);
}

async function getTeamIterations(args: z.infer<typeof IterationsSchema>): Promise<string> {
  const client = getTfsClient();
  const params: Record<string, unknown> = {};
  if (args.timeframe) params.$timeframe = args.timeframe;
  const result = await client.get<TfsListResponse<unknown>>(workUrl('teamsettings/iterations', args.team, args.projectIdOrName), workParams(params));
  return JSON.stringify(result, null, 2);
}

async function addTeamIteration(args: z.infer<typeof AddTeamIterationSchema>): Promise<string> {
  if (!args.confirmAdd) throw new Error('confirmAdd=true is required to add a team iteration.');
  const client = getTfsClient();
  const result = await client.post<unknown>(workUrl('teamsettings/iterations/' + encodeURIComponent(args.iterationId), args.team, args.projectIdOrName), {}, workParams());
  log.info('Added team iteration ' + args.iterationId);
  return JSON.stringify(result, null, 2);
}

async function removeTeamIteration(args: z.infer<typeof RemoveTeamIterationSchema>): Promise<string> {
  if (!args.confirmRemove) throw new Error('confirmRemove=true is required to remove a team iteration.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(workUrl('teamsettings/iterations/' + encodeURIComponent(args.iterationId), args.team, args.projectIdOrName), workParams());
  log.info('Removed team iteration ' + args.iterationId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function getTeamCapacity(args: z.infer<typeof CapacitySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(workUrl('teamsettings/iterations/' + encodeURIComponent(args.iterationId) + '/capacities', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function getTeamMemberCapacity(args: z.infer<typeof MemberCapacitySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(
    workUrl('teamsettings/iterations/' + encodeURIComponent(args.iterationId) + '/capacities/' + encodeURIComponent(args.teamMemberId), args.team, args.projectIdOrName),
    workParams(),
  );
  return JSON.stringify(result, null, 2);
}

async function updateTeamMemberCapacity(args: z.infer<typeof UpdateMemberCapacitySchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update team member capacity.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(
    workUrl('teamsettings/iterations/' + encodeURIComponent(args.iterationId) + '/capacities/' + encodeURIComponent(args.teamMemberId), args.team, args.projectIdOrName),
    args.body,
    workParams(),
  );
  log.info('Updated capacity for team member ' + args.teamMemberId);
  return JSON.stringify(result, null, 2);
}

async function getTeamDaysOff(args: z.infer<typeof CapacitySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(workUrl('teamsettings/iterations/' + encodeURIComponent(args.iterationId) + '/teamdaysoff', args.team, args.projectIdOrName), workParams());
  return JSON.stringify(result, null, 2);
}

async function updateTeamDaysOff(args: z.infer<typeof UpdateDaysOffSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update team days off.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(
    workUrl('teamsettings/iterations/' + encodeURIComponent(args.iterationId) + '/teamdaysoff', args.team, args.projectIdOrName),
    args.body,
    workParams(),
  );
  log.info('Updated team days off for iteration ' + args.iterationId);
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

export function registerWorkTools(server: McpServer): void {
  registerTool(server, 'tfs_list_boards', 'Lists boards for a team or project.', TeamSchema, listBoards);
  registerTool(server, 'tfs_get_board', 'Gets one board by ID or name.', BoardSchema, getBoard);
  registerTool(server, 'tfs_get_board_columns', 'Gets board column settings.', BoardSchema, getBoardColumns);
  registerTool(server, 'tfs_update_board_columns', 'Updates board column settings. Requires confirmUpdate.', UpdateBoardPartSchema, updateBoardColumns);
  registerTool(server, 'tfs_get_board_rows', 'Gets board row settings.', BoardSchema, getBoardRows);
  registerTool(server, 'tfs_update_board_rows', 'Updates board row settings. Requires confirmUpdate.', UpdateBoardPartSchema, updateBoardRows);
  registerTool(server, 'tfs_get_board_card_fields', 'Gets board card field settings.', BoardSchema, getCardFields);
  registerTool(server, 'tfs_update_board_card_fields', 'Updates board card field settings. Requires confirmUpdate.', UpdateBoardPartSchema, updateCardFields);
  registerTool(server, 'tfs_get_board_card_rules', 'Gets board card rule settings.', BoardSchema, getCardRules);
  registerTool(server, 'tfs_update_board_card_rules', 'Updates board card rule settings. Requires confirmUpdate.', UpdateBoardPartSchema, updateCardRules);
  registerTool(server, 'tfs_get_board_charts', 'Lists charts for a board.', BoardSchema, listBoardCharts);
  registerTool(server, 'tfs_get_board_chart', 'Gets one board chart.', ChartSchema, getBoardChart);
  registerTool(server, 'tfs_update_board_chart', 'Updates one board chart. Requires confirmUpdate.', UpdateChartSchema, updateBoardChart);
  registerTool(server, 'tfs_list_backlogs', 'Lists team backlogs.', TeamSchema, listBacklogs);
  registerTool(server, 'tfs_get_backlog', 'Gets one team backlog.', BacklogSchema, getBacklog);
  registerTool(server, 'tfs_get_backlog_work_items', 'Gets work items for a team backlog.', BacklogSchema, getBacklogWorkItems);
  registerTool(server, 'tfs_get_process_configuration', 'Gets project process configuration for Agile experiences.', z.object({}), getProcessConfiguration);
  registerTool(server, 'tfs_get_team_settings', 'Gets team work settings.', TeamSchema, getTeamSettings);
  registerTool(server, 'tfs_update_team_settings', 'Updates team work settings. Requires confirmUpdate.', UpdateTeamSettingsSchema, updateTeamSettings);
  registerTool(server, 'tfs_get_team_field_values', 'Gets team field values / owned areas.', TeamSchema, getTeamFieldValues);
  registerTool(server, 'tfs_update_team_field_values', 'Updates team field values / owned areas. Requires confirmUpdate.', UpdateTeamFieldValuesSchema, updateTeamFieldValues);
  registerTool(server, 'tfs_get_team_iterations', 'Lists team iterations.', IterationsSchema, getTeamIterations);
  registerTool(server, 'tfs_add_team_iteration', 'Adds an iteration to a team. Requires confirmAdd.', AddTeamIterationSchema, addTeamIteration);
  registerTool(server, 'tfs_remove_team_iteration', 'Removes an iteration from a team. Requires confirmRemove.', RemoveTeamIterationSchema, removeTeamIteration);
  registerTool(server, 'tfs_get_team_capacity', 'Gets team capacity for an iteration.', CapacitySchema, getTeamCapacity);
  registerTool(server, 'tfs_get_team_member_capacity', 'Gets one team member capacity for an iteration.', MemberCapacitySchema, getTeamMemberCapacity);
  registerTool(server, 'tfs_update_team_member_capacity', 'Updates one team member capacity. Requires confirmUpdate.', UpdateMemberCapacitySchema, updateTeamMemberCapacity);
  registerTool(server, 'tfs_get_team_days_off', 'Gets team days off for an iteration.', CapacitySchema, getTeamDaysOff);
  registerTool(server, 'tfs_update_team_days_off', 'Updates team days off for an iteration. Requires confirmUpdate.', UpdateDaysOffSchema, updateTeamDaysOff);
}
