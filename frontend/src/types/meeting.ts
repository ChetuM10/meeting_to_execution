// mirrors backend extraction/schema.ts
export interface Decision {
  content: string;
  confidence: number;
  source_quote: string;
}

export interface ActionItem {
  task: string;
  owner: string | null;
  deadline: string | null;
  confidence: number;
  ambiguity_flags: string[];
}

export interface OpenQuestion {
  question: string;
  status: 'open' | 'resolved';
}

export interface ExtractionResult {
  decisions: Decision[];
  action_items: ActionItem[];
  open_questions: OpenQuestion[];
}

// mirrors backend workflow/state.ts
export interface ProposedAction {
  id: string;
  task: string;
  owner: string;
  deadline: string;
  confidence: number;
  jira_project_key?: string;
  issue_type?: string;
}

export interface AmbiguityFlag {
  field: string;
  issue: string;
  confidence: string;
}

export interface ResolvedQuestion {
  question_id: string;
  question: string;
  resolved_by: string;
}

export interface ExecutionResult {
  action_id: string;
  status: 'success' | 'failure' | 'skipped';
  jira_issue_key?: string;
  error?: string;
}

// workflow run status enum matching DB
export type WorkflowStatus =
  | 'processing'
  | 'pending_review'
  | 'executing'
  | 'completed'
  | 'rejected'
  | 'failed';

// GET /api/workflow-runs/:id response
export interface WorkflowRun {
  id: string;
  status: WorkflowStatus;
  created_at: string;
  updated_at: string;
  // this is included when status is pending_review
  extraction?: ExtractionResult;
  proposed_actions?: ProposedAction[];
  ambiguity_flags?: AmbiguityFlag[];
  resolved_questions?: ResolvedQuestion[];
  // this is included when status is completed
  execution_results?: ExecutionResult[];
}

// POST /api/meetings response
export interface SubmitTranscriptResponse {
  meeting_id: string;
  workflow_run_id: string;
  status: 'processing';
}

// project from GET /api/projects/:id
export interface Project {
  id: string;
  name: string;
  description: string | null;
  jira_project_key: string | null;
  created_at: string;
}

// auth responses
export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
}

export interface AuthResponse {
  message: string;
  token: string;
  user: AuthUser;
}

// generic API error shape
export interface ApiError {
  error: string;
}
