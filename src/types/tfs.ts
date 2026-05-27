/**
 * TFS 2018 Type Definitions
 * Based on TFS REST API v4.1 (Team Foundation Server 2018)
 */

// ─── Authentication ───────────────────────────────────────────────────────────

export type AuthType = 'ntlm' | 'basic' | 'pat' | 'kerberos';

export interface AuthConfig {
  type: AuthType;
  username?: string;
  password?: string;
  domain?: string;
  pat?: string;
  /** Kerberos Service Principal Name, e.g. HTTP/tfs.empresa.com */
  spn?: string;
}

// ─── Server Configuration ─────────────────────────────────────────────────────

export interface TfsConfig {
  baseUrl: string;
  collection: string;
  project: string;
  apiVersion: string;
  timeoutMs: number;
  maxPageSize: number;
  auth: AuthConfig;
  /** HTTP/HTTPS proxy URL, e.g. http://proxy.empresa.com:8080 */
  proxyUrl?: string;
  /** Skip TLS certificate validation (self-signed certs). Use with caution. */
  tlsRejectUnauthorized: boolean;
}

// ─── Common TFS Structures ────────────────────────────────────────────────────

export interface TfsRef {
  id: number | string;
  url: string;
}

export interface TfsIdentity {
  id: string;
  displayName: string;
  uniqueName: string;
  url?: string;
  imageUrl?: string;
}

export interface TfsLink {
  href: string;
}

export interface TfsLinks {
  self?: TfsLink;
  workItemType?: TfsLink;
  fields?: TfsLink;
  html?: TfsLink;
  [key: string]: TfsLink | undefined;
}

// ─── Work Items ───────────────────────────────────────────────────────────────

export type WorkItemState =
  | 'Active'
  | 'Resolved'
  | 'Closed'
  | 'New'
  | 'Removed'
  | string;

/** @deprecated Use WorkItemTypeName */
export type WorkItemType = WorkItemTypeName;

export interface WorkItemFields {
  'System.Id': number;
  'System.Title': string;
  'System.WorkItemType': WorkItemType;
  'System.State': WorkItemState;
  'System.AssignedTo'?: string;
  'System.AreaPath': string;
  'System.TeamProject': string;
  'System.IterationPath': string;
  'System.Description'?: string;
  'System.CreatedDate': string;
  'System.ChangedDate': string;
  'System.CreatedBy': string;
  'System.ChangedBy': string;
  'System.Tags'?: string;
  'System.CommentCount'?: number;
  'Microsoft.VSTS.Common.Priority'?: number;
  'Microsoft.VSTS.Common.Severity'?: string;
  'Microsoft.VSTS.Common.ResolvedDate'?: string;
  'Microsoft.VSTS.Common.ClosedDate'?: string;
  'Microsoft.VSTS.Scheduling.StoryPoints'?: number;
  'Microsoft.VSTS.Scheduling.Effort'?: number;
  'Microsoft.VSTS.Scheduling.RemainingWork'?: number;
  'Microsoft.VSTS.Scheduling.CompletedWork'?: number;
  [key: string]: unknown;
}

export interface WorkItem {
  id: number;
  rev: number;
  fields: WorkItemFields;
  relations?: WorkItemRelation[];
  _links: TfsLinks;
  url: string;
}

export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes: {
    isLocked?: boolean;
    comment?: string;
    name?: string;
    [key: string]: unknown;
  };
}

