import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTfsClient } from '../tfs-client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type {
  TestPlan,
  TestSuite,
  TestCase,
  TestPoint,
  TestRun,
  TestResult,
  TestConfiguration,
  TestRunStatistics,
  TestRunUpdateRequest,
  TestResultUpdateItem,
  WorkItem,
  WorkItemPatch,
  TfsListResponse,
} from '../types/tfs.js';

const log = createChildLogger('tool:testcases');

// ─── Input schemas ────────────────────────────────────────────────────────────

const ListTestPlansSchema = z.object({
  includePlanDetails: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include full plan details (slower)'),
  filterActivePlans: z
    .boolean()
    .optional()
    .default(false)
    .describe('Only return active test plans'),
});

const CreateTestPlanSchema = z.object({
  name: z.string().min(1).describe('Name for the new test plan'),
  areaPath: z.string().optional().describe('Area path for the plan; defaults to project root'),
  iteration: z.string().optional().describe('Iteration path for the plan; defaults to project root'),
  description: z.string().optional().describe('Optional plan description'),
  startDate: z.string().optional().describe('Optional ISO 8601 start date'),
  endDate: z.string().optional().describe('Optional ISO 8601 end date'),
});

const UpdateTestPlanSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID to update'),
  name: z.string().optional().describe('New plan name'),
  areaPath: z.string().optional().describe('New area path'),
  iteration: z.string().optional().describe('New iteration path'),
  description: z.string().optional().describe('New plan description'),
  startDate: z.string().optional().describe('New ISO 8601 start date'),
  endDate: z.string().optional().describe('New ISO 8601 end date'),
  state: z.string().optional().describe('New plan state, if supported by the server process template'),
});

const GetTestPlanSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
});

const CreateTestSuiteSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  parentSuiteId: z.number().int().positive().describe('Parent suite ID, usually the rootSuite.id from the plan'),
  name: z.string().min(1).describe('Name for the new static test suite'),
});

const ListTestSuitesSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  expand: z
    .boolean()
    .optional()
    .default(false)
    .describe('Expand children and additional properties'),
});

const CreateTestCaseSchema = z.object({
  title: z.string().min(1).describe('Title of the test case work item'),
  description: z.string().optional().describe('HTML description'),
  areaPath: z.string().optional().describe('Area path (defaults to project root)'),
  iterationPath: z.string().optional().describe('Iteration path'),
  tags: z.string().optional().describe('Semicolon-separated tags'),
  priority: z.number().int().min(1).max(4).optional().describe('Priority 1-4'),
  fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
    .describe('Additional work item fields by reference name'),
});

const ListTestCasesSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  top: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .default(100)
    .describe('Maximum test cases to return'),
  skip: z.number().int().nonnegative().optional().default(0).describe('Number to skip (paging)'),
});

const AddTestCaseToSuiteSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  testCaseId: z.number().int().positive().describe('Existing Test Case work item ID to add'),
});

const RemoveTestCaseFromSuiteSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  testCaseId: z.number().int().positive().describe('Test Case work item ID to remove from the suite'),
  confirmRemove: z.boolean().optional().default(false)
    .describe('Required to remove the test case from the suite. The work item itself is not deleted.'),
});

const GetTestPointsSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  testerId: z.string().optional().describe('Filter by tester identity (display name or email)'),
  outcomeFilter: z
    .enum(['Passed', 'Failed', 'Inconclusive', 'Blocked', 'NotExecuted', 'None'])
    .optional()
    .describe('Filter by last test outcome'),
});

const GetTestPointSchema = z.object({
  planId: z.number().int().positive().describe('Test plan ID'),
  suiteId: z.number().int().positive().describe('Test suite ID'),
  pointId: z.number().int().positive().describe('Test point ID'),
});

const ListTestRunsSchema = z.object({
  top: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum test runs to return'),
  includeRunDetails: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include additional run details'),
  planId: z.number().int().positive().optional().describe('Filter by test plan ID'),
});

const GetTestRunResultsSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
  top: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .default(100)
    .describe('Maximum results to return'),
  outcomeFilter: z
    .enum(['Passed', 'Failed', 'Inconclusive', 'Aborted', 'Blocked', 'NotExecuted', 'None'])
    .optional()
    .describe('Filter by outcome'),
});

