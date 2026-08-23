-- 2026-08-23（报价体系移除）：UsageCostRecord 增加单位规格明细列
-- （图片分辨率、视频画质等，供项目费用清单展示规格/数量/价格）。
ALTER TABLE "UsageCostRecord" ADD COLUMN "unitDetailJson" TEXT;
