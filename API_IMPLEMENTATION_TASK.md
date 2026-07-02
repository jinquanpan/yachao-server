# 山海灵感便利店服务端接口实施任务

> 交付对象：服务端开发 Agent  
> 梳理日期：2026-06-30  
> 权威数据结构：`database/schema.sql`  
> 前端依据：`E:/lx/shanhai-store-project/src/routes/*`、`src/lib/store.ts`、`PROJECT_INTRODUCTION.md`

## 1. 目标与当前结论

前端现有 15 个页面，商品、购物车、收藏、地址和订单均使用本地 mock/Zustand，尚未调用服务端。

服务端已经提供 `/api/v1/resources/*` 通用资源 CRUD，并覆盖 `schema.sql` 的全部 28 张表。该接口适合后台管理、数据维护和临时联调，但不能直接充当用户侧业务 API：它允许客户端传入 `user_id`、价格、订单状态等敏感字段，也无法保证下单、扣库存、用券、支付和退款的一致性。

本任务不是再生成一套逐表 CRUD，而是在现有项目中新增面向 App 的领域接口，并保留通用资源层供管理端使用。

### 优先级

- **P0（首轮联调必须）**：认证、首页/商品、购物车、收藏、地址、订单创建/查询/取消/收货。
- **P1（完整交易链）**：优惠券、支付、退款、扫码录入、版本检查。
- **P2（运营管理）**：Banner/推荐位管理、商品/SKU/库存管理、扫码审核、发货、日志查询。
- **待确认/需扩表**：会员等级与积分、消息通知偏好，见第 8 节。

## 2. 页面 → 接口 → 表链路

| 前端页面/行为 | 需要的业务接口 | 主要表 | 优先级 |
|---|---|---|---|
| `/` 手机号/第三方登录、退出 | 登录、刷新会话、退出、当前用户 | `users`、`user_auths`、`user_sessions` | P0 |
| `/home` 首页 Banner、快捷分类、推荐、新品分页 | 首页聚合、商品分页 | `banners`、`recommend_positions`、`recommend_items`、`categories`、`products`、`product_tags`、`tags` | P0 |
| `/category` 分类、搜索、按类筛选 | 分类树、商品搜索/筛选 | `categories`、`products`、`product_tags`、`tags` | P0 |
| `/discover` 商品瀑布流 | 商品分页 | `products`、`categories`、`product_tags`、`tags` | P0 |
| `/product/:id` 详情、SKU、收藏、加购、立即购买 | 商品详情、收藏切换、购物车写入 | `products`、`product_skus`、`product_specs`、`product_tags`、`tags`、`favorites`、`cart_items` | P0 |
| `/cart` 查询、改数量、删除、选中 | 购物车增删改查、批量选择 | `cart_items`、`products`、`product_skus` | P0 |
| `/checkout` 地址、金额、优惠券、提交订单 | 结算预览、可用券、创建订单 | `addresses`、`cart_items`、`products`、`product_skus`、`coupons`、`user_coupons`、`orders`、`order_items`、`order_status_log`、`stock_records` | P0/P1 |
| `/address` 地址选择、默认、新增/编辑/删除 | 地址 CRUD、设默认 | `addresses` | P0 |
| `/profile` 用户资料、收藏数、券数、订单状态数 | 我的资料与统计 | `users`、`favorites`、`user_coupons`、`orders` | P0 |
| `/favorites` 列表、取消、加购 | 收藏列表/添加/删除 | `favorites`、`products`、`product_tags`、`tags` | P0 |
| `/orders/:status` 状态筛选 | 我的订单分页、状态计数 | `orders`、`order_items` | P0 |
| `/order/:id` 详情、取消、付款、确认收货、退款 | 订单详情及状态动作 | `orders`、`order_items`、`order_status_log`、`payments`、`refunds`、`stock_records` | P0/P1 |
| `/scan-entry` 条码查询、图片、提交待审商品 | 条码查询、图片上传、扫码录入 | `scan_products`、`scan_api_cache`、`categories` | P1 |
| `/settings` 退出、版本信息 | 退出、最新版本 | `user_sessions`、`app_versions` | P1 |
| `/membership` 等级、积分、权益 | 暂不可完整实现 | 当前 28 表无会员/积分表 | 待扩表 |

