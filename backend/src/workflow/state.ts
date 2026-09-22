import { Annotation } from '@langchain/langgraph';
import { ExtractionResult } from '../extraction/schema';
import { HistoricalContext } from '../extraction/history';
import { ResolvedQuestion } from '../extraction/resolver';

export interface AmbiguityFlag {
    field: string;
    issue: string;
    confidence: string;
}

export interface proposedAction {
    id: string;
    task: string;
    owner: string;
    deadline: string;
    confidence: string;
    jira_project_key?: string;
    issue_type?: string;
}

export interface ExecutionResult {
    action_id: string;
    status: 'success' | 'failure' | 'skipped';
    jira_issue_key?: string;
    error?: string;
}

export const WorkflowAnnotation = Annotation.Root({
    transcript: Annotation<string>(),
    project_id: Annotation<string>(),
    workflow_id: Annotation<string>(),

    historical_context: Annotation<HistoricalContext | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),

    draft_extraction: Annotation<any | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),

    validated_extraction: Annotation<ExtractionResult | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),

    validation_error: Annotation<string | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),

    retry_count: Annotation<number>({
        reducer: (_, next) => next,
        default: () => 0,
    }),

    needs_manual_entry: Annotation<boolean>({
        reducer: (_, next) => next,
        default: () => false,
    }),

    resolved_question: Annotation<ResolvedQuestion[]>({
        reducer: (_, next) => next,
        default: () => [],
    }),

    ambiguity_flags: Annotation<AmbiguityFlag[]>({
        reducer: (_, next) => next,
        default: () => [],
    }),

    proposed_action: Annotation<proposedAction[]>({
        reducer: (_, next) => next,
        default: () => [],
    }),

    review_status: Annotation<'pending' | 'approved' | 'rejected'>({
        reducer: (_, next) => next,
        default: () => 'pending',
    }),

    edited_actions: Annotation<proposedAction[] | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),

    execution_result: Annotation<ExecutionResult[]>({
        reducer: (_, next) => next,
        default: () => [],
    }),

    error: Annotation<string | null>({
        reducer: (_, next) => next,
        default: () => null,
    }),
});

export type WorkflowState = typeof WorkflowAnnotation.State;