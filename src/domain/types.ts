import type { RowDataPacket } from "mysql2";

export interface DbRow extends RowDataPacket {
  // SQL 查询包含动态别名与 JSON 表达式，mysql2 无法静态推导每一列。
  // 进入响应或业务计算前由各领域格式化器完成显式转换。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export const ORDER_STATUSES = ["pending-payment", "pending-shipment", "pending-receipt", "completed", "cancelled", "after-sale"] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