## 3. P0 接口清单

所有路径基于 `/api/v1`。除登录、公开商品和支付回调外，用户接口必须从会话中取得 `user_id`，禁止信任请求体或查询参数里的 `user_id`。

### 3.1 认证与用户

| 方法 | 路径 | 用途 | 表 |
|---|---|---|---|
| `POST` | `/auth/phone/login` | 手机号验证码登录；当前无验证码表，可先接验证码服务/开发桩，成功后创建或更新用户和会话 | `users`、`user_sessions` |
| `POST` | `/auth/oauth/login` | 微信/Apple 等第三方登录 | `user_auths`、`users`、`user_sessions` |
| `POST` | `/auth/refresh` | 刷新用户会话 | `user_sessions` |
| `POST` | `/auth/logout` | 删除/失效当前会话 | `user_sessions` |
| `GET` | `/me` | 当前用户资料及收藏、可用券、订单状态统计 | `users`、`favorites`、`user_coupons`、`orders` |
| `PATCH` | `/me` | 修改昵称、头像 | `users` |

当前 `API_TOKEN` 是服务级静态 Bearer Token，不是 App 用户会话。请新增用户认证中间件；`/resources` 继续由管理 Token 保护，不得用 App 会话开放通用表写入。

### 3.2 首页、分类与商品

| 方法 | 路径 | 查询/说明 | 表 |
|---|---|---|---|
| `GET` | `/home` | 一次返回有效 Banner、快捷分类、推荐位商品；只返回上架且未软删商品 | `banners`、`categories`、`recommend_positions`、`recommend_items`、商品相关表 |
| `GET` | `/categories` | 分类树，按 `sort` 排序 | `categories` |
| `GET` | `/products` | `page`、`pageSize`、`category`、`keyword`、`tag`、`sort=newest|sales|price_asc|price_desc` | `products`、`categories`、`product_tags`、`tags` |
| `GET` | `/products/:id` | 商品、分类、标签、SKU、规格；返回 `is_favorite`（已登录时） | `products`、`categories`、`tags`、`product_tags`、`product_skus`、`product_specs`、`favorites` |

商品列表响应至少包含：`id`、`name`、`subtitle`、`price`、`cover_image`、`spec`、`stock`、`category`、`tags`。金额统一返回十进制字符串，避免 JS 浮点误差。

### 3.3 购物车

| 方法 | 路径 | 请求/规则 | 表 |
|---|---|---|---|
| `GET` | `/cart` | 返回商品/SKU 快照展示字段、库存、失效状态和汇总 | `cart_items`、`products`、`product_skus` |
| `POST` | `/cart/items` | `{ product_id, sku_id?, qty }`；同商品/SKU 已存在则累加 | `cart_items` |
| `PATCH` | `/cart/items/:id` | `{ qty?, selected? }`；`qty >= 1` 且不得超过有效库存 | `cart_items`、商品库存表 |
| `DELETE` | `/cart/items/:id` | 只能删除当前用户条目 | `cart_items` |
| `PATCH` | `/cart/selection` | `{ selected, item_ids? }`；支持全选或批量选择 | `cart_items` |
| `DELETE` | `/cart/items` | 清空当前用户购物车；可选仅删除选中项 | `cart_items` |

注意：MySQL 唯一键包含可空 `sku_id` 时，多个 `NULL` 可能不冲突。无 SKU 商品的“存在则累加”需要事务内显式查询锁定，不能只依赖 `uk_cart_items_user_product_sku`。

### 3.4 收藏

| 方法 | 路径 | 规则 | 表 |
|---|---|---|---|
| `GET` | `/favorites` | 当前用户收藏商品分页，按收藏时间倒序 | `favorites`、商品相关表 |
| `PUT` | `/favorites/:productId` | 幂等收藏，重复请求仍成功 | `favorites` |
| `DELETE` | `/favorites/:productId` | 幂等取消收藏 | `favorites` |

