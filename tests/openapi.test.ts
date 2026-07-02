import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("OpenAPI contract", () => {
  it("是可解析的 OpenAPI 3.1 文档并覆盖领域接口", () => {
    const document = parse(readFileSync(resolve("openapi.yaml"), "utf8"));
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).length).toBeGreaterThanOrEqual(35);
    expect(document.paths["/orders"].post).toBeDefined();
    expect(document.paths["/payments/callback/{channel}"].post).toBeDefined();
  });
});
