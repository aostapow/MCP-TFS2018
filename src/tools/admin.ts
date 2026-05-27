import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfig } from '../config.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:admin');

const CreateProjectSchema = z.object({
  body: z.record(z.unknown()).describe('Full project creation JSON body expected by TFS'),
  confirmCreate: z.boolean().optional().default(false).describe('Required to create a project'),
});

const ProjectIdSchema = z.object({
  projectIdOrName: z.string().min(1).describe('Project ID or project name'),
});

const UpdateProjectSchema = ProjectIdSchema.extend({
  body: z.record(z.unknown()).describe('Project update JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a project'),
});

const DeleteProjectSchema = ProjectIdSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a project'),
});

const ProjectPropertiesSchema = ProjectIdSchema.extend({
  keys: z.array(z.string()).optional().describe('Optional project property keys to retrieve'),
});

const UpdateProjectPropertiesSchema = ProjectIdSchema.extend({
  properties: z.array(z.record(z.unknown())).min(1).describe('Property update objects expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update project properties'),
});

const CreateTeamSchema = z.object({
  projectIdOrName: z.string().optional().describe('Project ID/name. Defaults to configured project.'),
  name: z.string().min(1).describe('Team name'),
  description: z.string().optional(),
  confirmCreate: z.boolean().optional().default(false).describe('Required to create a team'),
});

const TeamSchema = z.object({
  projectIdOrName: z.string().optional().describe('Project ID/name. Defaults to configured project.'),
  teamIdOrName: z.string().min(1).describe('Team ID or team name'),
});

const UpdateTeamSchema = TeamSchema.extend({
  name: z.string().optional(),
  description: z.string().optional(),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a team'),
});

const DeleteTeamSchema = TeamSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a team'),
});

const TeamMemberSchema = TeamSchema.extend({
  memberId: z.string().min(1).describe('Identity ID/descriptor of the member'),
});

const AddTeamMemberSchema = TeamMemberSchema.extend({
  confirmAdd: z.boolean().optional().default(false).describe('Required to add a team member'),
});

const RemoveTeamMemberSchema = TeamMemberSchema.extend({
  confirmRemove: z.boolean().optional().default(false).describe('Required to remove a team member'),
});

const GetIdentitySchema = z.object({
  identityId: z.string().min(1).describe('Identity ID, descriptor, or unique name'),
  queryMembership: z.enum(['None', 'Direct', 'Expanded']).optional().default('Direct'),
});

const ListIdentitiesSchema = z.object({
  searchFilter: z.string().optional().default('General').describe('Search filter, e.g. General, DisplayName, AccountName'),
  filterValue: z.string().optional().describe('Search value'),
  queryMembership: z.enum(['None', 'Direct', 'Expanded']).optional().default('None'),
  top: z.number().int().positive().max(200).optional().default(50),
});

const MembershipSchema = z.object({
  identityId: z.string().min(1).describe('Identity ID or descriptor'),
  queryMembership: z.enum(['None', 'Direct', 'Expanded']).optional().default('Expanded'),
});

function projectName(value?: string): string {
  return value ?? getConfig().project;
}

function projectResource(projectIdOrName: string): string {
  return encodeURIComponent(projectIdOrName);
}

function teamResource(projectIdOrName: string, teamIdOrName: string): string {
  return projectResource(projectIdOrName) + '/teams/' + encodeURIComponent(teamIdOrName);
}

async function createProject(args: z.infer<typeof CreateProjectSchema>): Promise<string> {
  if (!args.confirmCreate) throw new Error('confirmCreate=true is required to create a project.');
  const client = getTfsClient();
  const result = await client.post<unknown>(client.collectionApiUrl('projects', ''), args.body);
  log.info('Created project request');
  return JSON.stringify(result, null, 2);
}

async function updateProject(args: z.infer<typeof UpdateProjectSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a project.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(client.collectionApiUrl('projects', projectResource(args.projectIdOrName)), args.body);
  log.info('Updated project ' + args.projectIdOrName);
  return JSON.stringify(result, null, 2);
}

async function deleteProject(args: z.infer<typeof DeleteProjectSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a project.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(client.collectionApiUrl('projects', projectResource(args.projectIdOrName)));
  log.info('Deleted project ' + args.projectIdOrName);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function getProjectProperties(args: z.infer<typeof ProjectPropertiesSchema>): Promise<string> {
  const client = getTfsClient();
  const params = args.keys?.length ? { keys: args.keys.join(',') } : undefined;
  const result = await client.get<unknown>(client.collectionApiUrl('projects', projectResource(args.projectIdOrName) + '/properties'), params);
  return JSON.stringify(result, null, 2);
}

async function updateProjectProperties(args: z.infer<typeof UpdateProjectPropertiesSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update project properties.');
  const client = getTfsClient();
  const result = await client.patch<unknown>(
    client.collectionApiUrl('projects', projectResource(args.projectIdOrName) + '/properties'),
    args.properties,
  );
  log.info('Updated project properties for ' + args.projectIdOrName);
  return JSON.stringify(result, null, 2);
}

async function createTeam(args: z.infer<typeof CreateTeamSchema>): Promise<string> {
  if (!args.confirmCreate) throw new Error('confirmCreate=true is required to create a team.');
  const client = getTfsClient();
  const project = projectName(args.projectIdOrName);
  const result = await client.post<unknown>(client.collectionApiUrl('projects', projectResource(project) + '/teams'), {
    name: args.name,
    description: args.description,
  });
  log.info('Created team ' + args.name + ' in project ' + project);
  return JSON.stringify(result, null, 2);
}

async function updateTeam(args: z.infer<typeof UpdateTeamSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a team.');
  const client = getTfsClient();
  const project = projectName(args.projectIdOrName);
  const body: Record<string, unknown> = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.description !== undefined) body.description = args.description;
  if (Object.keys(body).length === 0) throw new Error('At least one field is required to update a team.');
  const result = await client.patch<unknown>(client.collectionApiUrl('projects', teamResource(project, args.teamIdOrName)), body);
  log.info('Updated team ' + args.teamIdOrName);
  return JSON.stringify(result, null, 2);
}

