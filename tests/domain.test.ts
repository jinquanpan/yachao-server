import { describe, expect, it } from "vitest";
import type { DbRow } from "../src/domain/types.js";
import { requestHash } from "../src/lib/crypto.js";
import { fromCents, toCents } from "../src/lib/money.js";
import { calculateCoupon, checkoutSchema } from "../src/orders/service.js";

describe("money", () => {
  it("使用分计算而不是二进制浮点累计", () => {
    expect(toCents("6.60")).toBe(660);
    expect(fromCents(toCents("6.60") * 3)).toBe("19.80");
  });
});

describe("coupon calculation", () => {
  it("满减券校验门槛并限制最大优惠", () => {
    const row = { type: "fullcut", min_spend: "39.00", amount: "5.00" } as DbRow;
    expect(calculateCoupon(row, 3_800)).toBe(0);
    expect(calculateCoupon(row, 3_900)).toBe(500);
  });

  it("折扣券向下取整到分", () => {
    const row = { type: "discount", min_spend: null, discount: "0.90" } as DbRow;
    expect(calculateCoupon(row, 6_601)).toBe(661);
  });
});

describe("idempotency", () => {
  it("对象键顺序不影响请求摘要", () => {
    expect(requestHash({ address_id: "1", item: { qty: 2, product_id: "3" } }))
      .toBe(requestHash({ item: { product_id: "3", qty: 2 }, address_id: "1" }));
  });
});

describe("checkout input", () => {
  it("购物车与立即购买来源必须二选一", () => {
    expect(checkoutSchema.safeParse({ cart_item_ids: ["1"] }).success).toBe(true);
    expect(checkoutSchema.safeParse({ item: { product_id: "1", qty: 1 } }).success).toBe(true);
    expect(checkoutSchema.safeParse({ cart_item_ids: ["1"], item: { product_id: "1", qty: 1 } }).success).toBe(false);
  });
});