### 3.5 地址

| 方法 | 路径 | 规则 | 表 |
|---|---|---|---|
| `GET` | `/addresses` | 当前用户地址，默认地址置顶 | `addresses` |
| `POST` | `/addresses` | 新增；首个地址自动默认 | `addresses` |
| `PATCH` | `/addresses/:id` | 修改本人地址 | `addresses` |
| `PUT` | `/addresses/:id/default` | 事务内取消旧默认并设新默认 | `addresses` |
| `DELETE` | `/addresses/:id` | 删除本人地址；删除默认后按明确规则选择新默认 | `addresses` |

### 3.6 结算与订单

| 方法 | 路径 | 用途 | 表 |
|---|---|---|---|
| `POST` | `/checkout/preview` | 根据 `cart_item_ids` 或立即购买项计算商品金额、库存、运费、可用券和优惠；不落单 | 购物车、商品/SKU、地址、优惠券相关表 |
| `POST` | `/orders` | 创建订单；请求头必须支持 `Idempotency-Key` | 订单、订单项、状态日志、库存流水、用户券、购物车 |
| `GET` | `/orders` | `status`、`page`、`pageSize`；返回订单摘要和首屏商品项 | `orders`、`order_items` |
| `GET` | `/orders/counts` | 返回各状态数量，供个人中心角标使用 | `orders` |
| `GET` | `/orders/:orderNo` | 本人订单详情、地址快照、商品快照、支付/退款信息 | 订单及交易相关表 |
| `POST` | `/orders/:orderNo/cancel` | 仅待付款可取消；恢复占用/扣减库存及优惠券 | `orders`、`order_status_log`、`stock_records`、`user_coupons` |
| `POST` | `/orders/:orderNo/confirm-receipt` | 仅待收货可确认；写 `received_at` 和状态日志 | `orders`、`order_status_log` |

创建订单必须在单个数据库事务中完成：

1. 锁定并校验商品/SKU、状态、价格和库存，所有金额由服务端重算。
2. 锁定并校验地址归属、优惠券归属/有效期/门槛。
3. 生成唯一 `order_no`，写 `orders` 和包含商品/SKU信息的 `order_items` 快照。
4. 扣减库存，写 `stock_records`；若同时维护 `products.stock` 与 `product_skus.stock`，规则必须统一并测试。
5. 使用优惠券时将 `user_coupons` 改为 `used` 并关联订单号。
6. 写首条 `order_status_log`，删除本次结算的购物车项。
7. 任一步失败全部回滚；重复 `Idempotency-Key` 返回第一次创建的同一订单。

建议统一订单状态常量：`pending-payment`、`pending-shipment`、`pending-receipt`、`completed`、`cancelled`、`after-sale`。前端已有前五种（不含 `cancelled`）；所有状态跳转必须走白名单状态机并记录日志。

## 4. P1 接口清单

### 4.1 优惠券

| 方法 | 路径 | 规则 | 表 |
|---|---|---|---|
| `GET` | `/coupons/available` | 可领取券列表 | `coupons`、`user_coupons` |
| `POST` | `/coupons/:id/claim` | 事务、幂等；校验有效期及 `issued < total` | `coupons`、`user_coupons` |
| `GET` | `/me/coupons` | `status=unused|used|expired`，查询时可同步过期状态 | `user_coupons`、`coupons` |

### 4.2 支付与退款

| 方法 | 路径 | 规则 | 表 |
|---|---|---|---|
| `POST` | `/orders/:orderNo/payments` | 为待付款订单创建/返回已有支付单，支持幂等 | `orders`、`payments` |
| `GET` | `/payments/:paymentNo` | 查询本人支付状态 | `payments`、`orders` |
| `POST` | `/payments/callback/:channel` | 第三方回调；验签、去重，事务更新支付/订单/状态日志 | `payments`、`orders`、`order_status_log` |
| `POST` | `/orders/:orderNo/refunds` | 发起退款/售后；校验可退金额及状态 | `refunds`、`payments`、`orders`、`order_status_log` |
| `GET` | `/orders/:orderNo/refunds` | 查询本人退款记录 | `refunds` |
| `POST` | `/refunds/callback/:channel` | 验签、幂等更新退款与订单状态 | `refunds`、`orders`、`order_status_log` |

