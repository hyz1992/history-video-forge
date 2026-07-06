# Windows Server (腾讯云) 部署指南

## 一、前置环境安装

### 1.1 安装 Node.js

下载 LTS 版本 (≥20)：https://nodejs.org ，双击 Windows Installer (.msi) 安装即可。

```powershell
node -v   # 应 ≥ v20
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
| TCP  | 3000 | 0.0.0.0/0  | 应用端口（或自定义的 SERVER_PORT） |
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
npm install
```

如果下载慢，可以先设淘宝镜像：

```powershell
npm config set registry https://registry.npmmirror.com
npm install
```

### 3.3 配置 `.env`

```powershell
copy .env.example .env
notepad .env
```

必须填写的内容：

```env
# ── LLM 大模型配置（必填） ──
LLM_PROVIDER=openai
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_API_KEY=你的API-Key
LLM_MODEL=glm-5.1
LLM_STRUCTURED_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_STRUCTURED_API_KEY=你的API-Key
LLM_STRUCTURED_MODEL=glm-5.1
LLM_TIMEOUT_MS=240000

# ── 视频/图片生成（可选） ──
ALIYUN_DASHSCOPE_API_KEY=你的阿里云DashScope-Key

# ── Remotion 渲染（可选） ──
REMOTION_BROWSER_EXECUTABLE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

# ── 部署配置 ──
SERVER_PORT=3000
SERVER_HOST=0.0.0.0
PUBLIC_BASE_URL=http://你的服务器公网IP:3000
```

### 3.4 构建

```powershell
npm run build
```

构建成功后会生成：
- `frontend/dist/` — 前端静态资源
- `backend/dist/` — 后端编译产物

### 3.5 快速验证

先手动启动一次，确认能跑起来：

```powershell
npm run start
```

看到以下输出表示成功，然后按 `Ctrl + C` 停掉：

```
{"status":"backend-server-ready","host":"0.0.0.0","port":3000}
```

浏览器访问 `http://<服务器公网IP>:3000/` 确认页面能打开、`/healthz` 返回 `{"status":"ok"}`。

---

## 四、注册为 Windows 服务（使用 NSSM）

> **为什么要用 NSSM？**
>
> 如果只是在远程桌面里跑 `npm run start`，关掉远程桌面窗口后进程就会被系统杀掉。
> NSSM 可以把 Node.js 程序注册为「Windows 系统服务」，效果等同于：
> - 开机自启（不需要登录）
> - 崩溃自动重启
> - 后台静默运行，关掉远程桌面也还活着
> - 能在 `services.msc` 里看到，像一个"真正的"后台服务

### 快捷方式：一键脚本

项目提供了根目录下的 `service-manager.bat`，把安装、启停、更新、备份等操作封装成了菜单，**右键以管理员身份运行**即可：

```
service-manager.bat
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

> **提示**：Path 填的是 `node.exe` 的路径，不是我们的 `.mjs` 文件。如果 Node.js 装在其他位置，先用 `where node` 查找。

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
sc query history-video-forge

# 浏览器验证
# http://<服务器公网IP>:3000/healthz → {"status":"ok","nodeEnv":"production"}
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
| 服务已安装 | `sc query history-video-forge` 显示 `RUNNING` |
| 健康检查 | 浏览器打开 `http://IP:3000/healthz`，返回 `{"status":"ok"}` |
| 前端页面 | 浏览器打开 `http://IP:3000/`，看到 Vue 页面 |
| 非登录态存活 | 关掉远程桌面，等 1 分钟后用手机访问 `http://IP:3000/healthz` |
| 开机自启 | 在腾讯云控制台重启服务器，等 2 分钟后验证服务自动恢复 |

---

## 六、日常维护

```powershell
cd C:\work\ai\history-video-forge

# 更新代码
git pull origin dev

# 重新安装依赖（如果有新增）
npm install

# 重新构建
npm run build

# 重启服务（让新代码生效）
C:\nssm\nssm.exe restart history-video-forge

# 备份数据（直接压缩 storage/ 目录即可）
Compress-Archive -Path storage\ -DestinationPath D:\backup\storage-$(Get-Date -Format yyyyMMdd).zip

# 查看服务事件日志
Get-EventLog -LogName System -Source "Service Control Manager" -Newest 10 | Where-Object { $_.Message -like "*history-video-forge*" }
```

### 迁移本地数据到服务器

如果你在本机开发时已经跑过一些视频任务，想把数据搬到服务器上，直接复制整个 `storage/` 目录即可：

1. 在服务器上先把服务停掉：

   ```powershell
   C:\nssm\nssm.exe stop history-video-forge
   ```

2. 把本机的 `storage/` 目录整个复制到服务器对应位置，覆盖即可。

3. 重启服务：
   ```powershell
   C:\nssm\nssm.exe start history-video-forge
   ```

`storage/` 包含：
- `storage/db-snapshot.json` — 所有项目记录
- `storage/projects/<日期>/<项目ID>/` — 每个项目独立目录，含视频、音频等渲染产物

---

## 七、注意事项

- **不要只靠远程桌面跑 `npm start`**，关掉窗口服务就死了，必须注册为 Windows 服务。
- `storage/` 目录包含所有项目数据和快照，备份只备份这个目录。
- 当前数据为纯内存 + JSON 快照方案，无需安装 SQLite/MySQL 等外部数据库。
- 腾讯云 Windows Server 默认只 C 盘有空间，如果需要存放大量视频产出，建议挂一块数据盘，把 `storage/` 路径做符号链接指过去。
- 如果要配域名 + HTTPS，在服务器前面加 nginx 反向代理，Node.js 改为 `SERVER_HOST=127.0.0.1`，只开 443 端口给公网。
