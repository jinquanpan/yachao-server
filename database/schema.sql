CREATE DATABASE IF NOT EXISTS `shanhai_store`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE `shanhai_store`;

CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `phone` VARCHAR(20) NOT NULL COMMENT '手机号',
  `nickname` VARCHAR(64) NULL COMMENT '昵称',
  `avatar_url` VARCHAR(255) NULL COMMENT '头像URL',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态:0禁用1正常',
  `last_login_at` DATETIME NULL COMMENT '最后登录时间',
  `last_login_ip` VARCHAR(45) NULL COMMENT '最后登录IP',
  `device_id` VARCHAR(128) NULL COMMENT '设备ID',
  `platform` VARCHAR(16) NULL COMMENT '平台:android/ios/pc',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_phone` (`phone`),
  KEY `idx_users_status` (`status`)
) ENGINE=InnoDB COMMENT='用户主表';

CREATE TABLE `coupons` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `name` VARCHAR(64) NOT NULL COMMENT '名称',
  `type` VARCHAR(16) NOT NULL COMMENT '类型:fullcut/discount',
  `amount` DECIMAL(10,2) NULL COMMENT '优惠金额',
  `min_spend` DECIMAL(10,2) NULL COMMENT '满减门槛',
  `discount` DECIMAL(3,2) NULL COMMENT '折扣率',
  `valid_from` DATETIME NOT NULL COMMENT '生效时间',
  `valid_to` DATETIME NOT NULL COMMENT '失效时间',
  `total` INT NOT NULL DEFAULT 0 COMMENT '发放总量',
  `issued` INT NOT NULL DEFAULT 0 COMMENT '已领取数',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_coupons_validity` (`valid_from`, `valid_to`),
  KEY `idx_coupons_type` (`type`)
) ENGINE=InnoDB COMMENT='优惠券模板';

CREATE TABLE `categories` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `key` VARCHAR(16) NOT NULL COMMENT '分类键:drink/snack等',
  `label` VARCHAR(32) NOT NULL COMMENT '分类名称',
  `parent_id` INT NULL COMMENT '父分类ID',
  `icon` VARCHAR(64) NULL COMMENT '图标',
  `sort` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_categories_key` (`key`),
  KEY `idx_categories_parent_sort` (`parent_id`, `sort`),
  CONSTRAINT `fk_categories_parent` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='分类目录';

CREATE TABLE `tags` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `name` VARCHAR(32) NOT NULL COMMENT '标签名',
  `color` VARCHAR(16) NULL COMMENT '颜色',
  `sort` INT NOT NULL DEFAULT 0 COMMENT '排序',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tags_name` (`name`),
  KEY `idx_tags_sort` (`sort`)
) ENGINE=InnoDB COMMENT='标签库';

CREATE TABLE `products` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `product_no` VARCHAR(32) NOT NULL COMMENT '商品编码',
  `name` VARCHAR(128) NOT NULL COMMENT '商品名',
  `subtitle` VARCHAR(255) NULL COMMENT '副标题',
  `price` DECIMAL(10,2) NOT NULL COMMENT '售价',
  `category_id` INT NOT NULL COMMENT '分类ID',
  `story` TEXT NULL COMMENT '山海故事',
  `spec` VARCHAR(64) NULL COMMENT '规格',
  `stock` INT NOT NULL DEFAULT 0 COMMENT '库存',
  `sales_count` INT NOT NULL DEFAULT 0 COMMENT '销量',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态:0下架1上架',
  `cover_image` VARCHAR(255) NULL COMMENT '主图路径',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` DATETIME NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_products_product_no` (`product_no`),
  KEY `idx_products_category_status` (`category_id`, `status`),
  KEY `idx_products_created_at` (`created_at`),
  KEY `idx_products_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='商品主表';

CREATE TABLE `user_auths` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `identity_type` VARCHAR(16) NOT NULL COMMENT '类型:wechat/apple',
  `identifier` VARCHAR(128) NOT NULL COMMENT '标识openid/unionid',
  `credential` VARCHAR(255) NULL COMMENT '凭证(加密)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_auth_identity` (`identity_type`, `identifier`),
  KEY `idx_user_auths_user` (`user_id`),
  CONSTRAINT `fk_user_auths_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='第三方登录';

CREATE TABLE `user_sessions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `token` VARCHAR(128) NOT NULL COMMENT '会话Token',
  `device` VARCHAR(64) NULL COMMENT '设备信息',
  `platform` VARCHAR(16) NULL COMMENT '平台',
  `ip` VARCHAR(45) NULL COMMENT '登录IP',
  `expire_at` DATETIME NOT NULL COMMENT '过期时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_sessions_token` (`token`),
  KEY `idx_user_sessions_user_expire` (`user_id`, `expire_at`),
  CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='会话Token';

