# Windows Server（腾讯云）部署指南

2026-10-10 按当前启动脚本、Prisma CLI 和认证代码核对；本次未执行服务器部署。开发入口见 [README](./README.md)。

## 一、前置环境安装

### 1.1 安装 Node.js

安装与锁定依赖兼容的 Node.js：20.19+（20.x）、22.12+（22.x）或 24+；[官方下载](https://nodejs.org)。

```powershell
node -v   # 核对上述版本范围
npm -v
```

### 1.2 安装 Git

下载安装：https://git-scm.com/download/win

```powershell
git --version
```

### 1.3 浏览器（Remotion 视频渲染所需）

项目中用到 Remotion 渲染视频，需要 Chromium 内核的浏览器。Windows Server 自带 Edge，可以直接用：

```powershell
# 先确认 Edge 的实际路径
Get-ChildItem "C:\Program Files (x86)\Microsoft\Edge\Application" -Filter msedge.exe -Recurse | Select-Object -First 1 FullName
```

然后将路径填入 `.env`：

```env
REMOTION_BROWSER_EXECUTABLE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
```

如果不需要视频渲染功能，可跳过：

```env
RENDER_ADAPTER=fake
```

---

## 二、开放安全组端口

进入腾讯云控制台 → 云服务器 → 安全组，添加入站规则：

| 协议 | 端口 | 来源       | 说明                             |
|------|------|------------|----------------------------------|
| TCP  | 3000 | 仅本机或受限来源 | 应用端口；无鉴权时不得直接暴露公网 |
| TCP  | 3389 | 你的IP     | 远程桌面（通常已配好）            |

---

## 三、部署步骤

### 3.1 拉取代码

```powershell
cd C:\work\ai
git clone <仓库地址> history-video-forge
cd history-video-forge
```

### 3.2 安装依赖

```powershell
npm ci
```

如果下载慢，可以先设淘宝镜像：

```powershell
npm config set registry https://registry.npmmirror.com
npm ci
```

### 3.3 配置 `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

必须填写的内容：

```env
# 核心/轻量路由，与 backend/providers.json 的 apiKeyEnv 对应
LLM_SMART_MODEL=deepseek:deepseek-v4-flash
LLM_FLASH_MODEL=deepseek:deepseek-v4-flash
LLM_PROVIDER_DEEPSEEK_API_KEY=替换为你的密钥
LLM_TIMEOUT_MS=240000

# 媒体：新项目口播使用资格策略中的 Qwen Audio 3.0 / 龙翼暮凌组合
ALIYUN_DASHSCOPE_API_KEY=替换为你的DashScope密钥
ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL=wan2.7-image
# 下项是 assets legacy TTS，不切换新项目口播资格
ALIYUN_DASHSCOPE_TTS_MODEL=qwen3-tts-instruct-flash

REMOTION_BROWSER_EXECUTABLE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

# 用绝对路径，CLI/backend 工作目录变化仍指向同一 SQLite
DATABASE_URL=file:C:/work/ai/history-video-forge/storage/history-video-forge.db
LOCAL_PROJECT_OWNER_ID=local-migration-owner
SERVER_PORT=3000
SERVER_HOST=127.0.0.1
ALLOW_UNAUTHENTICATED_REMOTE=false
PUBLIC_BASE_URL=https://你的部署域名
```

### 3.4 数据库准备

先在根目录设置与 .env 相同的 DATABASE_URL（database-operations CLI 不自动加载 .env）。首次空库：

```powershell
$env:DATABASE_URL = 'file:C:/work/ai/history-video-forge/storage/history-video-forge.db'
npx tsx backend/src/cli/database-operations.ts init --confirm
npx tsx backend/src/cli/database-operations.ts owner-init --id local-migration-owner --username migration-owner --confirm
npx tsx backend/src/cli/database-operations.ts activate --mode fresh --confirm
npx tsx backend/src/cli/database-operations.ts admin-bootstrap --username admin --password '<替换为符合密码策略的密码>' --confirm
npx tsx backend/src/cli/database-operations.ts status
```

migration owner 是 ACTIVE 的导入/启动身份，禁止登录；admin-bootstrap 创建真实可登录管理员，普通用户可由管理后台创建。LOCAL_PROJECT_OWNER_ID 必须对应库内 ACTIVE 用户。

已有数据库先备份，再应用待执行迁移：

```powershell
npm exec --workspace backend -- prisma migrate deploy --config prisma.config.ts
npx tsx backend/src/cli/database-operations.ts status
```

若状态报告 database_activation_stale，核对既有 DatabaseActivation 的 mode/sourceSha256 后按原模式刷新激活；legacy_import 必须保留已验证 source SHA，不能一律改成 fresh。旧 JSON 导入流程见 [数据映射](docs/data/v2-domain-model-mapping.md) 和 CLI 的 import/verify/activate 合同。

npm start 不自动 migrate/owner-init/activate；python dev_start.py 的数据库准备也只运行 generate + migrate deploy。

### 3.5 构建

```powershell
npm run build
```

构建成功后会生成：
- `frontend/dist/` — 前端静态资源
- `backend/dist/` — 后端编译产物

### 3.6 快速验证

先手动启动一次，确认能跑起来：

```powershell
npm run start
```

看到以下输出表示成功，然后按 `Ctrl + C` 停掉：

```
{"status":"backend-server-ready","host":"127.0.0.1","port":3000}
```

本机先检查 `/healthz`（存活）和 `/readyz`（数据库/迁移/激活/媒体目录就绪，期望 200/ready）。生产登录 Cookie 带 Secure，登录验收应通过 HTTPS 反向代理域名；只打开本机 HTTP 页面不代表登录通过。远程访问由 HTTPS 代理提供，Node 保持回环监听。

---

## 四、注册为 Windows 服务（使用 NSSM）

> **为什么要用 NSSM？**
>
> 普通终端进程没有服务级自启和恢复保证；断开远程桌面不等于注销会话，注销/重启可能终止进程。
> NSSM 可以把 Node.js 程序注册为「Windows 系统服务」，效果等同于：
> - 开机自启（不需要登录）
> - 崩溃自动重启
> - 后台静默运行，关掉远程桌面也还活着
> - 能在 `services.msc` 里看到，像一个"真正的"后台服务

### 快捷方式：一键脚本

项目提供了根目录下的 `service-manager.ps1`（PowerShell 脚本），把安装、启停、更新、备份等操作封装成了菜单，**右键以管理员身份运行**即可：

```
# 如果首次运行 PowerShell 脚本被阻止，先执行：
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# 然后运行：
.\service-manager.ps1
```

菜单界面：

```
[1] 安装服务（首次部署）
 [2] 启动服务
 [3] 停止服务
 [4] 重启服务
 [5] 查看状态
 [6] 查看日志
 [7] 编辑配置
 [8] 更新部署（git pull + 构建 + 重启）
 [9] 备份数据
 [10] 卸载服务（删除 Windows 服务登记）
 [0] 退出
```

### 手动操作步骤（备选）

如果不想用脚本，以下是手动逐条执行的步骤。

### 4.1 安装 NSSM

到 https://nssm.cc/download 下载 `nssm-2.24.zip`（或更高版本），解压后把 `nssm.exe` 放到一个固定路径，例如：

```powershell
# 假设放在 C:\nssm\ 下
mkdir C:\nssm
# 把 nssm.exe 复制进去
```

### 4.2 注册服务

**以管理员身份打开 PowerShell**，执行：

```powershell
C:\nssm\nssm.exe install history-video-forge
```

会弹出一个配置窗口，填写以下内容：

| 字段               | 值 |
|--------------------|-----|
| **Path**           | `C:\Program Files\nodejs\node.exe` |
| **Startup directory** | `C:\work\ai\history-video-forge` |
| **Arguments**      | `scripts/start-prod.mjs` |

> Path 填 node.exe，Arguments 填启动脚本；用 `Get-Command node` 核对安装位置。

填好后点击 **Install service**。

### 4.3 设置开机自启 + 崩溃重启

仍在同一个 PowerShell 窗口（管理员）：

```powershell
# 设为开机自动启动
C:\nssm\nssm.exe set history-video-forge Start SERVICE_AUTO_START

# 崩溃后自动重启（延迟 10 秒）
C:\nssm\nssm.exe set history-video-forge AppExit Default Restart
C:\nssm\nssm.exe set history-video-forge AppRestartDelay 10000
```

### 4.4 启动服务

```powershell
C:\nssm\nssm.exe start history-video-forge
```

### 4.5 验证

```powershell
# 查看服务运行状态（应显示 STATE: RUNNING）
sc.exe query history-video-forge

# 浏览器验证
# http://127.0.0.1:3000/healthz → 存活；/readyz → 200/ready
# 登录/生成验收通过 HTTPS 代理域名执行
```

### 4.6 NSSM 常用命令速查

| 操作 | 命令 |
|------|------|
| 启动服务 | `nssm start history-video-forge` |
| 停止服务 | `nssm stop history-video-forge` |
| 重启服务 | `nssm restart history-video-forge` |
| 查看状态 | `nssm status history-video-forge` |
| 修改配置 | `nssm edit history-video-forge` |
| 删除服务 | `nssm remove history-video-forge` |
| 查看 Windows 系统服务 | `services.msc` → 找到 "history-video-forge" |

---

## 五、验证清单

| 检查项   | 方法 |
|----------|------|
| 服务已安装 | `sc.exe query history-video-forge` 显示 `RUNNING` |
| 存活与就绪 | 本机 /healthz 和 /readyz；readyz 返回 200/ready |
| 前端与认证 | 通过 HTTPS 代理域名打开 Vue 页面并登录，核对 owner 隔离 |
| 后台运行 | 断开远程桌面后从允许来源访问 HTTPS 域名，核对服务仍运行 |
| 开机自启 | 在腾讯云控制台重启服务器，等 2 分钟后验证服务自动恢复 |

---

## 六、日常维护

先停止服务并做一致性备份，再更新代码、迁移、核对激活与构建；完成后启动服务并检查 /readyz。service-manager.ps1 菜单的“更新”只做拉取/安装/构建/重启，当前不会完成数据库迁移与激活；菜单“备份”只是压缩 storage，不能代替 SQLite 一致性备份。

```powershell
cd C:\work\ai\history-video-forge
C:\nssm\nssm.exe stop history-video-forge
$env:DATABASE_URL = 'file:C:/work/ai/history-video-forge/storage/history-video-forge.db'
npx tsx backend/src/cli/database-operations.ts backup --destination D:/backup/history-video-forge
# 媒体与 trace 另行备份；DATABASE_URL 若指向 storage 外，须纳入独立备份
Compress-Archive -Path storage\ -DestinationPath D:\backup\storage-$(Get-Date -Format yyyyMMdd-HHmmss).zip

git pull origin dev
npm ci
npm exec --workspace backend -- prisma migrate deploy --config prisma.config.ts
npx tsx backend/src/cli/database-operations.ts status
# 必要时按 3.4 核对并刷新既有激活模式
npm run build
C:\nssm\nssm.exe start history-video-forge
```

### 数据迁移与恢复

当前主记录在 SQLite，不以 storage/db-snapshot.json 恢复。迁移已有 V2 部署时，将一致性数据库备份与对应媒体/trace 一起迁移，保持相对 storage 引用；目标 .env 设置正确 DATABASE_URL/owner，迁移与激活通过后再启动。禁止运行中直接覆盖整份 storage；新目标可先放置备份数据库，再核对 schema 和激活。

恢复已有目标数据库使用 CLI，服务必须已停止；restore 会先为旧目标创建一致性 safety backup，并验证待恢复备份：

```powershell
npx tsx backend/src/cli/database-operations.ts restore --backup '<数据库备份路径>' --confirm --service-stopped
npx tsx backend/src/cli/database-operations.ts status
```

旧 V1 JSON 数据的迁入须单独执行 import → verify → activate --mode legacy_import --source-sha256 <已验证SHA>，不能把 JSON 复制过去当成当前主库。备份实现见 backend/src/db/operations/backup-database.ts，恢复见 restore-database.ts。

---

## 七、注意事项

- 使用 Windows 服务获得自启、后台运行与故障恢复；断开远程桌面和注销会话要分别验证。
- 备份包含实际 DATABASE_URL 指向的 SQLite、一致的媒体/trace 和部署配置；密钥配置单独妥善保存。
- SQLite 由项目 Prisma/better-sqlite3 adapter 使用，无需独立数据库服务；JSON 快照仅用于历史导入。
- 腾讯云 Windows Server 默认只 C 盘有空间，如果需要存放大量视频产出，建议挂一块数据盘，把 `storage/` 路径做符号链接指过去。
- 如果要配域名 + HTTPS，在服务器前面加 nginx 反向代理，Node.js 改为 `SERVER_HOST=127.0.0.1`，只开 443 端口给公网。
