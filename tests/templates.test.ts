import { expect, test } from "bun:test";

import { detectDevServer } from "../lib/execution/preview/plan";
import { TEMPLATES, templateById } from "../lib/templates/catalogue";
import { TEMPLATE_OPTIONS } from "../lib/templates/options";
import {
  TEMPLATE_MAX_FILES,
  isTemplateId,
  isTemplatePath,
  isTemplateRepoName,
  templateFilesValid,
} from "../lib/templates/plan";

/**
 * A template is only a starting point if it actually runs.
 *
 * The last test here is the one that matters: each template's own `package.json`
 * is fed to the preview detector, so a template whose dev script the preview
 * cannot read fails at build time rather than after someone creates a repository
 * from it.
 */

test("the picker and the catalogue describe the same templates", () => {
  expect(TEMPLATE_OPTIONS.map((option) => option.id).sort()).toEqual(
    TEMPLATES.map((template) => template.id).sort()
  );

  for (const option of TEMPLATE_OPTIONS) {
    const template = templateById(option.id);

    expect(template).not.toBeNull();
    expect(template?.name).toBe(option.name);
    expect(template?.files.length).toBe(option.files);
  }
});

test("every template is small, safe and versioned", () => {
  for (const template of TEMPLATES) {
    expect(template.files.length).toBeGreaterThan(0);
    expect(template.files.length).toBeLessThanOrEqual(TEMPLATE_MAX_FILES);
    expect(templateFilesValid(template.files)).toBe(true);

    const paths = template.files.map((file) => file.path);
    expect(paths).toContain("package.json");
    expect(new Set(paths).size).toBe(paths.length);

    for (const path of paths) {
      expect(isTemplatePath(path)).toBe(true);
      expect(path.startsWith("/")).toBe(false);
      expect(path.includes("..")).toBe(false);
    }
  }
});

test("a template's dev script is one the preview detector understands", () => {
  for (const template of TEMPLATES) {
    const pkg = template.files.find((file) => file.path === "package.json");

    expect(pkg).toBeDefined();

    const detected = detectDevServer({
      paths: template.files.map((file) => file.path),
      packageJson: JSON.parse(pkg?.content ?? "null"),
    });

    expect(detected.ok).toBe(true);
    if (!detected.ok) return;

    expect(detected.plan.command).toContain("run dev");
    expect(detected.plan.port).toBe(template.devPort);
  }
});

test("repository names are checked before GitHub sees them", () => {
  for (const good of ["my-app", "app_2", "App.Name", "a"]) {
    expect(isTemplateRepoName(good)).toBe(true);
  }

  for (const bad of [
    "",
    "-leading-dash",
    ".hidden",
    "has space",
    "trailing.git",
    ".",
    "..",
    "a".repeat(101),
    "../escape",
    "owner/name",
    null,
    42,
  ]) {
    expect(isTemplateRepoName(bad)).toBe(false);
  }
});

test("template ids are slugs, and paths cannot leave the repository", () => {
  expect(isTemplateId("next-starter")).toBe(true);
  expect(isTemplateId("Next-Starter")).toBe(false);
  expect(isTemplateId("../etc")).toBe(false);

  expect(isTemplatePath("app/page.tsx")).toBe(true);
  expect(isTemplatePath(".gitignore")).toBe(true);

  for (const bad of ["/etc/passwd", "../secrets", ".git/config", "a\\b", "https://x", ""]) {
    expect(isTemplatePath(bad)).toBe(false);
  }
});
