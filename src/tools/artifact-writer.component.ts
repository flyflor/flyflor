import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Component } from "../di";

/**
 * Writes raw tool outputs to local artifact files.
 *
 * @usage ShellTool and future tools use this to preserve raw outputs before truncation or compression.
 */
@Component()
export class ArtifactWriterComponent {
  /**
   * Writes text to a timestamped artifact file.
   *
   * @param dir - Absolute artifact directory.
   * @param prefix - Filename prefix.
   * @param text - Text content to write.
   * @returns Absolute artifact path.
   * @usage Tool results include the returned path for auditability.
   */
  public writeText(dir: string, prefix: string, text: string): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${Date.now()}-${prefix}.txt`);
    writeFileSync(path, text, "utf8");
    return path;
  }
}
