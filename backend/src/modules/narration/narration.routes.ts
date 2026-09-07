import { narrationVisibleStatus } from "./narration-readiness.js";
import { getNarrationProjectSnapshot } from "../projects/project-snapshot.service.js";
import { z } from "zod";
import type { AppInstance, RouteContext, AppResponse } from "../../app.js";
import { requireUser, requireOwner, handleControllerAuthError } from "../../auth/authorization.js";
import { GenerateNarrationRequest, ConfirmNarrationRequest } from "../../../../shared/src/index.js";
import { NarrationRepository } from "./narration.repository.js";
import { prepareNarrationRun, confirmNarration } from "./narration-run.service.js";
import { cancelNarrationProvider } from "../generation-run/narration-dispatch-handler.js";
import { respondNarrationSubmission } from "../generation-run/submit-protocol.js";
function route(handler: (context: RouteContext, ownerId: string, actorId: string) => Promise<AppResponse>) {
    return async (context: RouteContext): Promise<AppResponse> => {
        try {
            const user = requireUser(context.auth), client = context.app.db.narrationPersistence.prismaClient ?? context.app.db.firstAggregateWriter?.narrationPrismaClient;
            const project = client ? await client.project.findFirst({ where: { id: context.params.projectId, archivedAt: null } }) : context.app.db.projects.get(context.params.projectId);
            if (!project)
                return { statusCode: 404, body: { error: "project_not_found" } };
            requireOwner(user, project.ownerId);
            return await handler(context, project.ownerId, user.userId);
        }
        catch (error) {
            const auth = handleControllerAuthError(error);
            if (auth)
                return auth;
            if (error instanceof z.ZodError)
                return { statusCode: 422, body: { error: "narration_request_invalid" } };
            const code = error instanceof Error ? error.message : "narration_internal_error";
            const status = code === "project_scope_denied" || code === "narration_not_found" ? 404 : code === "generation_run_persistence_failed" ? 500 : code === "narration_execution_incompatible" || code === "narration_request_invalid" || code === "narration_text_too_long" || code === "narration_paragraph_too_long" ? 422 : 409;
            return { statusCode: status, body: { error: code } };
        }
    };
}
export function registerNarrationRoutes(app: AppInstance) {
    app.addRoute("POST", "/api/projects/:projectId/script/:scriptRecordId/confirm", route(async (c, owner, actor) => {
        const input = z.object({ source_text_sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(c.payload);
        const confirmation = await new NarrationRepository(c.app.db).confirmScript(owner, actor, c.params.projectId, c.params.scriptRecordId, input.source_text_sha256);
        return { statusCode: 200, body: { confirmation } };
    }));
    app.addRoute("POST", "/api/projects/:projectId/script/narration/generate", route(async (c, owner, actor) => {
        const result = await prepareNarrationRun(c.app, c.params.projectId, owner, actor, GenerateNarrationRequest.parse(c.payload));
        return respondNarrationSubmission(c, result);
    }));
    app.addRoute("GET", "/api/projects/:projectId/script/narrations/:recordId", route(async (c, owner) => {
        const repo = new NarrationRepository(c.app.db), record = await repo.findByIdForOwner(c.params.projectId, owner, c.params.recordId);
        if (!record)
            return { statusCode: 404, body: { error: "narration_not_found" } };
        const run = await c.app.generationRunRepository.getRunById(record.generationRunId);
        const base = "/api/projects/" + encodeURIComponent(record.projectId) + "/script/narrations/" + encodeURIComponent(record.id);
        return { statusCode: 200, body: { record, effective_status: narrationVisibleStatus(record.status, run?.status ?? null), run_status: run?.status ?? null, files: record.output ? { audio: base + "/files/audio", timing: base + "/files/timing", events: base + "/files/events", srt: base + "/subtitles/" + record.output.initialSubtitleRevisionId + "/files/srt", vtt: base + "/subtitles/" + record.output.initialSubtitleRevisionId + "/files/vtt" } : null } };
    }));
    app.addRoute("POST", "/api/projects/:projectId/script/narrations/:recordId/confirm", route(async (c, owner, actor) => {
        const record = await confirmNarration(c.app, c.params.projectId, owner, actor, c.params.recordId, ConfirmNarrationRequest.parse(c.payload));
        const snapshot = await getNarrationProjectSnapshot(c.app.db, c.params.projectId, owner, c.app.storageBaseDir, c.app.topicCandidateStore);
        return { statusCode: 200, body: { record, snapshot } };
    }));
    app.addRoute("POST", "/api/projects/:projectId/script/narrations/:recordId/cancel", route(async (c, owner) => {
        z.object({}).strict().parse(c.payload);
        const record = await new NarrationRepository(c.app.db).cancel(owner, c.params.projectId, c.params.recordId);
        cancelNarrationProvider(record.generationRunId);
        return { statusCode: 200, body: { record } };
    }));
}
