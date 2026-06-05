import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { TfsListResponse } from '../types/tfs.js';

const log = createChildLogger('tool:integrations');
const PREVIEW_API_VERSION = '4.1-preview';

const ProjectOverride = z.object({
  projectIdOrName: z.string().optional().describe('Project ID or name. Defaults to configured project.'),
});

const EndpointIdSchema = z.object({
  endpointId: z.string().min(1).describe('Service endpoint ID'),
}).merge(ProjectOverride);

const ListEndpointsSchema = z.object({
  type: z.string().optional().describe('Endpoint type filter'),
  authSchemes: z.string().optional().describe('Auth scheme filter'),
  endpointNames: z.array(z.string()).optional().describe('Endpoint name filters'),
}).merge(ProjectOverride);

const EndpointBodySchema = z.object({
  body: z.record(z.unknown()).describe('Service endpoint JSON body expected by TFS'),
}).merge(ProjectOverride);

const UpdateEndpointSchema = EndpointIdSchema.extend({
  body: z.record(z.unknown()).describe('Service endpoint JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a service endpoint'),
});

const DeleteEndpointSchema = EndpointIdSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a service endpoint'),
});

const ExecuteEndpointSchema = EndpointIdSchema.extend({
  body: z.record(z.unknown()).describe('Endpoint execution/request body expected by TFS'),
  confirmExecute: z.boolean().optional().default(false).describe('Required to execute an endpoint request'),
});

const PublisherSchema = z.object({
  publisherId: z.string().min(1).describe('Service hooks publisher ID'),
});

const ConsumerSchema = z.object({
  consumerId: z.string().min(1).describe('Service hooks consumer ID'),
});

const SubscriptionIdSchema = z.object({
  subscriptionId: z.string().min(1).describe('Service hook subscription ID'),
});

const SubscriptionBodySchema = z.object({
  body: z.record(z.unknown()).describe('Service hook subscription JSON body expected by TFS'),
});

const UpdateSubscriptionSchema = SubscriptionIdSchema.extend({
  body: z.record(z.unknown()).describe('Service hook subscription JSON body expected by TFS'),
  confirmUpdate: z.boolean().optional().default(false).describe('Required to update a service hook subscription'),
});

const DeleteSubscriptionSchema = SubscriptionIdSchema.extend({
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a service hook subscription'),
});

const TestSubscriptionSchema = SubscriptionIdSchema.extend({
  body: z.record(z.unknown()).optional().describe('Optional test notification body expected by TFS'),
  confirmTest: z.boolean().optional().default(false).describe('Required to test a service hook subscription'),
});

function previewParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, 'api-version': PREVIEW_API_VERSION };
}

async function listServiceEndpointTypes(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.projectApiUrl('serviceendpoint/types', ''), previewParams());
  return JSON.stringify(result, null, 2);
}

async function listServiceEndpoints(args: z.infer<typeof ListEndpointsSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const params: Record<string, unknown> = {};
  if (args.type) params.type = args.type;
  if (args.authSchemes) params.authSchemes = args.authSchemes;
  if (args.endpointNames?.length) params.endpointNames = args.endpointNames.join(',');
  const result = await client.get<TfsListResponse<unknown>>(client.projectApiUrl('serviceendpoint/endpoints', ''), previewParams(params));
  return JSON.stringify(result, null, 2);
}

async function getServiceEndpoint(args: z.infer<typeof EndpointIdSchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const result = await client.get<unknown>(client.projectApiUrl('serviceendpoint/endpoints', args.endpointId), previewParams());
  return JSON.stringify(result, null, 2);
}

async function createServiceEndpoint(args: z.infer<typeof EndpointBodySchema>): Promise<string> {
  const client = getTfsClient().forProject(args.projectIdOrName);
  const result = await client.post<unknown>(client.projectApiUrl('serviceendpoint/endpoints', ''), args.body, previewParams());
  log.info('Created service endpoint');
  return JSON.stringify(result, null, 2);
}

async function updateServiceEndpoint(args: z.infer<typeof UpdateEndpointSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a service endpoint.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const result = await client.put<unknown>(client.projectApiUrl('serviceendpoint/endpoints', args.endpointId), args.body, previewParams());
  log.info('Updated service endpoint ' + args.endpointId);
  return JSON.stringify(result, null, 2);
}

async function deleteServiceEndpoint(args: z.infer<typeof DeleteEndpointSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a service endpoint.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const result = await client.delete<unknown>(client.projectApiUrl('serviceendpoint/endpoints', args.endpointId), previewParams());
  log.info('Deleted service endpoint ' + args.endpointId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function executeServiceEndpointRequest(args: z.infer<typeof ExecuteEndpointSchema>): Promise<string> {
  if (!args.confirmExecute) throw new Error('confirmExecute=true is required to execute a service endpoint request.');
  const client = getTfsClient().forProject(args.projectIdOrName);
  const resource = args.endpointId + '/executionhistory';
  const result = await client.post<unknown>(client.projectApiUrl('serviceendpoint/endpoints', resource), args.body, previewParams());
  return JSON.stringify(result, null, 2);
}

async function listHookPublishers(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('hooks/publishers', ''), previewParams());
  return JSON.stringify(result, null, 2);
}

async function getHookPublisher(args: z.infer<typeof PublisherSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('hooks/publishers', args.publisherId), previewParams());
  return JSON.stringify(result, null, 2);
}

async function listHookEventTypes(args: z.infer<typeof PublisherSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('hooks/publishers', args.publisherId + '/eventTypes'), previewParams());
  return JSON.stringify(result, null, 2);
}

