USE `yacao_store`;

-- 默认账号 13005683936 的初始密码为 123456；仅在尚未设置密码时补充，不会覆盖已修改的密码。
UPDATE `users`
SET `password_hash` = 'scrypt$hSERPHSluOYIWXr-KoTC5w$I5blRK15kWwIqZXcE90j_qJoE-zTpIcFzVVaSYo4_rs7Q8AF9VdFEwQE3BWV6iWA5HNbbBFLGpM_9DZvOatqGg'
WHERE `phone` = '13005683936' AND `password_hash` IS NULL;
