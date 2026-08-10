import type {
  LlmInteractionLogEntry,
  LlmInteractionLogWriter,
} from "../../runtime/llm/interaction-log.js";

export interface ChunkInteractionAccountingSnapshot {
  chunk_id: string;
  business_slot: number;
  logical_invocation: number;
  safety_invocation: number;
  provider_attempts: number;
  network_request_count: number;
}

export interface ChunkInvocationTag {
  businessSlot: 1 | 2 | 3;
  safety: boolean;
}

export interface ChunkInteractionAccounting {
  beginInvocation(tag: ChunkInvocationTag): LlmInteractionLogWriter;
  snapshot(): ChunkInteractionAccountingSnapshot;
}

function countValidAttempts(entry: LlmInteractionLogEntry): number {
  if (!Array.isArray(entry.attempts)) return 0;
  return entry.attempts.filter(
    (attempt) =>
      attempt !== null &&
      typeof attempt === "object" &&
      Number.isSafeInteger(attempt.attempt) &&
      attempt.attempt > 0 &&
      (attempt.outcome === "success" || attempt.outcome === "error"),
  ).length;
}

function isRuntimeInteractionEntry(
  entry: unknown,
): entry is LlmInteractionLogEntry {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry);
}

export function createChunkInteractionAccounting(
  chunkId: string,
  downstream?: LlmInteractionLogWriter,
): ChunkInteractionAccounting {
  let businessSlot = 0;
  let logicalInvocation = 0;
  let safetyInvocation = 0;
  let providerAttempts = 0;

  return {
    beginInvocation(tag) {
      businessSlot = Math.max(businessSlot, tag.businessSlot);
      logicalInvocation += 1;
      if (tag.safety) safetyInvocation += 1;
      let recorded = false;
      return {
        write(entry) {
          if (!isRuntimeInteractionEntry(entry)) return;
          if (!recorded) {
            recorded = true;
            providerAttempts += countValidAttempts(entry);
          }
          return downstream?.write(entry);
        },
      };
    },
    snapshot() {
      return {
        chunk_id: chunkId,
        business_slot: businessSlot,
        logical_invocation: logicalInvocation,
        safety_invocation: safetyInvocation,
        provider_attempts: providerAttempts,
        network_request_count: providerAttempts,
      };
    },
  };
}
