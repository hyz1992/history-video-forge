import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app";
import { createLegacyProject } from "../projects/legacy-project.fixture.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context";

describe("project delete permission (guardOwnedRoute)", () => {
  it("USER 可以删除自己的项目，返回 200", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({
      userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a",
    });

    const created = await createLegacyProject(app.db, { name: 'A项目', ownerId: userA.userId, createdById: userA.userId });
const projectId = created.id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
      auth: userA,
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(app.db.projects.has(projectId)).toBe(false);
  });

  it("USER 不能删除别人的项目，返回 404 project_not_found（不暴露存在性）", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({
      userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a",
    });
    const userB = createAuthenticatedAuthContext({
      userId: "user-b", username: "b", displayName: "B", role: "USER", sessionId: "s-b",
    });

    const created = await createLegacyProject(app.db, { name: 'A项目', ownerId: userA.userId, createdById: userA.userId });
const projectId = created.id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
      auth: userB,
    });

    expect(deleted.statusCode).toBe(404);
    expect(deleted.json()).toMatchObject({ error: "project_not_found" });
    // 项目仍在
    expect(app.db.projects.has(projectId)).toBe(true);
  });

  it("ADMIN 可以删除任意用户的项目，返回 200", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({
      userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a",
    });
    const admin = createAuthenticatedAuthContext({
      userId: "admin-x", username: "admin", displayName: "Admin", role: "ADMIN", sessionId: "s-admin",
    });

    const created = await createLegacyProject(app.db, { name: 'A项目', ownerId: userA.userId, createdById: userA.userId });
const projectId = created.id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
      auth: admin,
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(app.db.projects.has(projectId)).toBe(false);
  });

  it("未登录返回 401", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/projects/any-id",
    });
    expect(response.statusCode).toBe(401);
  });
});
