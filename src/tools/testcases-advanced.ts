import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type {
  TestConfiguration,
  TestPoint,
  TestResult,
  TestRun,
  TestSuite,
  TfsListResponse,
} from '../types/tfs.js';

const log = createChildLogger('tool:testcases-advanced');

const TestOutcomeSchema = z.enum([
  'Passed',
  'Failed',
  'Inconclusive',
  'Blocked',
  'NotExecuted',
  'Aborted',
  'Paused',
  'None',
]);

const GetTestSuiteSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  includeChildSuites: z.boolean().optional().default(false).describe('Include child suite details'),
});

const UpdateTestSuiteSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  name: z.string().optional().describe('New suite name'),
  defaultConfigurationIds: z.array(z.number().int().positive()).optional()
    .describe('Default configuration IDs for the suite'),
  inheritDefaultConfigurations: z.boolean().optional()
    .describe('Whether to inherit default configurations from the parent suite'),
});

const DeleteTestSuiteSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a test suite'),
});

const CreateRequirementSuiteSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  parentSuiteId: z.number().int().positive().describe('Parent suite ID'),
  requirementId: z.number().int().positive().describe('Requirement/User Story work item ID'),
});

const CreateQuerySuiteSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  parentSuiteId: z.number().int().positive().describe('Parent suite ID'),
  name: z.string().min(1).describe('Name for the query-based suite'),
  queryString: z.string().min(1).describe('WIQL query string for the suite'),
});

const UpdateTestPointSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  pointId: z.number().int().positive().describe('Test point ID'),
  outcome: TestOutcomeSchema.optional().describe('Last outcome to set on the point'),
  resetToActive: z.boolean().optional().default(false).describe('Reset point outcome to active/not executed'),
  tester: z.string().optional().describe('Tester identity display name/email/descriptor if supported by TFS'),
});

const GetTestRunSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
  includeDetails: z.boolean().optional().default(true).describe('Include detailed run information'),
});

const DeleteTestRunSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a test run'),
});

const GetTestResultSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
  resultId: z.number().int().positive().describe('Test result ID'),
  detailsToInclude: z.string().optional().describe('Optional detailsToInclude value supported by the TFS API'),
});

const GetTestResultHistorySchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
  resultId: z.number().int().positive().describe('Test result ID'),
});

const TestAttachmentBodySchema = z.object({
  fileName: z.string().min(1).describe('Attachment file name'),
  contentText: z.string().optional().describe('Text content to upload'),
  contentBase64: z.string().optional().describe('Base64 content to upload'),
  comment: z.string().optional().describe('Optional attachment comment'),
  attachmentType: z.string().optional().default('GeneralAttachment').describe('TFS attachment type'),
});

const TestRunAttachmentSchema = TestAttachmentBodySchema.extend({
  runId: z.number().int().positive().describe('Test run ID'),
});

const TestResultAttachmentSchema = TestAttachmentBodySchema.extend({
  runId: z.number().int().positive().describe('Test run ID'),
  resultId: z.number().int().positive().describe('Test result ID'),
});

const ListTestRunAttachmentsSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
});

const ListTestResultAttachmentsSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
  resultId: z.number().int().positive().describe('Test result ID'),
});

const DeleteAttachmentSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
  attachmentId: z.number().int().positive().describe('Attachment ID'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete an attachment'),
});

const DeleteResultAttachmentSchema = DeleteAttachmentSchema.extend({
  resultId: z.number().int().positive().describe('Test result ID'),
});

const GetTestConfigurationSchema = z.object({
  configurationId: z.number().int().positive().describe('Test configuration ID'),
});

const ConfigurationValueSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

const CreateTestConfigurationSchema = z.object({
  name: z.string().min(1).describe('Configuration name'),
  description: z.string().optional(),
  values: z.array(ConfigurationValueSchema).min(1).describe('Configuration variable values'),
  state: z.string().optional().default('active'),
});

const UpdateTestConfigurationSchema = z.object({
  configurationId: z.number().int().positive().describe('Test configuration ID'),
  name: z.string().optional(),
  description: z.string().optional(),
  values: z.array(ConfigurationValueSchema).optional(),
  state: z.string().optional(),
});

const DeleteTestConfigurationSchema = z.object({
  configurationId: z.number().int().positive().describe('Test configuration ID'),
  confirmDelete: z.boolean().optional().default(false).describe('Required to delete a test configuration'),
});

function compactBody<T extends Record<string, unknown>>(body: T): Partial<T> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function attachmentStream(args: z.infer<typeof TestAttachmentBodySchema>): string {
  if (args.contentBase64 && args.contentText) {
    throw new Error('Provide either contentBase64 or contentText, not both.');
  }
  if (args.contentBase64) return args.contentBase64;
  if (args.contentText !== undefined) return Buffer.from(args.contentText, 'utf8').toString('base64');
  throw new Error('Either contentBase64 or contentText is required.');
}

