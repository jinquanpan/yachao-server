USE `yacao_store`;

-- 用户名允许为空，以兼容历史手机号/第三方登录用户；非空用户名必须唯一。
ALTER TABLE `users`
  ADD COLUMN `username` VARCHAR(64) NULL COMMENT '登录账号' AFTER `phone`,
  ADD COLUMN `password_hash` VARCHAR(255) NULL COMMENT '密码哈希（scrypt）' AFTER `username`,
  ADD UNIQUE KEY `uk_users_username` (`username`);

-- 将已有用户的手机号作为初始账号；密码仍需由用户注册或重置时设置。
UPDATE `users` SET `username` = `phone` WHERE `username` IS NULL;
