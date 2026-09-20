import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const SRC_ROOT = join(import.meta.dir, "..", "..", "src");
const LAYER_ORDER = ["modules", "infrastructure", "app", "interfaces"] as const;
type Layer = (typeof LAYER_ORDER)[number];

function layerOf(filePath: string): Layer | undefined {
  const rel = relative(SRC_ROOT, filePath);
  const [top] = rel.split("/");
  return (LAYER_ORDER as readonly string[]).includes(top) ? (top as Layer) : undefined;
}

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

export interface LayerViolation {
  file: string;
  importedPath: string;
  fromLayer: Layer;
  toLayer: Layer;
}

export function findLayerViolations(): LayerViolation[] {
  const violations: LayerViolation[] = [];

  for (const file of listTsFiles(SRC_ROOT)) {
    const fromLayer = layerOf(file);
    if (!fromLayer) continue;

    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    ts.forEachChild(source, (node) => {
      if (!ts.isImportDeclaration(node)) return;
      const specifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) return;

      const resolvedBase = join(dirname(file), specifier.text);
      const resolved = resolvedBase.endsWith(".ts") ? resolvedBase : `${resolvedBase}.ts`;
      const toLayer = layerOf(resolved);
      if (!toLayer) return;

      const fromIndex = LAYER_ORDER.indexOf(fromLayer);
      const toIndex = LAYER_ORDER.indexOf(toLayer);
      if (toIndex > fromIndex) {
        violations.push({ file, importedPath: specifier.text, fromLayer, toLayer });
      }
    });
  }

  return violations;
}
