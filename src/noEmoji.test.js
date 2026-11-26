import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Emoji and Unicode arrows render inconsistently (often as color emoji on
// mobile). Use SVG icons such as ArrowIcon/InlineArrow instead.
const banned =
  /[\p{Extended_Pictographic}\u{FE0F}\u{20E3}\u{2190}-\u{21FF}\u{27F0}-\u{27FF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}]/u;
const root = join(import.meta.dir, "..");
const extensions = /\.(tsx?|jsx?|mjs|css|html)$/;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extensions.test(entry.name) && !entry.name.endsWith(".test.js")
      ? [path]
      : [];
  });
}

describe("no emoji or Unicode arrows", () => {
  test("frontend sources use SVG icons instead", () => {
    const offenders = [...sourceFiles(join(root, "src")), join(root, "index.html")]
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, index) =>
            // ©, ® and ™ are text symbols unless forced to emoji with FE0F.
            banned.test(line.replace(/[\u00A9\u00AE\u2122](?!\uFE0F)/gu, ""))
              ? [`${relative(root, file)}:${index + 1}: ${line.trim()}`]
              : [],
          ),
      );
    expect(offenders).toEqual([]);
  });
});
