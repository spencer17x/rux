import { describe, expect, it } from "vitest";
import { parseNumstatZ, parsePorcelainV1Z } from "./git-status";

describe("parsePorcelainV1Z", () => {
  it("preserves spaces and non-ASCII paths", () => {
    expect(parsePorcelainV1Z(" M src/你好 world.ts\0?? new file.txt\0")).toEqual([
      { statusCode: " M", filePath: "src/你好 world.ts" },
      { statusCode: "??", filePath: "new file.txt" },
    ]);
  });

  it("uses the destination path for renames", () => {
    expect(parsePorcelainV1Z("R  new name.ts\0old name.ts\0")).toEqual([
      { statusCode: "R ", filePath: "new name.ts" },
    ]);
  });
});

describe("parseNumstatZ", () => {
  it("parses regular and renamed files", () => {
    const counts = parseNumstatZ("3\t1\tsrc/a file.ts\0" + "5\t2\t\0old.ts\0new.ts\0");
    expect(counts.get("src/a file.ts")).toEqual({ plus: 3, minus: 1 });
    expect(counts.get("new.ts")).toEqual({ plus: 5, minus: 2 });
  });

  it("treats binary counts as zero", () => {
    expect(parseNumstatZ("-\t-\timage.png\0").get("image.png")).toEqual({ plus: 0, minus: 0 });
  });
});
