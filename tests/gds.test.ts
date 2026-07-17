import { describe, expect, it } from "vitest";
import { parseGdsProduct } from "../src/gds/service.js";

describe("parseGdsProduct", () => {
  it("仅映射 GDS 商品名称、GTIN 和描述", () => {
    const body = JSON.stringify({ Data: { Items: [{ ProductName: "测试商品", GTIN: "06921294396362", ProductDescription: "测试描述", Price: 10 }] } });
    expect(parseGdsProduct(body, "06921294396362")).toEqual({ name: "测试商品", barcode: "06921294396362", description: "测试描述" });
  });

  it("没有商品时返回 null", () => {
    expect(parseGdsProduct('{"Code":1,"Data":{"Items":[]}}', "06921294396362")).toBeNull();
  });
});
