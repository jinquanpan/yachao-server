USE `yacao_store`;

INSERT INTO `categories` (`key`, `label`, `parent_id`, `icon`, `sort`)
VALUES
  ('tobacco', '香烟和零售', NULL, 'tobacco', 1),
  ('daily', '日常用品', NULL, 'daily', 2),
  ('water', '水', NULL, 'water', 3),
  ('icecream', '雪糕', NULL, 'icecream', 4)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `icon` = VALUES(`icon`),
  `sort` = VALUES(`sort`);