const CreateTestRunSchema = z.object({
  name: z.string().min(1).describe('Name for the test run'),
  planId: z.number().int().positive().describe('Test plan ID to run against'),
  pointIds: z
    .array(z.number().int().positive())
    .min(1)
    .describe('Array of test point IDs to include in this run'),
  comment: z.string().optional().describe('Optional comment for the test run'),
  automated: z.boolean().optional().default(false).describe('Mark as an automated test run'),
});

const UpdateTestRunSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID to update'),
  state: z.enum(['Completed', 'Aborted', 'InProgress']).optional()
    .describe('New state for the test run'),
  comment: z.string().optional().describe('Comment to add to the run'),
  errorMessage: z.string().optional().describe('Error message if the run failed'),
});

const UpdateTestResultsSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID containing the results'),
  results: z.array(z.object({
    id: z.number().int().positive().describe('Test result ID'),
    outcome: z.enum(['Passed', 'Failed', 'Inconclusive', 'Blocked', 'NotExecuted', 'Aborted', 'Paused'])
      .describe('Test outcome'),
    errorMessage: z.string().optional().describe('Error message for failed tests'),
    stackTrace: z.string().optional().describe('Stack trace for failed tests'),
    comment: z.string().optional().describe('Comment on this result'),
    durationInMs: z.number().nonnegative().optional().describe('Duration of the test in milliseconds'),
  })).min(1).describe('Array of test results to update'),
});

const GetTestConfigurationsSchema = z.object({
  top: z.number().int().positive().max(100).optional().default(20).describe('Maximum configurations to return'),
});

const GetTestRunStatisticsSchema = z.object({
  runId: z.number().int().positive().describe('Test run ID'),
});

// ─── Tool implementations ─────────────────────────────────────────────────────

function compactBody<T extends Record<string, unknown>>(body: T): Partial<T> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as Partial<T>;
}

async function listTestPlans(args: z.infer<typeof ListTestPlansSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('plans');

  const params: Record<string, unknown> = {};
  if (args.includePlanDetails) params.includePlanDetails = true;
  if (args.filterActivePlans) params.filterActivePlans = true;

  const result = await client.get<TfsListResponse<TestPlan>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function createTestPlan(args: z.infer<typeof CreateTestPlanSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('plans');
  const plan = await client.post<TestPlan>(url, compactBody({
    name: args.name,
    areaPath: args.areaPath,
    iteration: args.iteration,
    description: args.description,
    startDate: args.startDate,
    endDate: args.endDate,
  }));
  log.info('Created test plan #' + plan.id + ': ' + args.name);
  return JSON.stringify(plan, null, 2);
}

async function updateTestPlan(args: z.infer<typeof UpdateTestPlanSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('plans/' + args.planId);
  const plan = await client.patch<TestPlan>(url, compactBody({
    name: args.name,
    areaPath: args.areaPath,
    iteration: args.iteration,
    description: args.description,
    startDate: args.startDate,
    endDate: args.endDate,
    state: args.state,
  }));
  log.info('Updated test plan #' + args.planId);
  return JSON.stringify(plan, null, 2);
}

async function getTestPlan(args: z.infer<typeof GetTestPlanSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}`);
  const plan = await client.get<TestPlan>(url);
  return JSON.stringify(plan, null, 2);
}

async function createTestSuite(args: z.infer<typeof CreateTestSuiteSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.parentSuiteId}`);
  const result = await client.post<TestSuite | TfsListResponse<TestSuite>>(url, {
    suiteType: 'StaticTestSuite',
    name: args.name,
  });
  const suite = 'value' in result
    ? result.value.find((item) => item.name === args.name) ?? result.value[result.value.length - 1]
    : result;
  if (!suite) {
    throw new Error('The suite was created but the server response did not include suite details.');
  }
  log.info('Created test suite #' + suite.id + ' in plan #' + args.planId);
  return JSON.stringify(suite, null, 2);
}