async function listHookConsumers(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('hooks/consumers', ''), previewParams());
  return JSON.stringify(result, null, 2);
}

async function getHookConsumer(args: z.infer<typeof ConsumerSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('hooks/consumers', args.consumerId), previewParams());
  return JSON.stringify(result, null, 2);
}

async function listHookActions(args: z.infer<typeof ConsumerSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('hooks/consumers', args.consumerId + '/actions'), previewParams());
  return JSON.stringify(result, null, 2);
}

async function listHookSubscriptions(): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<TfsListResponse<unknown>>(client.collectionApiUrl('hooks/subscriptions', ''), previewParams());
  return JSON.stringify(result, null, 2);
}

async function getHookSubscription(args: z.infer<typeof SubscriptionIdSchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.get<unknown>(client.collectionApiUrl('hooks/subscriptions', args.subscriptionId), previewParams());
  return JSON.stringify(result, null, 2);
}

async function createHookSubscription(args: z.infer<typeof SubscriptionBodySchema>): Promise<string> {
  const client = getTfsClient();
  const result = await client.post<unknown>(client.collectionApiUrl('hooks/subscriptions', ''), args.body, previewParams());
  log.info('Created service hook subscription');
  return JSON.stringify(result, null, 2);
}

async function updateHookSubscription(args: z.infer<typeof UpdateSubscriptionSchema>): Promise<string> {
  if (!args.confirmUpdate) throw new Error('confirmUpdate=true is required to update a service hook subscription.');
  const client = getTfsClient();
  const result = await client.put<unknown>(client.collectionApiUrl('hooks/subscriptions', args.subscriptionId), args.body, previewParams());
  log.info('Updated service hook subscription ' + args.subscriptionId);
  return JSON.stringify(result, null, 2);
}

async function deleteHookSubscription(args: z.infer<typeof DeleteSubscriptionSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a service hook subscription.');
  const client = getTfsClient();
  const result = await client.delete<unknown>(client.collectionApiUrl('hooks/subscriptions', args.subscriptionId), previewParams());
  log.info('Deleted service hook subscription ' + args.subscriptionId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function testHookSubscription(args: z.infer<typeof TestSubscriptionSchema>): Promise<string> {
  if (!args.confirmTest) throw new Error('confirmTest=true is required to test a service hook subscription.');
  const client = getTfsClient();
  const result = await client.post<unknown>(
    client.collectionApiUrl('hooks/subscriptions', args.subscriptionId + '/testNotifications'),
    args.body ?? {},
    previewParams(),
  );
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

export function registerIntegrationTools(server: McpServer): void {
  registerTool(server, 'tfs_list_service_endpoint_types', 'Lists service endpoint types.', z.object({}), listServiceEndpointTypes);
  registerTool(server, 'tfs_list_service_endpoints', 'Lists service endpoints.', ListEndpointsSchema, listServiceEndpoints);
  registerTool(server, 'tfs_get_service_endpoint', 'Gets one service endpoint.', EndpointIdSchema, getServiceEndpoint);
  registerTool(server, 'tfs_create_service_endpoint', 'Creates a service endpoint.', EndpointBodySchema, createServiceEndpoint);
  registerTool(server, 'tfs_update_service_endpoint', 'Updates a service endpoint. Requires confirmUpdate.', UpdateEndpointSchema, updateServiceEndpoint);
  registerTool(server, 'tfs_delete_service_endpoint', 'Deletes a service endpoint. Requires confirmDelete.', DeleteEndpointSchema, deleteServiceEndpoint);
  registerTool(server, 'tfs_execute_service_endpoint_request', 'Executes a service endpoint request. Requires confirmExecute.', ExecuteEndpointSchema, executeServiceEndpointRequest);
  registerTool(server, 'tfs_list_service_hook_publishers', 'Lists service hook publishers.', z.object({}), listHookPublishers);
  registerTool(server, 'tfs_get_service_hook_publisher', 'Gets one service hook publisher.', PublisherSchema, getHookPublisher);
  registerTool(server, 'tfs_list_service_hook_event_types', 'Lists service hook event types for a publisher.', PublisherSchema, listHookEventTypes);
  registerTool(server, 'tfs_list_service_hook_consumers', 'Lists service hook consumers.', z.object({}), listHookConsumers);
  registerTool(server, 'tfs_get_service_hook_consumer', 'Gets one service hook consumer.', ConsumerSchema, getHookConsumer);
  registerTool(server, 'tfs_list_service_hook_actions', 'Lists service hook actions for a consumer.', ConsumerSchema, listHookActions);
  registerTool(server, 'tfs_list_service_hook_subscriptions', 'Lists service hook subscriptions.', z.object({}), listHookSubscriptions);
  registerTool(server, 'tfs_get_service_hook_subscription', 'Gets one service hook subscription.', SubscriptionIdSchema, getHookSubscription);
  registerTool(server, 'tfs_create_service_hook_subscription', 'Creates a service hook subscription.', SubscriptionBodySchema, createHookSubscription);
  registerTool(server, 'tfs_update_service_hook_subscription', 'Updates a service hook subscription. Requires confirmUpdate.', UpdateSubscriptionSchema, updateHookSubscription);
  registerTool(server, 'tfs_delete_service_hook_subscription', 'Deletes a service hook subscription. Requires confirmDelete.', DeleteSubscriptionSchema, deleteHookSubscription);
  registerTool(server, 'tfs_test_service_hook_subscription', 'Tests a service hook subscription. Requires confirmTest.', TestSubscriptionSchema, testHookSubscription);
}
