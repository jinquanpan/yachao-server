USE `yacao_store`;

CREATE TABLE `scan_api_cache_next` (
  `barcode` VARCHAR(64) NOT NULL COMMENT '条形码',
  `response_body` LONGTEXT NOT NULL COMMENT '第三方接口原始响应字符串',
  PRIMARY KEY (`barcode`)
) ENGINE=InnoDB COMMENT='第三方接口缓存';

INSERT INTO `scan_api_cache_next` (`barcode`, `response_body`)
SELECT `cache_key`, CAST(`response_data` AS CHAR)
FROM `scan_api_cache`
ORDER BY `updated_at` ASC
ON DUPLICATE KEY UPDATE `response_body` = VALUES(`response_body`);

DROP TABLE `scan_api_cache`;
RENAME TABLE `scan_api_cache_next` TO `scan_api_cache`;