async function listTestSuites(args: z.infer<typeof ListTestSuitesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites`);
  const params: Record<string, unknown> = {};
  if (args.expand) params.$expand = true;

  const result = await client.get<TfsListResponse<TestSuite>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function createTestCase(args: z.infer<typeof CreateTestCaseSchema>): Promise<string> {
  const client = getTfsClient();
  const encodedType = encodeURIComponent('Test Case');
  const url = client.projectApiUrl('wit/workitems', '$' + encodedType);
  const patches: WorkItemPatch[] = [
    { op: 'add', path: '/fields/System.Title', value: args.title },
  ];

  if (args.description)
    patches.push({ op: 'add', path: '/fields/System.Description', value: args.description });
  if (args.areaPath)
    patches.push({ op: 'add', path: '/fields/System.AreaPath', value: args.areaPath });
  if (args.iterationPath)
    patches.push({ op: 'add', path: '/fields/System.IterationPath', value: args.iterationPath });
  if (args.tags)
    patches.push({ op: 'add', path: '/fields/System.Tags', value: args.tags });
  if (args.priority !== undefined)
    patches.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: args.priority });
  if (args.fields) {
    for (const [referenceName, value] of Object.entries(args.fields)) {
      patches.push({ op: 'add', path: '/fields/' + referenceName, value });
    }
  }

  const testCase = await client.patch<WorkItem>(url, patches, undefined, {
    'Content-Type': 'application/json-patch+json',
  });
  log.info('Created test case #' + testCase.id + ': ' + args.title);
  return JSON.stringify(testCase, null, 2);
}

async function listTestCases(args: z.infer<typeof ListTestCasesSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}/testcases`);

  const result = await client.get<TfsListResponse<TestCase>>(url, {
    $top: args.top,
    $skip: args.skip,
  });
  return JSON.stringify(result, null, 2);
}

async function addTestCaseToSuite(args: z.infer<typeof AddTestCaseToSuiteSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}/testcases/${args.testCaseId}`);
  const result = await client.post<TfsListResponse<TestCase>>(url, {});
  log.info('Added test case #' + args.testCaseId + ' to suite #' + args.suiteId);
  return JSON.stringify(result, null, 2);
}

async function removeTestCaseFromSuite(args: z.infer<typeof RemoveTestCaseFromSuiteSchema>): Promise<string> {
  if (!args.confirmRemove) {
    throw new Error('confirmRemove=true is required to remove a test case from a suite.');
  }
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}/testcases/${args.testCaseId}`);
  const result = await client.delete(url);
  log.info('Removed test case #' + args.testCaseId + ' from suite #' + args.suiteId);
  return JSON.stringify(result ?? { ok: true }, null, 2);
}

async function getTestPoints(args: z.infer<typeof GetTestPointsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}/points`);

  const params: Record<string, unknown> = {};
  if (args.testerId) params.testerId = args.testerId;
  if (args.outcomeFilter) params.outcomeFilter = args.outcomeFilter;

  const result = await client.get<TfsListResponse<TestPoint>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getTestPoint(args: z.infer<typeof GetTestPointSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`plans/${args.planId}/suites/${args.suiteId}/points/${args.pointId}`);
  const result = await client.get<TestPoint>(url);
  return JSON.stringify(result, null, 2);
}

async function listTestRuns(args: z.infer<typeof ListTestRunsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('runs');

  const params: Record<string, unknown> = { $top: args.top };
  if (args.includeRunDetails) params.includeRunDetails = true;
  if (args.planId) params.planId = args.planId;

  const result = await client.get<TfsListResponse<TestRun>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function getTestRunResults(args: z.infer<typeof GetTestRunResultsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl(`runs/${args.runId}/results`);

  const params: Record<string, unknown> = { $top: args.top };
  if (args.outcomeFilter) params.outcomeFilter = args.outcomeFilter;

  const result = await client.get<TfsListResponse<TestResult>>(url, params);
  return JSON.stringify(result, null, 2);
}

async function createTestRun(args: z.infer<typeof CreateTestRunSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('runs');

  const body = {
    name: args.name,
    plan: { id: args.planId },
    pointIds: args.pointIds,
    comment: args.comment,
    automated: args.automated,
  };

  const run = await client.post<TestRun>(url, body);
  log.info(`Created test run #${run.id}: ${args.name}`);
  return JSON.stringify(run, null, 2);
}

