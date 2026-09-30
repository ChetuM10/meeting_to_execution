import type {
  AuthResponse,
  Project,
  SubmitTranscriptResponse,
  WorkflowRun,
  ProposedAction,
} from '../types/meeting';

const API_BASE = '/api';

// reads JWT from localStorage
function getToken(): string | null {
  return localStorage.getItem('token');
}

// attaches auth header and handles errors
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// auth

export async function register(
  email: string,
  password: string,
  full_name?: string
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, full_name }),
  });
}

export async function login(
  email: string,
  password: string
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

//    projects

export async function createProject(
  name: string,
  description?: string,
  jira_project_key?: string
): Promise<{ message: string; project: Project }> {
  return apiFetch('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, description, jira_project_key }),
  });
}

export async function getProject(id: string): Promise<{ project: Project }> {
  return apiFetch(`/projects/${id}`);
}

// meetings 

export async function submitTranscript(
  project_id: string,
  transcript: string
): Promise<SubmitTranscriptResponse> {
  return apiFetch('/meetings', {
    method: 'POST',
    body: JSON.stringify({ project_id, transcript }),
  });
}

// workflow runs 

export async function getWorkflowRun(id: string): Promise<WorkflowRun> {
  return apiFetch(`/workflow-runs/${id}`);
}

export async function approveWorkflow(
  id: string,
  edited_actions?: ProposedAction[]
): Promise<{ status: string }> {
  return apiFetch(`/workflow-runs/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ edited_actions }),
  });
}

export async function rejectWorkflow(
  id: string
): Promise<{ status: string }> {
  return apiFetch(`/workflow-runs/${id}/reject`, {
    method: 'POST',
  });
}

// integrations

export async function connectJira(params: {
  workspaceId: string;
  domain: string;
  email: string;
  apiToken: string;
  expiresAt?: string;
}): Promise<{ message: string; Connection: Record<string, unknown> }> {
  return apiFetch('/integrations/jira/connect', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getJiraStatus(
  workspaceId: string
): Promise<{ connected: boolean; isExpired?: boolean; expiresAt?: string; connectedAt?: string }> {
  return apiFetch(`/integrations/jira/status?workspaceId=${workspaceId}`);
}
