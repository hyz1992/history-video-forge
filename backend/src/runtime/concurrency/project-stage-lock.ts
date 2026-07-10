export type ProjectStage = string;

export function createProjectStageLockRegistry() {
  const active = new Set<string>();
  return {
    acquire(projectId: string, stage: ProjectStage): () => void {
      const key = `${projectId}:${stage}`;
      if (active.has(key)) throw new Error("project_stage_run_in_progress");
      active.add(key);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active.delete(key);
      };
    },
  };
}
