-- S2-2A 外部审查 B3 整改：snapshot 持久化 unbounded 标记。
-- unbounded 报价的授权金额在持久化边界归一为 "0"（DB 金额列 NOT NULL 合同），
-- 但归一金额绝不参与 overrun 上界比较；标记随 snapshot 冻结（授权不可变历史）。
-- 历史 snapshot 默认 false：其 usage 在修复前已写毕（run 终态后不再产生新
-- usage），overrun 语义只对修复后的新 snapshot 生效。
ALTER TABLE "RunConfigurationSnapshot" ADD COLUMN "containsUnboundedItem" BOOLEAN NOT NULL DEFAULT false;
