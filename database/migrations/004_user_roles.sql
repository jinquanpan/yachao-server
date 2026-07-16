USE `yacao_store`;

ALTER TABLE `users`
  ADD COLUMN `role` VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT '用户角色:user/super_admin' AFTER `password_hash`,
  ADD KEY `idx_users_role` (`role`);

-- 首个内置账号作为超级用户，用于首次登录管理端或收银端。
UPDATE `users` SET `role` = 'super_admin' WHERE `phone` = '13005683936';
