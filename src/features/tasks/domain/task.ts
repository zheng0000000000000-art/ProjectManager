export type PublicationState = "draft" | "published";

export type WorkStatus = "open" | "taken" | "in_progress" | "completed";

export interface TaskRecord {
  id: string;
  projectId: string;
  title: string;
  goal: string;
  workTypeId: string | null;
  estimatedBlocks: number | null;
  deadline: string | null;
  publicationState: PublicationState;
  workStatus: WorkStatus;
  assigneeId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completionSummary: string | null;
  version: number;
}

export interface PublishTaskValues {
  title: string;
  goal: string;
  workTypeId: string;
  estimatedBlocks: number;
  deadline: string | null;
}