CREATE TABLE `product_tags` (
  `product_id` BIGINT NOT NULL COMMENT '商品ID',
  `tag_id` INT NOT NULL COMMENT '标签ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`product_id`, `tag_id`),
  KEY `idx_product_tags_tag` (`tag_id`),
  CONSTRAINT `fk_product_tags_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_product_tags_tag` FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='商品-标签关联';

CREATE TABLE `product_skus` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `product_id` BIGINT NOT NULL COMMENT '商品ID',
  `sku_code` VARCHAR(64) NOT NULL COMMENT 'SKU编码',
  `price` DECIMAL(10,2) NOT NULL COMMENT '价格',
  `stock` INT NOT NULL DEFAULT 0 COMMENT '库存',
  `attributes` JSON NULL COMMENT '规格属性',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_skus_code` (`sku_code`),
  KEY `idx_product_skus_product` (`product_id`),
  CONSTRAINT `fk_product_skus_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='商品SKU';

CREATE TABLE `product_specs` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `product_id` BIGINT NOT NULL COMMENT '商品ID',
  `name` VARCHAR(32) NOT NULL COMMENT '规格名',
  `values` JSON NOT NULL COMMENT '规格值数组',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_specs_name` (`product_id`, `name`),
  CONSTRAINT `fk_product_specs_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='规格定义';

CREATE TABLE `scan_products` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `barcode` VARCHAR(64) NOT NULL COMMENT '条码',
  `name` VARCHAR(128) NOT NULL COMMENT '商品名',
  `price` DECIMAL(10,2) NOT NULL COMMENT '价格',
  `category_id` INT NULL COMMENT '分类ID',
  `cover_image` VARCHAR(255) NULL COMMENT '图片路径',
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '状态:pending/approved/rejected',
  `submitted_by` BIGINT NOT NULL COMMENT '提交人ID',
  `reviewed_by` BIGINT NULL COMMENT '审核人ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_scan_products_barcode` (`barcode`),
  KEY `idx_scan_products_status_created` (`status`, `created_at`),
  KEY `idx_scan_products_submitted_by` (`submitted_by`),
  KEY `idx_scan_products_reviewed_by` (`reviewed_by`),
  CONSTRAINT `fk_scan_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_scan_products_submitter` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_scan_products_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='扫描录入商品';

CREATE TABLE `scan_api_cache` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `source` VARCHAR(32) NOT NULL COMMENT '接口来源',
  `cache_key` VARCHAR(128) NOT NULL COMMENT '缓存键',
  `response_data` JSON NOT NULL COMMENT '接口返回数据',
  `expire_at` DATETIME NOT NULL COMMENT '过期时间',
  `hit_count` INT NOT NULL DEFAULT 0 COMMENT '命中次数',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次请求时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scan_api_cache_source_key` (`source`, `cache_key`),
  KEY `idx_scan_api_cache_expire` (`expire_at`)
) ENGINE=InnoDB COMMENT='第三方接口缓存';

CREATE TABLE `stock_records` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `product_id` BIGINT NOT NULL COMMENT '商品ID',
  `change_type` VARCHAR(16) NOT NULL COMMENT '类型:in/out',
  `change_qty` INT NOT NULL COMMENT '变动数量',
  `balance` INT NOT NULL COMMENT '变动后库存',
  `biz_type` VARCHAR(32) NULL COMMENT '业务类型',
  `biz_id` VARCHAR(64) NULL COMMENT '业务单号',
  `operator_id` BIGINT NULL COMMENT '操作人ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_stock_records_product_created` (`product_id`, `created_at`),
  KEY `idx_stock_records_biz` (`biz_type`, `biz_id`),
  KEY `idx_stock_records_operator` (`operator_id`),
  CONSTRAINT `fk_stock_records_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_stock_records_operator` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='库存流水';

CREATE TABLE `cart_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `product_id` BIGINT NOT NULL COMMENT '商品ID',
  `sku_id` BIGINT NULL COMMENT 'SKU ID',
  `qty` INT NOT NULL COMMENT '数量',
  `selected` TINYINT NOT NULL DEFAULT 1 COMMENT '是否选中',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cart_items_user_product_sku` (`user_id`, `product_id`, `sku_id`),
  KEY `idx_cart_items_product` (`product_id`),
  KEY `idx_cart_items_sku` (`sku_id`),
  CONSTRAINT `fk_cart_items_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cart_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cart_items_sku` FOREIGN KEY (`sku_id`) REFERENCES `product_skus` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='购物车';

CREATE TABLE `favorites` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `product_id` BIGINT NOT NULL COMMENT '商品ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_favorites_user_product` (`user_id`, `product_id`),
  KEY `idx_favorites_product` (`product_id`),
  CONSTRAINT `fk_favorites_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_favorites_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='收藏';

CREATE TABLE `addresses` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `consignee` VARCHAR(32) NOT NULL COMMENT '收货人',
  `phone` VARCHAR(20) NOT NULL COMMENT '联系电话',
  `province` VARCHAR(32) NOT NULL COMMENT '省',
  `city` VARCHAR(32) NOT NULL COMMENT '市',
  `district` VARCHAR(32) NOT NULL COMMENT '区',
  `detail` VARCHAR(255) NOT NULL COMMENT '详细地址',
  `is_default` TINYINT NOT NULL DEFAULT 0 COMMENT '是否默认',
  `tag` VARCHAR(16) NULL COMMENT '标签:家/公司',
  PRIMARY KEY (`id`),
  KEY `idx_addresses_user_default` (`user_id`, `is_default`),
  CONSTRAINT `fk_addresses_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='收货地址';

CREATE TABLE `orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `order_no` VARCHAR(32) NOT NULL COMMENT '订单号SH+时间戳',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `status` VARCHAR(24) NOT NULL COMMENT '订单状态',
  `total` DECIMAL(10,2) NOT NULL COMMENT '商品总额',
  `discount` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '优惠金额',
  `pay_amount` DECIMAL(10,2) NOT NULL COMMENT '实付金额',
  `address_snapshot` JSON NOT NULL COMMENT '地址快照',
  `coupon_id` BIGINT NULL COMMENT '使用的优惠券ID',
  `payment_id` BIGINT NULL COMMENT '支付单ID',
  `carrier` VARCHAR(32) NULL COMMENT '物流商',
  `tracking_no` VARCHAR(64) NULL COMMENT '运单号',
  `remark` VARCHAR(255) NULL COMMENT '订单备注',
  `paid_at` DATETIME NULL COMMENT '支付时间',
  `shipped_at` DATETIME NULL COMMENT '发货时间',
  `received_at` DATETIME NULL COMMENT '收货时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_orders_order_no` (`order_no`),
  KEY `idx_orders_user_status_created` (`user_id`, `status`, `created_at`),
  KEY `idx_orders_coupon` (`coupon_id`),
  KEY `idx_orders_payment` (`payment_id`),
  CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_orders_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='订单主表';

CREATE TABLE `user_coupons` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `coupon_id` BIGINT NOT NULL COMMENT '优惠券ID',
  `status` VARCHAR(16) NOT NULL DEFAULT 'unused' COMMENT '状态:unused/used/expired',
  `used_order_id` VARCHAR(32) NULL COMMENT '使用的订单号',
  `expire_at` DATETIME NOT NULL COMMENT '过期时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '领取时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_coupons_user_coupon` (`user_id`, `coupon_id`),
  KEY `idx_user_coupons_status_expire` (`user_id`, `status`, `expire_at`),
  KEY `idx_user_coupons_coupon` (`coupon_id`),
  KEY `idx_user_coupons_order` (`used_order_id`),
  CONSTRAINT `fk_user_coupons_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_coupons_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_coupons_order` FOREIGN KEY (`used_order_id`) REFERENCES `orders` (`order_no`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='用户优惠券';

CREATE TABLE `order_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `order_id` BIGINT NOT NULL COMMENT '订单ID',
  `product_id` BIGINT NOT NULL COMMENT '商品ID',
  `sku_id` BIGINT NULL COMMENT 'SKU ID',
  `product_snapshot` JSON NOT NULL COMMENT '商品快照',
  `sku_snapshot` JSON NULL COMMENT 'SKU快照',
  `price` DECIMAL(10,2) NOT NULL COMMENT '单价',
  `qty` INT NOT NULL COMMENT '数量',
  PRIMARY KEY (`id`),
  KEY `idx_order_items_order` (`order_id`),
  KEY `idx_order_items_product` (`product_id`),
  KEY `idx_order_items_sku` (`sku_id`),
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_order_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_order_items_sku` FOREIGN KEY (`sku_id`) REFERENCES `product_skus` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='订单项';

CREATE TABLE `order_status_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `order_id` BIGINT NOT NULL COMMENT '订单ID',
  `from_status` VARCHAR(24) NULL COMMENT '原状态',
  `to_status` VARCHAR(24) NOT NULL COMMENT '新状态',
  `operator_id` BIGINT NULL COMMENT '操作人ID',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_order_status_log_order_created` (`order_id`, `created_at`),
  KEY `idx_order_status_log_operator` (`operator_id`),
  CONSTRAINT `fk_order_status_log_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_order_status_log_operator` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='状态流水';

CREATE TABLE `payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `order_id` BIGINT NOT NULL COMMENT '订单ID',
  `payment_no` VARCHAR(32) NOT NULL COMMENT '支付单号',
  `channel` VARCHAR(16) NOT NULL COMMENT '渠道:wechat/alipay/apple',
  `amount` DECIMAL(10,2) NOT NULL COMMENT '支付金额',
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '状态:pending/paid/failed',
  `trade_no` VARCHAR(64) NULL COMMENT '第三方交易号',
  `paid_at` DATETIME NULL COMMENT '支付时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payments_payment_no` (`payment_no`),
  UNIQUE KEY `uk_payments_order` (`order_id`),
  KEY `idx_payments_trade_no` (`trade_no`),
  KEY `idx_payments_status_created` (`status`, `created_at`),
  CONSTRAINT `fk_payments_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='支付单';

ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE SET NULL;

CREATE TABLE `refunds` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `payment_id` BIGINT NOT NULL COMMENT '支付单ID',
  `order_id` BIGINT NOT NULL COMMENT '订单ID',
  `refund_no` VARCHAR(32) NOT NULL COMMENT '退款单号',
  `amount` DECIMAL(10,2) NOT NULL COMMENT '退款金额',
  `reason` VARCHAR(255) NULL COMMENT '退款原因',
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '状态:pending/processed/failed',
  `processed_at` DATETIME NULL COMMENT '处理时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_refunds_refund_no` (`refund_no`),
  KEY `idx_refunds_payment` (`payment_id`),
  KEY `idx_refunds_order` (`order_id`),
  KEY `idx_refunds_status_created` (`status`, `created_at`),
  CONSTRAINT `fk_refunds_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_refunds_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='退款';

CREATE TABLE `banners` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `title` VARCHAR(64) NULL COMMENT '标题',
  `image_url` VARCHAR(255) NOT NULL COMMENT '图片地址',
  `link_url` VARCHAR(255) NULL COMMENT '跳转链接',
  `position` VARCHAR(32) NOT NULL COMMENT '位置:home等',
  `sort` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `valid_from` DATETIME NOT NULL COMMENT '生效时间',
  `valid_to` DATETIME NOT NULL COMMENT '失效时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_banners_position_validity` (`position`, `valid_from`, `valid_to`),
  KEY `idx_banners_sort` (`sort`)
) ENGINE=InnoDB COMMENT='Banner';

