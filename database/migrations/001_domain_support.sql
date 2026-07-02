USE `shanhai_store`;

CREATE TABLE `idempotency_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `scope` VARCHAR(32) NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `resource_id` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expire_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_idempotency_user_scope_key` (`user_id`, `scope`, `idempotency_key`),
  KEY `idx_idempotency_expire` (`expire_at`),
  CONSTRAINT `fk_idempotency_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='领域接口幂等记录';
