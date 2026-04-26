import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../lib/api-helpers";
import { GitLabClient } from "../../../lib/gitlab-client";
import { isAuthFailure, requireSessionUser } from "../../../lib/session";
import { gitlabOAuth, gitlabWebhooks, reviewState } from "../../../lib/services";

export const runtime = "nodejs";

const projectInput = z.object({
  gitlabProjectId: z.string().min(1),
  enabled: z.boolean().default(true),
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
    const ensuredProject = await gitlabWebhooks.ensureProjectWebhook(sharedProject);
    const displayName = gitlabProject.name_with_namespace || gitlabProject.path_with_namespace || String(gitlabProject.id);
    return NextResponse.json({
      project: await reviewState.createProject(user.id, {
        ...input,
        displayName,
        skipLabels: [],
        gitlabProjectId: ensuredProject.gitlabProjectId,
        gitlabProjectRefId: ensuredProject.id
      })
    });
  } catch (error) {
    return jsonError(error);
  }
}

function normalizeProjectInput(input: z.infer<typeof projectInput>): z.infer<typeof projectInput> {
  return {
    ...input,
    mrTargetBranches: uniqueNonEmpty(input.mrTargetBranches),
    commitBranches: uniqueNonEmpty(input.commitBranches)
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