CREATE TABLE `recommend_positions` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `code` VARCHAR(32) NOT NULL COMMENT '推荐位编码',
  `description` VARCHAR(128) NULL COMMENT '描述',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态:0禁用1启用',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_recommend_positions_code` (`code`),
  KEY `idx_recommend_positions_status` (`status`)
) ENGINE=InnoDB COMMENT='推荐位';

CREATE TABLE `recommend_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `position_id` INT NOT NULL COMMENT '推荐位ID',
  `product_id` BIGINT NOT NULL COMMENT '商品ID',
  `sort` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `valid_from` DATETIME NOT NULL COMMENT '生效时间',
  `valid_to` DATETIME NOT NULL COMMENT '失效时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_recommend_items_position_product` (`position_id`, `product_id`),
  KEY `idx_recommend_items_position_validity` (`position_id`, `valid_from`, `valid_to`, `sort`),
  KEY `idx_recommend_items_product` (`product_id`),
  CONSTRAINT `fk_recommend_items_position` FOREIGN KEY (`position_id`) REFERENCES `recommend_positions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recommend_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='推荐项';

CREATE TABLE `error_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT NULL COMMENT '用户ID',
  `boundary` VARCHAR(64) NULL COMMENT '错误边界',
  `route` VARCHAR(255) NULL COMMENT '路由',
  `mechanism` VARCHAR(32) NULL COMMENT '机制:onerror/boundary等',
  `severity` VARCHAR(16) NOT NULL COMMENT '级别:error/warning/info',
  `message` TEXT NOT NULL COMMENT '错误信息',
  `stack` TEXT NULL COMMENT '堆栈',
  `context` JSON NULL COMMENT '上下文',
  `user_agent` VARCHAR(255) NULL COMMENT 'UA',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_error_logs_severity_created` (`severity`, `created_at`),
  KEY `idx_error_logs_user` (`user_id`),
  CONSTRAINT `fk_error_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='错误日志(对接Lovable)';

CREATE TABLE `operation_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT NULL COMMENT '操作人ID',
  `action` VARCHAR(64) NOT NULL COMMENT '操作动作',
  `target` VARCHAR(128) NULL COMMENT '操作对象',
  `ip` VARCHAR(45) NULL COMMENT 'IP',
  `user_agent` VARCHAR(255) NULL COMMENT 'UA',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_operation_logs_user_created` (`user_id`, `created_at`),
  KEY `idx_operation_logs_action_created` (`action`, `created_at`),
  CONSTRAINT `fk_operation_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='操作日志';

CREATE TABLE `app_versions` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `platform` VARCHAR(16) NOT NULL COMMENT '平台:android/ios',
  `version` VARCHAR(16) NOT NULL COMMENT '版本号',
  `force_update` TINYINT NOT NULL DEFAULT 0 COMMENT '是否强制更新',
  `download_url` VARCHAR(255) NOT NULL COMMENT '下载地址',
  `release_notes` TEXT NULL COMMENT '更新说明',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_app_versions_platform_version` (`platform`, `version`),
  KEY `idx_app_versions_platform_created` (`platform`, `created_at`)
) ENGINE=InnoDB COMMENT='版本管理';
