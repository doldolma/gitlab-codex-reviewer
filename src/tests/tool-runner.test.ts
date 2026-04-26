import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReadonlyToolRunner } from "../lib/tool-runner";

const tempRoots: string[] = [];
const originalAppRoot = process.env.APP_ROOT;

afterEach(async () => {
  process.env.APP_ROOT = originalAppRoot;
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ReadonlyToolRunner", () => {
  it("uses the app-bundled eslint fallback when the workspace does not have eslint installed", async () => {
    const { appRoot, workspace } = await createWorkspaceWithAppEslint(`
#!/bin/sh
printf '[{"filePath":"%s/example.js","messages":[{"severity":2,"ruleId":"no-undef","line":1,"message":"x is not defined"}]}]\\n' "$PWD"
exit 1
`);

    process.env.APP_ROOT = appRoot;
    const events = await new ReadonlyToolRunner().run({ workingDirectory: workspace, changedFiles: ["example.js"], timeoutMs: 5000 });

    const eslint = events.find((event) => event.tool === "eslint");
    expect(eslint?.status).toBe("findings");
    expect(eslint?.findings).toEqual([
      expect.objectContaining({
        tool: "eslint",
        severity: "medium",
        title: "no-undef",
        line: 1,
        summary: "x is not defined"
      })
    ]);
  });

  it("skips eslint when the target repo config needs unavailable plugins", async () => {
    const { appRoot, workspace } = await createWorkspaceWithAppEslint(`
#!/bin/sh
echo "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@typescript-eslint/parser'" >&2
exit 2
`);

    process.env.APP_ROOT = appRoot;
    const events = await new ReadonlyToolRunner().run({ workingDirectory: workspace, changedFiles: ["example.ts"], timeoutMs: 5000 });

    const eslint = events.find((event) => event.tool === "eslint");
    expect(eslint?.status).toBe("skipped");
    expect(eslint?.summary).toContain("plugin/parser");
    expect(eslint?.outputPreview).toContain("Cannot find package");
  });
});

async function createWorkspaceWithAppEslint(script: string): Promise<{ appRoot: string; workspace: string }> {
  const root = await mkdtemp(join(tmpdir(), "glcr-tool-runner-"));
  tempRoots.push(root);

  const appRoot = join(root, "app");
  const workspace = join(root, "workspace");
  const binDir = join(appRoot, "node_modules", ".bin");
  await mkdir(binDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "eslint.config.js"), "export default [];\n");
  await writeFile(join(workspace, "example.js"), "const value = missing;\n");

  const eslintBin = join(binDir, "eslint");
  await writeFile(eslintBin, script.trimStart());
  await chmod(eslintBin, 0o755);

  return { appRoot, workspace };
}
