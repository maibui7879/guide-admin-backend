import { ConflictException } from '@nestjs/common';
import { ContentState } from '../entities/content.entities';

export type WorkflowAction =
  | 'edit'
  | 'restore'
  | 'submit'
  | 'approve'
  | 'return'
  | 'publish'
  | 'archive';
const transitions: Record<WorkflowAction, Partial<Record<ContentState, ContentState>>> = {
  edit: { draft: 'draft', published: 'draft' },
  restore: { draft: 'draft', published: 'draft' },
  submit: { draft: 'in_review' },
  approve: { in_review: 'approved' },
  return: { in_review: 'draft', approved: 'draft' },
  publish: { approved: 'published' },
  archive: {
    draft: 'archived',
    in_review: 'archived',
    approved: 'archived',
    published: 'archived',
  },
};
export function transition(state: ContentState, action: WorkflowAction): ContentState {
  const next = transitions[action][state];
  if (!next) throw new ConflictException('Invalid content transition');
  return next;
}
