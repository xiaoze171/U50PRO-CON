CREATE DATABASE IF NOT EXISTS `u50pro_console`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `u50pro_console`;

CREATE TABLE IF NOT EXISTS `router_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_key` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(128) NOT NULL DEFAULT 'U50 Pro',
  `router_url` VARCHAR(512) NOT NULL DEFAULT 'http://192.168.0.1',
  `router_password` TEXT NULL,
  `last_seen_at` DATETIME(3) NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_router_profiles_profile_key` (`profile_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `router_battery_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `sample_time` DATETIME(3) NOT NULL,
  `battery_percent` DECIMAL(6,2) NOT NULL,
  `is_charging` TINYINT(1) NOT NULL DEFAULT 0,
  `temperature_c` DECIMAL(7,2) NULL,
  `rate_per_hour` DECIMAL(10,4) NULL,
  `estimated_remaining_minutes` INT NULL,
  `charge_type` VARCHAR(64) NULL,
  `external_power` TINYINT(1) NOT NULL DEFAULT 0,
  `battery_voltage` VARCHAR(64) NULL,
  `battery_current` VARCHAR(64) NULL,
  `battery_capacity` VARCHAR(64) NULL,
  `battery_health` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_battery_profile_time` (`profile_id`, `sample_time`),
  CONSTRAINT `fk_battery_profile` FOREIGN KEY (`profile_id`) REFERENCES `router_profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `router_profiles` (`profile_key`, `display_name`, `router_url`)
VALUES ('default', 'U50 Pro', 'http://192.168.0.1')
ON DUPLICATE KEY UPDATE `profile_key` = VALUES(`profile_key`);
