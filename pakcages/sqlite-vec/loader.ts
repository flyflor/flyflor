import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function materializeEmbeddedFile(filePath: string, namespace: string, fileName: string) {
  const outDir = join(tmpdir(), namespace);
  const outPath = join(outDir, fileName);

  mkdirSync(outDir, { recursive: true });
  if (!existsSync(outPath)) {
    writeFileSync(outPath, Buffer.from(await Bun.file(filePath).arrayBuffer()));
  }

  return outPath;
}
