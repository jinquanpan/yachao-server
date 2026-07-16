# yachao-server

山海灵感便利店后端服务。

Node.js 20+、TypeScript、Express、MySQL 8 实现。数据库基础结构来自 `山海灵感便利店-后端表结构.xlsx`，领域接口依据 `API_IMPLEMENTATION_TASK.md`。

## 能力范围

- App 会话认证，与管理端 `API_TOKEN` 完全隔离
- 首页、分类树、商品搜索/筛选、SKU 与规格详情
- 用户作用域购物车、收藏和地址
- 结算预览、服务端金额重算、幂等下单、库存与优惠券事务
- 订单列表/详情/取消/收货、支付单、验签回调与退款
- 优惠券领取、扫码录入、图片上传和版本检查
- 管理端库存调整、发货、扫码审核
- 28 张基础表的管理端通用资源接口

会员积分和跨设备通知偏好没有对应数据表，因此未伪造接口数据。

## 初始化

```bash
pnpm install
mysql -u root -p < database/schema.sql
mysql -u root -p < database/migrations/001_domain_support.sql
copy .env.example .env
pnpm dev
```

新建数据库只需执行上述 `schema.sql` 和 `001`。已有数据库升级时，额外执行 `mysql -u root -p < database/migrations/002_password_and_wechat_login.sql`、`003_seed_default_user_password.sql` 和 `004_user_roles.sql`；不要把 `002` 再用于刚用新版 `schema.sql` 创建的库。

幂等下单和退款依赖 `idempotency_requests`，部署时不能遗漏 migration。

生产环境必须设置强随机 `TOKEN_PEPPER` 和 `API_TOKEN`。还应限制 `CORS_ORIGIN`，并配置 HTTPS。

## 身份认证

App 用户登录后得到的 `session.token` 用于用户接口：

```http
Authorization: Bearer <App session token>
```

`/api/v1/resources/*` 与 `/api/v1/admin/*` 使用环境变量 `API_TOKEN`，不能使用 App Token。未配置管理 Token 时这些接口返回 `503`，不会匿名开放。

支持账号密码、手机号验证码和微信小程序登录。密码使用带随机盐的 scrypt 哈希存储，绝不保存明文。`POST /auth/register` 在注册时校验手机号验证码，`POST /auth/password/set` 使用手机号验证码设置或重置密码。

当前手机号验证码仅为非生产开发桩，验证码由 `DEV_LOGIN_CODE` 配置。生产环境会明确返回 `SMS_PROVIDER_NOT_CONFIGURED`，接入短信服务商后需替换该开发桩。微信小程序生产登录需配置 `WX_APP_ID` 与 `WX_APP_SECRET`，服务端会用前端 `wx.login()` 获得的 `code` 调用微信 `jscode2session` 校验；开发联调可设置 `OAUTH_DEV_MODE=true`，此时 `code` 仅用作模拟微信用户标识。

### 客户端版本发布

客户端打包脚本可调用 `POST /api/v1/app/versions/publish` 写入当前版本。每次发布会替换同一平台的旧版本记录；客户端使用 `GET /api/v1/app/versions/latest?platform=android` 查询最新版本。该发布接口当前不校验 Token。

### 用户角色

用户角色为 `user`（普通用户）或 `super_admin`（超级用户）。普通用户仅能以 `login_scope=app` 登录；管理端和收银端登录时传 `login_scope=admin` 或 `login_scope=cashier`，仅超级用户允许登录并访问 `/admin/*`、`/resources/*`。内置账号 `13005683936` 在迁移后会设为超级用户。

## 主要接口

完整请求体、认证方式和错误响应见 [openapi.yaml](./openapi.yaml)。

| 领域 | 接口 |
|---|---|
| 认证 | `/auth/register`、`/auth/password/login`、`/auth/password/set`、`/auth/phone/login`、`/auth/wechat/login`、`/auth/refresh`、`/auth/logout` |
| 用户 | `/me`、`/me/coupons` |
| 目录 | `/home`、`/categories`、`/products`、`/products/:id` |
| 购物 | `/cart/*`、`/favorites/*`、`/addresses/*` |
| 交易 | `/checkout/preview`、`/orders/*`、`/payments/*`、`/refunds/*` |
| 其他 | `/coupons/*`、`/scan/*`、`/uploads/images`、`/app/versions/latest` |
| 管理 | `/admin/*`、`/resources/*` |

### 开发登录

```bash
curl -X POST http://localhost:3000/api/v1/auth/phone/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000000","code":"123456","platform":"pc"}'
```

会话 Token 在数据库中只保存加 Pepper 的 SHA-256 摘要，接口返回的原始 Token 只在登录/刷新时出现。

### 创建订单

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer <session-token>" \
  -H "Idempotency-Key: checkout-20260630-001" \
  -H "Content-Type: application/json" \
  -d '{"cart_item_ids":["1","2"],"address_id":"1","user_coupon_id":"3"}'
```

服务端会在一个事务内锁定商品/SKU、地址和优惠券，重算金额，扣减库存，写订单快照与状态流水，使用优惠券并删除对应购物车项。重复的幂等键和相同请求会返回首次创建的订单；同一键用于不同请求返回 `409`。

SKU 存在时以 `product_skus.stock` 为库存权威来源；无 SKU 时使用 `products.stock`。不会同时扣减两处库存。

### 支付与退款回调

回调请求使用原始 JSON 请求体计算 HMAC-SHA256：

```text
x-signature = hex(HMAC_SHA256(raw_request_body, callback_secret))
```

支付与退款分别使用 `PAYMENT_CALLBACK_SECRET`、`REFUND_CALLBACK_SECRET`。未配置密钥或签名不匹配时拒绝回调。客户端没有“直接标记支付成功”的接口。

### 图片上传

`POST /api/v1/uploads/images` 使用字段名 `image` 的 `multipart/form-data`。服务端校验文件头、声明 MIME 和 5MB 上限，随机生成文件名并返回持久 URL。默认存储在 `UPLOAD_DIR`；多实例生产部署应将这一适配层替换成对象存储。

## 数据和响应约定

- 字段保持 `snake_case`。
- 金额返回两位小数字符串，例如 `"6.60"`。
- MySQL `BIGINT` 返回字符串，避免 JavaScript 精度损失。
- 单条响应为 `{ "data": ... }`，分页响应包含 `meta`。
- 错误为 `{ "error": { "code", "message", "details" }, "requestId" }`。
- 所有当前用户资源都从会话取得 `user_id`，忽略且不接受客户端伪造的用户 ID。

## 验证

```bash
pnpm run typecheck
pnpm test
pnpm run build
```

数据库集成测试需要单独的 MySQL 测试实例；不要对生产库执行测试数据初始化。