支付成功状态流转为 `pending-payment -> pending-shipment`。回调以第三方交易号/支付单号做幂等，不能相信客户端“支付成功”按钮。开发环境可另设明确标记的 mock 支付端点，生产环境必须禁用。

### 4.3 扫码录入与文件

| 方法 | 路径 | 规则 | 表 |
|---|---|---|---|
| `GET` | `/scan/barcodes/:barcode` | 先查本地已审记录/正式商品，再读有效缓存，最后调用第三方条码源并回写缓存 | `scan_products`、`scan_api_cache`、`products` |
| `POST` | `/scan/products` | `multipart/form-data` 或先上传图片后传 URL；新记录状态固定 `pending` | `scan_products` |
| `GET` | `/scan/products/mine` | 当前用户提交记录 | `scan_products` |
| `POST` | `/uploads/images` | 校验 MIME、扩展名、大小（前端限制 5MB），返回持久 URL | 数据库存 URL；文件进对象存储/静态存储 |

客户端不得提交 `submitted_by`、`reviewed_by` 或审核状态。`scan_api_cache` 是服务内部缓存表，不开放通用用户 CRUD。

### 4.4 版本

| 方法 | 路径 | 规则 | 表 |
|---|---|---|---|
| `GET` | `/app/versions/latest?platform=android|ios|pc` | 返回指定平台最新版本、下载地址、强更标记、说明 | `app_versions` |

## 5. P2 管理端/内部接口

以下功能可以复用现有 `/resources` 起步，但正式管理端应增加角色鉴权、审计和专用动作接口：

- 商品目录：`categories`、`products`、`tags`、`product_tags`、`product_skus`、`product_specs`。
- 运营：首页 `banners`、`recommend_positions`、`recommend_items`，优惠券 `coupons`。
- 库存：库存调整必须通过 `POST /admin/products/:id/stock-adjustments`，事务更新余额并写 `stock_records`，禁止直接 PATCH 库存字段。
- 订单：`POST /admin/orders/:orderNo/ship` 校验状态并写承运商、运单号、发货时间、状态日志。
- 扫码审核：`POST /admin/scan-products/:id/approve|reject`；通过时可事务创建正式 `products`/SKU并回写审核人。
- 退款处理：专用审核/处理动作，写 `refunds` 状态并调用支付渠道。
- `error_logs`、`operation_logs`：只允许内部写入或管理员查询，绝不向普通用户开放。
- `scan_api_cache`：仅内部维护与清理。

## 6. 28 张表的接口归类

| 分类 | 表 | 处理方式 |
|---|---|---|
| 用户认证 | `users`、`user_auths`、`user_sessions` | 必须做领域接口；禁止普通用户通用 CRUD |
| 商品目录 | `categories`、`products`、`tags`、`product_tags`、`product_skus`、`product_specs` | 用户侧只读组合接口；管理端写接口 |
| 购物行为 | `cart_items`、`favorites`、`addresses` | 当前用户作用域领域接口 |
| 交易 | `orders`、`order_items`、`order_status_log`、`payments`、`refunds`、`stock_records` | 必须事务化领域接口；禁止客户端拼 CRUD |
| 优惠券 | `coupons`、`user_coupons` | 用户查询/领取/使用领域接口；模板管理端维护 |
| 首页运营 | `banners`、`recommend_positions`、`recommend_items` | 用户只读聚合；管理端维护 |
| 扫码 | `scan_products`、`scan_api_cache` | 用户提交/查询；缓存仅内部；审核走管理端动作 |
| 系统 | `app_versions` | 用户只读最新版；管理端维护 |
| 日志 | `error_logs`、`operation_logs` | 内部写、管理端读；不提供用户 CRUD |