async function deleteTeam(args: z.infer<typeof DeleteTeamSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a team.');
  const client = getTfsClient();
  const project = projectName(args.projectIdOrName);
  const result = await client.delete<unknown>(client.collectionApiUrl('projects', teamResource(project, args.teamIdOrName)));
  log.info('Deleted team ' + args.teamIdOrName);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function addTeamMember(args: z.infer<typeof AddTeamMemberSchema>): Promise<string> {
  if (!args.confirmAdd) throw new Error('confirmAdd=true is required to add a team member.');
  const client = getTfsClient();
  const project = projectName(args.projectIdOrName);
  const resource = teamResource(project, args.teamIdOrName) + '/members/' + encodeURIComponent(args.memberId);
  const result = await client.put<unknown>(client.collectionApiUrl('projects', resource), {});
  log.info('Added member ' + args.memberId + ' to team ' + args.teamIdOrName);
  return JSON.stringify(result, null, 2);
}

async function removeTeamMember(args: z.infer<typeof RemoveTeamMemberSchema>): Promise<string> {
  if (!args.confirmRemove) throw new Error('confirmRemove=true is required to remove a team member.');
  const client = getTfsClient();
  const project = projectName(args.projectIdOrName);
  const resource = teamResource(project, args.teamIdOrName) + '/members/' + encodeURIComponent(args.memberId);
  const result = await client.delete<unknown>(client.collectionApiUrl('projects', resource));
  log.info('Removed member ' + args.memberId + ' from team ' + args.teamIdOrName);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function getIdentity(args: z.infer<typeof GetIdentitySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('identities', encodeURIComponent(args.identityId)), {
    queryMembership: args.queryMembership,
  });
  return JSON.stringify(result, null, 2);
}

async function listIdentities(args: z.infer<typeof ListIdentitiesSchema>): Promise<string> {
  const client = getTfsClient();
  const params: Record<string, unknown> = {
    searchFilter: args.searchFilter,
    queryMembership: args.queryMembership,
    $top: args.top,
  };
  if (args.filterValue) params.filterValue = args.filterValue;
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('identities', ''), params);
  return JSON.stringify(result, null, 2);
}

async function readIdentityMemberships(args: z.infer<typeof MembershipSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('identities', encodeURIComponent(args.identityId)), {
    queryMembership: args.queryMembership,
  });
  return JSON.stringify(result, null, 2);
}

async function getIdentityDescriptors(args: z.infer<typeof MembershipSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('identities', encodeURIComponent(args.identityId)), {
    queryMembership: args.queryMembership,
  });
  return JSON.stringify(result, null, 2);
}

async function listGroups(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('identities', ''), {
    searchFilter: 'General',
    filterValue: '[',
    queryMembership: 'Direct',
  });
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

export function registerAdminTools(server: McpServer): void {
  registerTool(server, 'tfs_create_project', 'Creates a TFS project. Requires confirmCreate.', CreateProjectSchema, createProject);
  registerTool(server, 'tfs_update_project', 'Updates a TFS project. Requires confirmUpdate.', UpdateProjectSchema, updateProject);
  registerTool(server, 'tfs_delete_project', 'Deletes a TFS project. Requires confirmDelete.', DeleteProjectSchema, deleteProject);
  registerTool(server, 'tfs_get_project_properties', 'Gets project properties.', ProjectPropertiesSchema, getProjectProperties);
  registerTool(server, 'tfs_update_project_properties', 'Updates project properties. Requires confirmUpdate.', UpdateProjectPropertiesSchema, updateProjectProperties);
  registerTool(server, 'tfs_create_team', 'Creates a team in a project. Requires confirmCreate.', CreateTeamSchema, createTeam);
  registerTool(server, 'tfs_update_team', 'Updates a team. Requires confirmUpdate.', UpdateTeamSchema, updateTeam);
  registerTool(server, 'tfs_delete_team', 'Deletes a team. Requires confirmDelete.', DeleteTeamSchema, deleteTeam);
  registerTool(server, 'tfs_add_team_member', 'Adds a member to a team. Requires confirmAdd.', AddTeamMemberSchema, addTeamMember);
  registerTool(server, 'tfs_remove_team_member', 'Removes a member from a team. Requires confirmRemove.', RemoveTeamMemberSchema, removeTeamMember);
  registerTool(server, 'tfs_get_identity', 'Gets one TFS identity.', GetIdentitySchema, getIdentity);
  registerTool(server, 'tfs_list_identities', 'Lists/searches TFS identities.', ListIdentitiesSchema, listIdentities);
  registerTool(server, 'tfs_read_identity_memberships', 'Reads identity memberships.', MembershipSchema, readIdentityMemberships);
  registerTool(server, 'tfs_get_identity_descriptors', 'Gets identity descriptor/membership data.', MembershipSchema, getIdentityDescriptors);
  registerTool(server, 'tfs_list_groups', 'Lists likely TFS groups via identity search.', z.object({}), listGroups);
}