export interface WorkItemPatch {
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export interface WorkItemQueryResult {
  queryType: 'flat' | 'oneHop' | 'tree';
  queryResultType: 'workItem' | 'workItemLink';
  asOf: string;
  columns: Array<{ referenceName: string; name: string; url: string }>;
  sortColumns: Array<{ field: { referenceName: string; name: string; url: string }; descending: boolean }>;
  workItems: Array<{ id: number; url: string }>;
}

export interface WiqlQuery {
  query: string;
}

// ─── Test Cases ───────────────────────────────────────────────────────────────

export type TestOutcome =
  | 'Unspecified'
  | 'None'
  | 'Passed'
  | 'Failed'
  | 'Inconclusive'
  | 'Timeout'
  | 'Aborted'
  | 'Blocked'
  | 'NotExecuted'
  | 'Warning'
  | 'Error'
  | 'NotApplicable'
  | 'Paused'
  | 'InProgress'
  | string;

export interface TestPlan {
  id: number;
  name: string;
  area: { name: string };
  iteration: string;
  state: string;
  rootSuite?: TestSuiteRef;
  owner: TfsIdentity;
  startDate?: string;
  endDate?: string;
  description?: string;
  url: string;
}

export interface TestSuiteRef {
  id: number;
  name: string;
  url: string;
}

export interface TestSuite {
  id: number;
  name: string;
  suiteType: 'StaticTestSuite' | 'DynamicTestSuite' | 'RequirementTestSuite';
  state: string;
  plan: { id: number; name: string; url: string };
  parent?: TestSuiteRef;
  defaultConfigurations?: Array<{ id: number; name: string }>;
  testCaseCount?: number;
  url: string;
}

export interface TestCase {
  testCase: {
    id: number;
    url: string;
    webUrl: string;
  };
  pointAssignments: TestPointAssignment[];
  workItem: {
    id: number;
    fields: Partial<WorkItemFields>;
    url: string;
  };
}

export interface TestPointAssignment {
  configuration: { id: number; name: string };
  tester: TfsIdentity;
}

export interface TestPoint {
  id: number;
  url: string;
  assignedTo: TfsIdentity;
  configuration: { id: number; name: string; url: string };
  lastTestRun?: TfsRef;
  lastResult?: TfsRef;
  outcome: TestOutcome;
  state: string;
  testCase: TfsRef;
  testPlan: TfsRef;
  testSuite: TfsRef;
  workItemProperties?: Array<{ workItem: { key: string; value: unknown } }>;
}

export interface TestRun {
  id: number;
  name: string;
  state: 'Unspecified' | 'NotStarted' | 'InProgress' | 'Completed' | 'Aborted' | 'Waiting';
  plan: TfsRef;
  postProcessState: string;
  totalTests: number;
  passedTests: number;
  failedTests?: number;
  inconclusiveTests?: number;
  startedDate?: string;
  completedDate?: string;
  owner: TfsIdentity;
  url: string;
  webAccessUrl?: string;
}

export interface TestResult {
  id: number;
  testCase: TfsRef;
  testRun: TfsRef;
  testPoint?: TfsRef;
  configuration?: { id: number; name: string; url: string };
  outcome: TestOutcome;
  state: string;
  startedDate?: string;
  completedDate?: string;
  durationInMs?: number;
  errorMessage?: string;
  stackTrace?: string;
  comment?: string;
  owner: TfsIdentity;
  runBy: TfsIdentity;
  url: string;
}

// ─── Builds ───────────────────────────────────────────────────────────────────

export type BuildStatus =
  | 'none'
  | 'inProgress'
  | 'completed'
  | 'cancelling'
  | 'postponed'
  | 'notStarted'
  | 'all';

export type BuildResult =
  | 'none'
  | 'succeeded'
  | 'partiallySucceeded'
  | 'failed'
  | 'canceled';

export type BuildReason =
  | 'none'
  | 'manual'
  | 'individualCI'
  | 'batchedCI'
  | 'schedule'
  | 'userCreated'
  | 'validateShelveset'
  | 'checkInShelveset'
  | 'pullRequest'
  | 'triggered'
  | 'all';

export interface BuildDefinitionRef {
  id: number;
  name: string;
  url: string;
  uri: string;
  path: string;
  type: 'xaml' | 'build';
  queueStatus: 'enabled' | 'paused' | 'disabled';
  revision: number;
  project: TfsProjectRef;
}

export interface BuildDefinition extends BuildDefinitionRef {
  variables?: Record<string, { value: string; allowOverride?: boolean; isSecret?: boolean }>;
  steps?: BuildStep[];
  triggers?: BuildTrigger[];
  repository?: BuildRepository;
}

export interface BuildStep {
  task: { id: string; name: string; versionSpec: string };
  displayName: string;
  enabled: boolean;
  inputs?: Record<string, string>;
}

export interface BuildTrigger {
  triggerType: string;
  [key: string]: unknown;
}

export interface BuildRepository {
  id: string;
  type: string;
  name: string;
  url: string;
  defaultBranch?: string;
}

export interface Build {
  id: number;
  buildNumber: string;
  status: BuildStatus;
  result?: BuildResult;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  url: string;
  definition: BuildDefinitionRef;
  buildNumberRevision?: number;
  project: TfsProjectRef;
  uri: string;
  sourceBranch: string;
  sourceVersion: string;
  queue?: { id: number; name: string; url: string };
  priority: 'low' | 'belowNormal' | 'normal' | 'aboveNormal' | 'high';
  reason: BuildReason;
  requestedFor: TfsIdentity;
  requestedBy: TfsIdentity;
  lastChangedDate: string;
  lastChangedBy: TfsIdentity;
  orchestrationPlan?: { planId: string };
  logs?: { id: number; type: string; url: string };
  repository: BuildRepository;
  keepForever: boolean;
  retainedByRelease: boolean;
  triggeredByBuild?: TfsRef;
}

export interface BuildQueueRequest {
  definition: { id: number };
  sourceBranch?: string;
  sourceVersion?: string;
  parameters?: string;
  demands?: string[];
  priority?: 'low' | 'belowNormal' | 'normal' | 'aboveNormal' | 'high';
}

export interface BuildLog {
  id: number;
  type: string;
  url: string;
  createdOn?: string;
  lastChangedOn?: string;
  lineCount?: number;
}

// ─── Source Control (TFVC) ────────────────────────────────────────────────────

export interface TfvcItem {
  version: number;
  changeDate: string;
  path: string;
  isFolder: boolean;
  isSymLink?: boolean;
  contentMetadata?: {
    encoding: number;
    contentType: string;
  };
  url: string;
}

export interface TfvcChangeset {
  changesetId: number;
  url: string;
  author: TfsIdentity;
  checkedInBy: TfsIdentity;
  createdDate: string;
  comment: string;
  commentTruncated?: boolean;
  changes?: TfvcChange[];
  workItems?: Array<{ id: number; title: string; state: string; type: string }>;
}

export interface TfvcChange {
  item: TfvcItem;
  changeType: string;
}

export interface TfvcLabel {
  id: number;
  name: string;
  description?: string;
  labelScope: string;
  modifiedDate: string;
  owner: TfsIdentity;
  url: string;
}

export interface TfvcShelveset {
  id: string;
  name: string;
  owner: TfsIdentity;
  createdDate: string;
  comment?: string;
  commentTruncated?: boolean;
  changes?: TfvcChange[];
  workItems?: Array<{ id: number; title: string }>;
  url: string;
}

export interface TfvcBranch {
  path: string;
  description?: string;
  isDeleted: boolean;
  owner: TfsIdentity;
  createdDate: string;
  children?: TfvcBranch[];
  mappings?: Array<{ serverItem: string; type: string }>;
  parent?: { path: string };
  relatedBranches?: Array<{ path: string }>;
}

// ─── Projects & Teams ─────────────────────────────────────────────────────────

export interface TfsProjectRef {
  id: string;
  name: string;
  url: string;
  state?: string;
  revision?: number;
}

export interface TfsProject extends TfsProjectRef {
  description?: string;
  defaultTeam: { id: string; name: string; url: string };
  capabilities?: {
    versioncontrol?: { sourceControlType: string };
    processTemplate?: { templateName: string; templateTypeId: string };
  };
}

// ─── API Response Wrappers ────────────────────────────────────────────────────

export interface TfsListResponse<T> {
  count: number;
  value: T[];
}

export interface TfsPaginatedParams {
  $top?: number;
  $skip?: number;
  $orderby?: string;
}

// ─── Work Item — extended types ───────────────────────────────────────────────

/** Rename the string union to avoid clash with the interface below */
export type WorkItemTypeName =
  | 'Bug' | 'Task' | 'User Story' | 'Feature' | 'Epic'
  | 'Issue' | 'Test Case' | 'Test Suite' | 'Test Plan' | string;

export interface WorkItemHistoryEntry {
  rev: number;
  revisedDate: string;
  revisedBy: TfsIdentity;
  fields: Record<string, { oldValue: unknown; newValue: unknown }>;
  url: string;
}

export interface WorkItemTypeFieldDefinition {
  field: { id: string; name: string; referenceName: string; url: string };
  defaultValue?: unknown;
  alwaysRequired: boolean;
  url: string;
}

export interface WorkItemTypeDefinition {
  name: string;
  description: string;
  xmlForm: string;
  fields: WorkItemTypeFieldDefinition[];
  transitions: Record<string, Array<{ to: string }>>;
  url: string;
}

export interface WorkItemFieldDefinition {
  name: string;
  referenceName: string;
  type: 'string' | 'integer' | 'dateTime' | 'plainText' | 'html' | 'treePath'
      | 'boolean' | 'double' | 'guid' | 'identity' | 'picklistInteger'
      | 'picklistString' | 'picklistDouble' | string;
  readOnly: boolean;
  isQueryable: boolean;
  url: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  queryType?: 'flat' | 'oneHop' | 'tree';
  queryText?: string;
  hasChildren?: boolean;
  children?: SavedQuery[];
  url: string;
  _links?: TfsLinks;
}

// ─── Team members ─────────────────────────────────────────────────────────────

export interface TeamMember {
  id: string;
  displayName: string;
  uniqueName: string;
  url: string;
  imageUrl?: string;
  isTeamAdmin?: boolean;
}

// ─── Test — extended types ────────────────────────────────────────────────────

export interface TestConfiguration {
  id: number;
  name: string;
  description?: string;
  isDefault: boolean;
  state: 'active' | 'inactive' | string;
  values: Array<{ name: string; value: string }>;
  url: string;
}

export interface TestRunUpdateRequest {
  state?: 'Completed' | 'Aborted' | 'InProgress' | string;
  comment?: string;
  completedDate?: string;
  errorMessage?: string;
}

export interface TestResultUpdateItem {
  /** ID of the test result to update */
  id: number;
  outcome: TestOutcome;
  errorMessage?: string;
  stackTrace?: string;
  comment?: string;
  startedDate?: string;
  completedDate?: string;
  durationInMs?: number;
}

export interface TestRunStatistics {
  run: TfsRef;
  runStatistics: Array<{ outcome: TestOutcome; count: number }>;
}

// ─── Builds — extended types ──────────────────────────────────────────────────

export interface BuildArtifact {
  id: number;
  name: string;
  resource: {
    type: string;
    data: string;
    url: string;
    downloadUrl?: string;
    properties?: Record<string, string>;
  };
}

export interface BuildTimelineRecord {
  id: string;
  parentId?: string;
  type: 'Stage' | 'Phase' | 'Job' | 'Task' | 'Checkpoint' | string;
  name: string;
  startTime?: string;
  finishTime?: string;
  state: 'pending' | 'inProgress' | 'completed' | string;
  result?: 'succeeded' | 'succeededWithIssues' | 'failed' | 'canceled' | 'skipped' | string;
  percentComplete?: number;
  log?: { id: number; type: string; url: string };
  issues?: Array<{ type: 'error' | 'warning'; category: string; message: string }>;
  order?: number;
  workerName?: string;
}

export interface BuildTimeline {
  id: string;
  changeId: number;
  lastChangedOn: string;
  records: BuildTimelineRecord[];
  url: string;
}

export interface BuildQueue {
  id: number;
  name: string;
  status?: 'enabled' | 'paused' | 'disabled';
  pool: {
    id: number;
    name: string;
    isHosted: boolean;
  };
}

// ─── Git — complete type set ──────────────────────────────────────────────────

export interface GitRepository {
  id: string;
  name: string;
  url: string;
  remoteUrl: string;
  sshUrl?: string;
  project: TfsProjectRef;
  defaultBranch?: string;
  size?: number;
  isFork?: boolean;
}

export interface GitRef {
  name: string;
  objectId: string;
  url: string;
  creator?: TfsIdentity;
  isLocked?: boolean;
}

export interface GitCommitRef {
  commitId: string;
  url: string;
  comment: string;
  commentTruncated?: boolean;
  author: {
    name: string;
    email: string;
    date: string;
  };
  committer: {
    name: string;
    email: string;
    date: string;
  };
  parents?: string[];
  statuses?: unknown[];
  remoteUrl?: string;
}

export interface GitPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: 'active' | 'abandoned' | 'completed' | 'all' | string;
  createdBy: TfsIdentity;
  creationDate: string;
  closedDate?: string;
  sourceRefName: string;
  targetRefName: string;
  mergeStatus?: string;
  isDraft?: boolean;
  repository: GitRepository;
  reviewers: Array<TfsIdentity & { vote: number; isRequired?: boolean }>;
  url: string;
  remoteUrl?: string;
}

export interface GitItem {
  objectId: string;
  gitObjectType: 'blob' | 'tree' | 'commit' | 'tag' | string;
  commitId?: string;
  path: string;
  isFolder: boolean;
  url: string;
  content?: string;
  contentMetadata?: { encoding: number; contentType: string };
}

// ─── Collections ─────────────────────────────────────────────────────────────

export interface TfsProjectCollection {
  id: string;
  name: string;
  url: string;
  collectionUrl: string;
  state: 'Started' | 'Starting' | 'Stopping' | 'Stopped' | string;
}

// ─── Error Structures ─────────────────────────────────────────────────────────

export interface TfsApiError {
  id: string;
  innerException?: unknown;
  message: string;
  typeName: string;
  typeKey: string;
  errorCode: number;
  eventId: number;
}
