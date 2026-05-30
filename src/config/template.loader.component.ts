import { readFileSync } from "node:fs";
import { Component } from "../di";
import { ConfigService } from "./config.service";

/**
 * Loads constitutional templates from `.config/templates`.
 *
 * @usage Context building uses this component for `SOUL.md`, `USER.md`, and `MEMORY.md`.
 */
@Component()
export class TemplateLoaderComponent {
  public constructor(private readonly configService = new ConfigService()) {}

  /**
   * Reads one template by filename from the configured templates directory.
   *
   * @param fileName - Template filename such as `SOUL.md`.
   * @returns UTF-8 template text.
   * @usage Runtime loads `.md` templates only; `.zh.cn.md` mirrors are human-facing.
   */
  public readTemplate(fileName: string): string {
    if (!fileName.endsWith(".md") || fileName.endsWith(".zh.cn.md")) {
      throw new Error(`Runtime template must be an English .md file: ${fileName}`);
    }
    const config = this.configService.getConfig();
    return readFileSync(this.configService.resolve(`${config.paths.templatesDir}/${fileName}`), "utf8");
  }

  /**
   * Reads all constitutional templates in stable context order.
   *
   * @returns Template sections with names and content.
   * @usage ContextModule injects these sections before runtime prompts.
   */
  public readCoreTemplates(): readonly TemplateSection[] {
    return ["SOUL.md", "USER.md", "MEMORY.md"].map((fileName) => ({
      name: fileName.replace(".md", ""),
      content: this.readTemplate(fileName),
    }));
  }
}

/**
 * Describes a loaded constitutional template section.
 *
 * @property name - Logical section name.
 * @property content - Markdown template text.
 * @usage Returned by `TemplateLoaderComponent` to context builders.
 */
export interface TemplateSection {
  readonly name: string;
  readonly content: string;
}