结论：28 张表都已被业务链路覆盖，但不是 28 张表都应该直接暴露为 App API。

## 7. 通用接口约定

### 响应与分页

- 成功：单条 `{ "data": ... }`；分页 `{ "data": [], "meta": { "page", "pageSize", "total" } }`。
- 错误沿用 `{ "error": { "code", "message", "details" }, "requestId" }`。
- 列表默认 `pageSize=20`，上限 100；排序字段白名单化。
- 数据库字段当前为 snake_case，首轮接口建议保持 snake_case，前端 API 适配层再转 camelCase，避免同一服务两套命名混用。
- 所有时间返回带时区的 ISO 8601；数据库继续按项目统一时区存储。
- 金额返回字符串，例如 `"6.60"`。

### 安全与校验

- 公开接口只包括登录、公开目录读取、版本检查和验签后的第三方回调。
- 所有资源都校验归属，避免通过递增 ID 越权访问他人购物车、地址、订单和支付单。
- 登录、扫码、下单、支付、领券、退款增加限流；回调接口保留原始请求体用于验签。
- 上传图片校验真实 MIME/文件头、扩展名、大小，生成随机文件名，不接收 base64 长期入库。
- SQL 参数化；搜索关键字长度限制；日志脱敏手机号、Token、支付凭证。

## 8. 当前表结构缺口（不要擅自伪造数据）

### 8.1 会员与积分

`/membership` 和个人中心展示 `LV.7`、`128 / 200` 积分及会员权益，但 28 张表没有会员等级、积分账户、积分流水或权益配置表。服务端 Agent 不应把这些值写死成真实接口。

在产品规则确认后建议另做 migration，至少考虑：

- `member_levels`：等级、门槛、名称、权益 JSON/关联表。
- `user_memberships`：用户当前等级、经验/成长值、有效期。
- `point_records`：积分增减流水、余额、业务类型、业务单号。

### 8.2 消息通知偏好

设置页有“消息通知”开关，但当前没有用户偏好表。首轮可继续作为设备本地设置；若要求跨设备同步，再新增 `user_settings`（或等价表），不要塞入 `users` 的无关字段。

### 8.3 验证码与幂等记录

- 手机验证码当前无表：可用 Redis/第三方验证码服务，若要求数据库留痕需新增验证码记录表。
- `Idempotency-Key` 当前无持久化位置：建议 Redis 或新增幂等请求表，并定义过期时间。仅依赖进程内 Map 不适合多实例部署。

## 9. 服务端 Agent 实施顺序

1. 新增领域目录结构（建议 `src/auth`、`src/catalog`、`src/cart`、`src/orders` 等），不要继续把业务逻辑堆进 `resources/router.ts`。
2. 建立用户会话认证和 `req.user` 类型，隔离管理 Token 与 App Token。
3. 完成商品/首页只读接口及 SQL 组合查询。
4. 完成购物车、收藏、地址，并对所有权与并发场景补测试。
5. 完成结算预览、下单事务、订单状态机、取消和确认收货。
6. 完成优惠券、支付/退款回调和扫码录入。
7. 更新 `openapi.yaml`、`README.md`、`.env.example`；记录外部支付、短信、对象存储的配置项。
8. 为每个业务域补集成测试，最后执行 `pnpm test`、`pnpm build`。

## 10. 验收标准

- P0 接口可支持前端移除 `src/lib/store.ts` 中商品、购物车、收藏、地址和订单 mock。
- 普通用户不能读取或修改其他用户数据，不能自行设置订单价格、支付状态、审核状态或库存。
- 下单、取消、领券、支付回调、退款均有事务/幂等/非法状态测试。
- 商品下架、库存不足、券过期、重复提交、重复回调、并发设默认地址等边界有明确错误码。
- `openapi.yaml` 覆盖新增路径、请求体、响应体、认证方式和主要错误码。
- 通用 `/resources` 仍可用，但只作为受管理 Token 保护的管理/联调能力。
- 不修改已发布 Git 历史，不 force push、不 rebase/amend/squash 已推送提交。