async function updateTestRun(args: z.infer<typeof UpdateTestRunSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('runs/' + args.runId);
  const body: TestRunUpdateRequest = {};
  if (args.state) body.state = args.state;
  if (args.comment) body.comment = args.comment;
  if (args.errorMessage) body.errorMessage = args.errorMessage;
  if (args.state === 'Completed' || args.state === 'Aborted') {
    body.completedDate = new Date().toISOString();
  }
  const run = await client.patch<TestRun>(url, body);
  log.info('Updated test run #' + args.runId + ' -> ' + (args.state ?? 'no state change'));
  return JSON.stringify(run, null, 2);
}

async function updateTestResults(args: z.infer<typeof UpdateTestResultsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('runs/' + args.runId + '/results');
  const items: TestResultUpdateItem[] = args.results.map((r) => ({
    id: r.id,
    outcome: r.outcome,
    errorMessage: r.errorMessage,
    stackTrace: r.stackTrace,
    comment: r.comment,
    durationInMs: r.durationInMs,
    completedDate: new Date().toISOString(),
  }));
  const result = await client.patch<TfsListResponse<TestResult>>(url, items);
  log.info('Updated ' + items.length + ' test result(s) in run #' + args.runId);
  return JSON.stringify(result, null, 2);
}

async function getTestConfigurations(args: z.infer<typeof GetTestConfigurationsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('configurations');
  const result = await client.get<TfsListResponse<TestConfiguration>>(url, {
    $top: args.top,
    'api-version': '4.1-preview',
  });
  return JSON.stringify(result, null, 2);
}