function attachmentBody(args: z.infer<typeof TestAttachmentBodySchema>): Record<string, unknown> {
  return {
    stream: attachmentStream(args),
    fileName: args.fileName,
    comment: args.comment,
    attachmentType: args.attachmentType,
  };
}

async function getTestSuite(args: z.infer<typeof GetTestSuiteSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}`);
  const result = await client.get<TestSuite>(url, { includeChildSuites: args.includeChildSuites });
  return JSON.stringify(result, null, 2);
}

async function updateTestSuite(args: z.infer<typeof UpdateTestSuiteSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}`);
  const body: Record<string, unknown> = compactBody({
    name: args.name,
    inheritDefaultConfigurations: args.inheritDefaultConfigurations,
  });
  if (args.defaultConfigurationIds) {
    body.defaultConfigurations = args.defaultConfigurationIds.map((id) => ({ id }));
  }
  if (Object.keys(body).length === 0) throw new Error('At least one field is required to update a test suite.');
  const result = await client.patch<TestSuite>(url, body);
  log.info('Updated test suite #' + args.suiteId + ' in plan #' + args.planId);
  return JSON.stringify(result, null, 2);
}

async function deleteTestSuite(args: z.infer<typeof DeleteTestSuiteSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a test suite.');
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}`);
  const result = await client.delete<unknown>(url);
  log.info('Deleted test suite #' + args.suiteId + ' from plan #' + args.planId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function createRequirementSuite(args: z.infer<typeof CreateRequirementSuiteSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.parentSuiteId}`);
  const result = await client.post<TestSuite | TfsListResponse<TestSuite>>(url, {
    suiteType: 'RequirementTestSuite',
    requirementId: args.requirementId,
  });
  log.info('Created requirement suite from work item #' + args.requirementId);
  return JSON.stringify(result, null, 2);
}

async function createQuerySuite(args: z.infer<typeof CreateQuerySuiteSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.parentSuiteId}`);
  const result = await client.post<TestSuite | TfsListResponse<TestSuite>>(url, {
    suiteType: 'DynamicTestSuite',
    name: args.name,
    queryString: args.queryString,
  });
  log.info('Created query-based suite ' + args.name);
  return JSON.stringify(result, null, 2);
}

async function updateTestPoint(args: z.infer<typeof UpdateTestPointSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}/points/${args.pointId}`);
  const body: Record<string, unknown> = compactBody({
    outcome: args.resetToActive ? 'NotExecuted' : args.outcome,
    tester: args.tester,
  });
  if (Object.keys(body).length === 0) throw new Error('At least one field is required to update a test point.');
  const result = await client.patch<TestPoint>(url, body);
  log.info('Updated test point #' + args.pointId);
  return JSON.stringify(result, null, 2);
}

async function getTestRun(args: z.infer<typeof GetTestRunSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('runs/' + args.runId);
  const result = await client.get<TestRun>(url, { includeDetails: args.includeDetails });
  return JSON.stringify(result, null, 2);
}

async function deleteTestRun(args: z.infer<typeof DeleteTestRunSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a test run.');
  const client = getTfsClient();
  const url = client.testApiUrl('runs/' + args.runId);
  const result = await client.delete<unknown>(url);
  log.info('Deleted test run #' + args.runId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function getTestResult(args: z.infer<typeof GetTestResultSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/results/${args.resultId}`);
  const params = args.detailsToInclude ? { detailsToInclude: args.detailsToInclude } : undefined;
  const result = await client.get<TestResult>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getTestResultHistory(args: z.infer<typeof GetTestResultHistorySchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/results/${args.resultId}/history`);
  const result = await client.get<unknown>(url);
  return JSON.stringify(result, null, 2);
}

async function addTestRunAttachment(args: z.infer<typeof TestRunAttachmentSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/attachments`);
  const result = await client.post<unknown>(url, attachmentBody(args));
  log.info('Added attachment to test run #' + args.runId);
  return JSON.stringify(result, null, 2);
}

async function listTestRunAttachments(args: z.infer<typeof ListTestRunAttachmentsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/attachments`);
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function deleteTestRunAttachment(args: z.infer<typeof DeleteAttachmentSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a test run attachment.');
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/attachments/${args.attachmentId}`);
  const result = await client.delete<unknown>(url);
  log.info('Deleted attachment #' + args.attachmentId + ' from test run #' + args.runId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function addTestResultAttachment(args: z.infer<typeof TestResultAttachmentSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/results/${args.resultId}/attachments`);
  const result = await client.post<unknown>(url, attachmentBody(args));
  log.info('Added attachment to test result #' + args.resultId + ' in run #' + args.runId);
  return JSON.stringify(result, null, 2);
}

