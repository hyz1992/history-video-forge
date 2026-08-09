# 开发启动自动迁移 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `dev_start.py` 默认应用仓库已有 migration 后再启动服务，避免新版代码读取旧数据库结构失败。

**Architecture:** 启动脚本保留现有 `prepare_database` 边界，只调整默认 CLI 语义和 Prisma migration 命令。数据库准备失败时沿用 fail-fast，不修改后端生产启动逻辑。

**Tech Stack:** Python 3 标准库、Prisma CLI、`unittest`。

---

## Chunk 1: 启动参数与数据库准备

### Task 1: 默认执行非交互式 migration

**Files:**
- Modify: `dev_start.py`
- Create: `tests/dev_start_test.py`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：`parse_args([]).prepare_db` 为真；`--skip-db-prepare` 为假；旧 `--prepare-db` 仍为真；准备命令包含 `prisma migrate deploy` 且不包含 `migrate dev`。

- [ ] **Step 2: 运行红灯**

Run: `python -m unittest tests/dev_start_test.py -v`

Expected: FAIL，因为当前默认不准备数据库，且命令仍是 `migrate dev`。

- [ ] **Step 3: 写最小实现**

调整 argparse 默认值和参数，修改 `build_prepare_commands`，同步脚本说明与日志。

- [ ] **Step 4: 运行绿灯和静态检查**

Run: `python -m unittest tests/dev_start_test.py -v`

Run: `python -m py_compile dev_start.py tests/dev_start_test.py`

Expected: PASS。

- [ ] **Step 5: 真实启动验证**

运行默认数据库准备，启动服务并检查 `/api/healthcheck`，随后停止本次验证进程。

- [ ] **Step 6: 提交**

Commit: `fix(dev): 启动前默认应用数据库迁移`
