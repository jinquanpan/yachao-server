USE `yacao_store`;

CREATE TABLE `gds_auth` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `account` VARCHAR(128) NOT NULL COMMENT 'GDS账号',
  `access_token` VARCHAR(2048) NOT NULL COMMENT 'GDS访问令牌',
  `current_role` VARCHAR(64) NOT NULL DEFAULT 'Mine' COMMENT 'GDS当前角色',
  `expires_at` DATETIME NULL COMMENT '令牌过期时间',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态:0失效1有效',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gds_auth_account` (`account`),
  KEY `idx_gds_auth_valid` (`account`, `status`, `expires_at`)
) ENGINE=InnoDB COMMENT='GDS第三方商品查询认证信息';