async function listTestResultAttachments(args: z.infer<typeof ListTestResultAttachmentsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/results/${args.resultId}/attachments`);
  const result = await client.get<TfsListResponse<unknown>>(url);
  return JSON.stringify(result, null, 2);
}

async function deleteTestResultAttachment(args: z.infer<typeof DeleteResultAttachmentSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a test result attachment.');
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/results/${args.resultId}/attachments/${args.attachmentId}`);
  const result = await client.delete<unknown>(url);
  log.info('Deleted attachment #' + args.attachmentId + ' from test result #' + args.resultId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function getTestConfiguration(args: z.infer<typeof GetTestConfigurationSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('configurations/' + args.configurationId);
  const result = await client.get<TestConfiguration>(url, { 'api-version': '4.1-preview' });
  return JSON.stringify(result, null, 2);
}

async function createTestConfiguration(args: z.infer<typeof CreateTestConfigurationSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('configurations');
  const result = await client.post<TestConfiguration>(url, {
    name: args.name,
    description: args.description,
    values: args.values,
    state: args.state,
  }, { 'api-version': '4.1-preview' });
  log.info('Created test configuration ' + args.name);
  return JSON.stringify(result, null, 2);
}

async function updateTestConfiguration(args: z.infer<typeof UpdateTestConfigurationSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('configurations/' + args.configurationId);
  const body = compactBody({
    name: args.name,
    description: args.description,
    values: args.values,
    state: args.state,
  });
  if (Object.keys(body).length === 0) throw new Error('At least one field is required to update a test configuration.');
  const result = await client.patch<TestConfiguration>(url, body, { 'api-version': '4.1-preview' });
  log.info('Updated test configuration #' + args.configurationId);
  return JSON.stringify(result, null, 2);
}

async function deleteTestConfiguration(args: z.infer<typeof DeleteTestConfigurationSchema>): Promise<string> {
  if (!args.confirmDelete) throw new Error('confirmDelete=true is required to delete a test configuration.');
  const client = getTfsClient();
  const url = client.testApiUrl('configurations/' + args.configurationId);
  const result = await client.delete<unknown>(url, { 'api-version': '4.1-preview' });
  log.info('Deleted test configuration #' + args.configurationId);
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

export function registerAdvancedTestCaseTools(server: McpServer): void {
  registerTool(server, 'tfs_get_test_suite', 'Gets a test suite by plan and suite ID.', GetTestSuiteSchema, getTestSuite);
  registerTool(server, 'tfs_update_test_suite', 'Updates a test suite name or default configurations.', UpdateTestSuiteSchema, updateTestSuite);
  registerTool(server, 'tfs_delete_test_suite', 'Deletes a test suite. Requires confirmDelete.', DeleteTestSuiteSchema, deleteTestSuite);
  registerTool(server, 'tfs_create_requirement_test_suite', 'Creates a requirement-based test suite from a requirement work item.', CreateRequirementSuiteSchema, createRequirementSuite);
  registerTool(server, 'tfs_create_query_test_suite', 'Creates a query-based dynamic test suite.', CreateQuerySuiteSchema, createQuerySuite);
  registerTool(server, 'tfs_update_test_point', 'Updates a test point outcome or tester.', UpdateTestPointSchema, updateTestPoint);
  registerTool(server, 'tfs_get_test_run', 'Gets one test run by ID.', GetTestRunSchema, getTestRun);
  registerTool(server, 'tfs_delete_test_run', 'Deletes a test run. Requires confirmDelete.', DeleteTestRunSchema, deleteTestRun);
  registerTool(server, 'tfs_get_test_result', 'Gets one test result by run and result ID.', GetTestResultSchema, getTestResult);
  registerTool(server, 'tfs_get_test_result_history', 'Gets result history for one test result.', GetTestResultHistorySchema, getTestResultHistory);
  registerTool(server, 'tfs_add_test_run_attachment', 'Adds a base64/text attachment to a test run.', TestRunAttachmentSchema, addTestRunAttachment);
  registerTool(server, 'tfs_list_test_run_attachments', 'Lists attachments on a test run.', ListTestRunAttachmentsSchema, listTestRunAttachments);
  registerTool(server, 'tfs_delete_test_run_attachment', 'Deletes a test run attachment. Requires confirmDelete.', DeleteAttachmentSchema, deleteTestRunAttachment);
  registerTool(server, 'tfs_add_test_result_attachment', 'Adds a base64/text attachment to a test result.', TestResultAttachmentSchema, addTestResultAttachment);
  registerTool(server, 'tfs_list_test_result_attachments', 'Lists attachments on a test result.', ListTestResultAttachmentsSchema, listTestResultAttachments);
  registerTool(server, 'tfs_delete_test_result_attachment', 'Deletes a test result attachment. Requires confirmDelete.', DeleteResultAttachmentSchema, deleteTestResultAttachment);
  registerTool(server, 'tfs_get_test_configuration', 'Gets one test configuration by ID.', GetTestConfigurationSchema, getTestConfiguration);
  registerTool(server, 'tfs_create_test_configuration', 'Creates a test configuration.', CreateTestConfigurationSchema, createTestConfiguration);
  registerTool(server, 'tfs_update_test_configuration', 'Updates a test configuration.', UpdateTestConfigurationSchema, updateTestConfiguration);
  registerTool(server, 'tfs_delete_test_configuration', 'Deletes a test configuration. Requires confirmDelete.', DeleteTestConfigurationSchema, deleteTestConfiguration);
}