async function getTestRunStatistics(args: z.infer<typeof GetTestRunStatisticsSchema>): Promise<string> {
  const client = getTfsClient();
  const url = client.testApiUrl('runs/' + args.runId + '/statistics');
  const result = await client.get<TestRunStatistics>(url);
  return JSON.stringify(result, null, 2);
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerTestCaseTools(server: McpServer): void {
  server.tool(
    'tfs_list_test_plans',
    'Lists all test plans in the TFS project.',
    ListTestPlansSchema.shape,
    async (args: z.infer<typeof ListTestPlansSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listTestPlans(args) }] };
      } catch (err) {
        log.error('tfs_list_test_plans failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_create_test_plan',
    'Creates a new TFS test plan.',
    CreateTestPlanSchema.shape,
    async (args: z.infer<typeof CreateTestPlanSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await createTestPlan(args) }] };
      } catch (err) {
        log.error('tfs_create_test_plan failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_update_test_plan',
    'Updates a TFS test plan. Only provide fields you want to change.',
    UpdateTestPlanSchema.shape,
    async (args: z.infer<typeof UpdateTestPlanSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await updateTestPlan(args) }] };
      } catch (err) {
        log.error('tfs_update_test_plan failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_test_plan',
    'Gets detailed information about a specific test plan by ID.',
    GetTestPlanSchema.shape,
    async (args: z.infer<typeof GetTestPlanSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getTestPlan(args) }] };
      } catch (err) {
        log.error('tfs_get_test_plan failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_create_test_suite',
    'Creates a static test suite under an existing parent suite in a test plan.',
    CreateTestSuiteSchema.shape,
    async (args: z.infer<typeof CreateTestSuiteSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await createTestSuite(args) }] };
      } catch (err) {
        log.error('tfs_create_test_suite failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_test_suites',
    'Lists all test suites within a given test plan.',
    ListTestSuitesSchema.shape,
    async (args: z.infer<typeof ListTestSuitesSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listTestSuites(args) }] };
      } catch (err) {
        log.error('tfs_list_test_suites failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_create_test_case',
    'Creates a Test Case work item for use in test plans and suites.',
    CreateTestCaseSchema.shape,
    async (args: z.infer<typeof CreateTestCaseSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await createTestCase(args) }] };
      } catch (err) {
        log.error('tfs_create_test_case failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_test_cases',
    'Lists test cases within a specific test suite, including associated work item fields and point assignments.',
    ListTestCasesSchema.shape,
    async (args: z.infer<typeof ListTestCasesSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listTestCases(args) }] };
      } catch (err) {
        log.error('tfs_list_test_cases failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_add_test_case_to_suite',
    'Adds an existing Test Case work item to a test suite, creating test points for the suite configurations.',
    AddTestCaseToSuiteSchema.shape,
    async (args: z.infer<typeof AddTestCaseToSuiteSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await addTestCaseToSuite(args) }] };
      } catch (err) {
        log.error('tfs_add_test_case_to_suite failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_remove_test_case_from_suite',
    'Removes a Test Case from a test suite without deleting the Test Case work item. Requires confirmRemove=true.',
    RemoveTestCaseFromSuiteSchema.shape,
    async (args: z.infer<typeof RemoveTestCaseFromSuiteSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await removeTestCaseFromSuite(args) }] };
      } catch (err) {
        log.error('tfs_remove_test_case_from_suite failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_test_points',
    'Gets test points (the intersection of test case × configuration × tester) within a test suite, optionally filtered by tester or outcome.',
    GetTestPointsSchema.shape,
    async (args: z.infer<typeof GetTestPointsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getTestPoints(args) }] };
      } catch (err) {
        log.error('tfs_get_test_points failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_test_point',
    'Gets a single test point by plan, suite, and point ID.',
    GetTestPointSchema.shape,
    async (args: z.infer<typeof GetTestPointSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getTestPoint(args) }] };
      } catch (err) {
        log.error('tfs_get_test_point failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_list_test_runs',
    'Lists recent test runs in the project, optionally filtered by test plan.',
    ListTestRunsSchema.shape,
    async (args: z.infer<typeof ListTestRunsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await listTestRuns(args) }] };
      } catch (err) {
        log.error('tfs_list_test_runs failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_test_run_results',
    'Gets individual test results for a specific test run, optionally filtered by outcome (Passed, Failed, etc.).',
    GetTestRunResultsSchema.shape,
    async (args: z.infer<typeof GetTestRunResultsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getTestRunResults(args) }] };
      } catch (err) {
        log.error('tfs_get_test_run_results failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_create_test_run',
    'Creates a new test run for a set of test points within a test plan.',
    CreateTestRunSchema.shape,
    async (args: z.infer<typeof CreateTestRunSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await createTestRun(args) }] };
      } catch (err) {
        log.error('tfs_create_test_run failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_update_test_run',
    'Updates the state of an existing test run (e.g. mark as Completed or Aborted) and optionally adds a comment.',
    UpdateTestRunSchema.shape,
    async (args: z.infer<typeof UpdateTestRunSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await updateTestRun(args) }] };
      } catch (err) {
        log.error('tfs_update_test_run failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_update_test_results',
    'Records test outcomes (Passed, Failed, Blocked, etc.) for one or more test results within a test run. Include error messages and stack traces for failed tests.',
    UpdateTestResultsSchema.shape,
    async (args: z.infer<typeof UpdateTestResultsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await updateTestResults(args) }] };
      } catch (err) {
        log.error('tfs_update_test_results failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_test_configurations',
    'Lists all test configurations defined in the project (e.g. Windows 10 x64, Chrome, etc.).',
    GetTestConfigurationsSchema.shape,
    async (args: z.infer<typeof GetTestConfigurationsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getTestConfigurations(args) }] };
      } catch (err) {
        log.error('tfs_get_test_configurations failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );

  server.tool(
    'tfs_get_test_run_statistics',
    'Gets aggregate statistics for a test run: total count, passed, failed, blocked, etc. per outcome.',
    GetTestRunStatisticsSchema.shape,
    async (args: z.infer<typeof GetTestRunStatisticsSchema>) => {
      try {
        return { content: [{ type: 'text' as const, text: await getTestRunStatistics(args) }] };
      } catch (err) {
        log.error('tfs_get_test_run_statistics failed', { err });
        return { content: [{ type: 'text' as const, text: formatErrorForMcp(err) }], isError: true };
      }
    },
  );
}
