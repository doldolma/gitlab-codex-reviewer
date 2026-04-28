import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../lib/api-helpers";
import { GitLabClient } from "../../../../lib/gitlab-client";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { gitlabOAuth, reviewState } from "../../../../lib/services";

export const runtime = "nodejs";

const manualReleaseNoteInput = z.object({
  gitlabProjectId: z.string().min(1),
  tagName: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const input = manualReleaseNoteInput.parse(await readJson(request));
    if (!input.tagName.startsWith("v")) throw new Error("Release note tag must start with v");

    const connection = await gitlabOAuth.getValidConnection(user.id);
    if (!connection) throw new Error("GitLab is not connected");
    const client = new GitLabClient(connection);
    const [project, tags] = await Promise.all([
      client.getProject(input.gitlabProjectId),
      client.listTags(input.gitlabProjectId)
    ]);
    const tag = tags.find((candidate) => candidate.name === input.tagName);
    if (!tag) throw new Error("Selected release tag was not found");
    const tagSha = tag.commit?.id ?? tag.target;
    if (!tagSha) throw new Error("Selected release tag does not include a commit sha");

    const sharedProject = await reviewState.upsertGitlabProject({
      gitlabHost: connection.gitlabHost,
      gitlabProjectId: String(project.id),
      pathWithNamespace: project.path_with_namespace,
      nameWithNamespace: project.name_with_namespace,
      webUrl: project.web_url ?? null,
      cloneHttpUrl: project.http_url_to_repo ?? null,
      defaultBranch: project.default_branch ?? null
    });
    const { releaseNote, entry } = await reviewState.createQueuedReleaseNote({
      gitlabProjectRefId: sharedProject.id,
      gitlabProjectId: sharedProject.gitlabProjectId,
      projectName: project.name_with_namespace || project.path_with_namespace || String(project.id),
      tagName: tag.name,
      tagSha,
      tagUrl: tag.web_url ?? tagWebUrl(project.web_url ?? null, tag.name),
      trigger: "manual",
      createdByUserId: user.id
    });

    const job = await reviewState.createReviewJob({
      kind: "release_note_manual",
      userId: user.id,
      payload: {
        releaseNoteId: releaseNote.id,
        releaseNoteEntryId: entry.id,
        gitlabProjectRefId: sharedProject.id,
        gitlabProjectId: sharedProject.gitlabProjectId,
        tagName: tag.name,
        tagSha: releaseNote.tagSha
      }
    });

    return NextResponse.json({ releaseNote, entry, job });
  } catch (error) {
    return jsonError(error);
  }
}

function tagWebUrl(projectWebUrl: string | null, tagName: string): string | null {
  if (!projectWebUrl) return null;
  return `${projectWebUrl.replace(/\/$/, "")}/-/tags/${encodeURIComponent(tagName)}`;
}
