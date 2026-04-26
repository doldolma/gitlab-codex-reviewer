import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../lib/api-helpers";
import { GitLabClient } from "../../../lib/gitlab-client";
import { isAuthFailure, requireSessionUser } from "../../../lib/session";
import { gitlabOAuth, reviewState } from "../../../lib/services";

export const runtime = "nodejs";

const projectInput = z.object({
  gitlabProjectId: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean().default(true),
  skipLabels: z.array(z.string()).default([]),
  mrTargetBranches: z.array(z.string()).default([]),
  commitBranches: z.array(z.string()).default([])
});

export async function GET() {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  return NextResponse.json({ projects: await reviewState.listProjects(user.id, false) });
}

export async function POST(request: Request) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const input = normalizeProjectInput(projectInput.parse(await readJson(request)));
    const connection = await gitlabOAuth.getValidConnection(user.id);
    if (!connection) throw new Error("GitLab is not connected");
    const gitlabProject = await new GitLabClient(connection).getProject(input.gitlabProjectId);
    const sharedProject = await reviewState.upsertGitlabProject({
      gitlabHost: connection.gitlabHost,
      gitlabProjectId: String(gitlabProject.id),
      pathWithNamespace: gitlabProject.path_with_namespace,
      nameWithNamespace: gitlabProject.name_with_namespace,
      webUrl: gitlabProject.web_url ?? null,
      cloneHttpUrl: gitlabProject.http_url_to_repo ?? null,
      defaultBranch: gitlabProject.default_branch ?? null
    });
    return NextResponse.json({
      project: await reviewState.createProject(user.id, {
        ...input,
        gitlabProjectId: sharedProject.gitlabProjectId,
        gitlabProjectRefId: sharedProject.id
      })
    });
  } catch (error) {
    return jsonError(error);
  }
}

function normalizeProjectInput(input: z.infer<typeof projectInput>): z.infer<typeof projectInput> {
  return {
    ...input,
    skipLabels: uniqueNonEmpty(input.skipLabels),
    mrTargetBranches: uniqueNonEmpty(input.mrTargetBranches),
    commitBranches: uniqueNonEmpty(input.commitBranches)
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
