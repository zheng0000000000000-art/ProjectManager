export type TaskAuditAction = "task.create" | "task.publish" | "task.take" |
  "task.start" | "task.return" | "task.complete";

export type SafeAuditMetadata = Partial<{
  expectedVersion: number;
  fieldNames: string[];
  actorType: "human" | "ai";
}>;

export type AuditOutcome = "success" | "failure";

export type AuditEntryInput = {
  projectId: string;
  taskId: string | null;
  actorId: string | null;
  action: TaskAuditAction;
  outcome: AuditOutcome;
  errorCode: string | null;
  fromState: string | null;
  toState: string | null;
  requestId: string;
  metadata: SafeAuditMetadata;
  createdAt: string;
};

function validateMetadata(metadata: unknown): SafeAuditMetadata {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("Audit metadata must be an object");
  }

  const safeMetadata: SafeAuditMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    switch (key) {
      case "expectedVersion":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error("Audit metadata expectedVersion must be a finite number");
        }
        safeMetadata.expectedVersion = value;
        break;
      case "fieldNames":
        if (!Array.isArray(value) || !Array.from(value).every((fieldName) => typeof fieldName === "string")) {
          throw new Error("Audit metadata fieldNames must be a string array");
        }
        safeMetadata.fieldNames = value;
        break;
      case "actorType":
        if (value !== "human" && value !== "ai") {
          throw new Error("Audit metadata actorType must be human or ai");
        }
        safeMetadata.actorType = value;
        break;
      default:
        throw new Error(`Unsupported audit metadata key: ${key}`);
    }
  }

  return safeMetadata;
}

export function serializeSafeAuditMetadata(metadata: SafeAuditMetadata): string {
  return JSON.stringify(validateMetadata(metadata));
}

export function parseSafeAuditMetadata(metadataJson: string): SafeAuditMetadata {
  return validateMetadata(JSON.parse(metadataJson));
}
