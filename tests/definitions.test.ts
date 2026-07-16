import { describe, expect, it } from "vitest";
import { resources } from "../src/resources/definitions.js";

describe("resource definitions", () => {
  it("包含 Excel 中的 28 张表", () => {
    expect(Object.keys(resources)).toHaveLength(28);
    expect(Object.values(resources).reduce((total, item) => total + Object.keys(item.columns).length, 0)).toBe(237);
  });

  it("所有主键和必填字段都属于表字段", () => {
    for (const definition of Object.values(resources)) {
      for (const field of [...definition.primaryKey, ...definition.required]) {
        expect(definition.columns, `${definition.table}.${field}`).toHaveProperty(field);
      }
    }
  });
});
