import { describe, expect, it } from "vitest";
import { parseGdsProduct } from "../src/gds/service.js";

describe("parseGdsProduct", () => {
  it("仅映射模板所需的 GDS 商品字段", () => {
    const body = JSON.stringify({ Data: { Items: [{ productFullName: "测试商品", brandcn: "测试品牌", specification: "250ml", gtin: "06921294396362", firm_name: "测试厂商", branch_name: "测试分中心", gpcname: "测试品类", valid_date: "2026-12-31", picture_filename: "/test.jpg", Price: 10 }] } });
    expect(parseGdsProduct(body, "06921294396362")).toEqual({ productFullName: "测试商品", brandcn: "测试品牌", specification: "250ml", gtin: "06921294396362", firm_name: "测试厂商", branch_name: "测试分中心", gpcname: "测试品类", valid_date: "2026-12-31", picture_filename: "/test.jpg" });
  });

  it("没有商品时返回 null", () => {
    expect(parseGdsProduct('{"Code":1,"Data":{"Items":[]}}', "06921294396362")).toBeNull();
  });
});
