# History Video Forge - Windows Service Manager
# 右键以管理员身份运行此脚本

$ErrorActionPreference = "Continue"
$SERVICE_NAME = "history-video-forge"
$PROJECT_DIR = "C:\work\ai\history-video-forge"
$LOG_DIR = "$PROJECT_DIR\logs"

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host "[错误] 找不到 nssm 命令，请确认已将 nssm.exe 所在目录加入 PATH 环境变量" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[错误] 找不到 node 命令，请先安装 Node.js" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

function Show-Header {
    Clear-Host
    Write-Host "============================================"
    Write-Host "  History Video Forge - 服务管理器"
    Write-Host "============================================"
    Write-Host ""
}

function Show-HealthCheck {
    Write-Host "等待服务就绪（5 秒）..."
    Start-Sleep -Seconds 5
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000/healthz" -UseBasicParsing -TimeoutSec 3
        Write-Host "  [OK] $($r.Content)" -ForegroundColor Green
    } catch {
        Write-Host "  [等待中] 服务可能还在启动，稍后访问 http://127.0.0.1:3000/healthz 验证" -ForegroundColor Yellow
    }
}

function Show-Status {
    Write-Host "服务状态:"
    sc query $SERVICE_NAME | Select-String "STATE"
}

function Do-Install {
    Write-Host ""
    Write-Host "[1/5] 创建日志目录..." -ForegroundColor Cyan
    if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null }

    Write-Host "[2/5] 注册 Windows 服务..."
    nssm install $SERVICE_NAME node $PROJECT_DIR
    nssm set $SERVICE_NAME AppDirectory $PROJECT_DIR
    nssm set $SERVICE_NAME AppParameters "scripts/start-prod.mjs"

    Write-Host "[3/5] 设置开机自启..."
    nssm set $SERVICE_NAME Start SERVICE_AUTO_START

    Write-Host "[4/5] 设置崩溃自动重启（延迟 10 秒）..."
    nssm set $SERVICE_NAME AppExit Default Restart
    nssm set $SERVICE_NAME AppRestartDelay 10000

    Write-Host "[5/5] 设置日志输出..."
    nssm set $SERVICE_NAME AppStdout "$LOG_DIR\stdout.log"
    nssm set $SERVICE_NAME AppStderr "$LOG_DIR\stderr.log"
    nssm set $SERVICE_NAME AppStdoutCreationDisposition 4
    nssm set $SERVICE_NAME AppStderrCreationDisposition 4

    Write-Host ""
    Write-Host "[完成] 服务已安装。正在启动..." -ForegroundColor Green
    nssm start $SERVICE_NAME
    Write-Host ""
    Show-HealthCheck
}

function Do-Uninstall {
    Write-Host ""
    Write-Host "===== 卸载服务 =====" -ForegroundColor Yellow
    Write-Host "警告：这将从 Windows 服务列表中移除 $SERVICE_NAME。" -ForegroundColor Red
    Write-Host "服务会在卸载前自动停止。"
    Write-Host ""
    $confirm = Read-Host "确认卸载？(输入 YES 继续)"
    if ($confirm -ne "YES") {
        Write-Host "已取消。"
        return
    }
    Write-Host ""
    Write-Host "[1/2] 停止服务..."
    nssm stop $SERVICE_NAME
    Write-Host "[2/2] 删除服务登记..."
    nssm remove $SERVICE_NAME confirm
    Write-Host ""
    Write-Host "[完成] 服务已卸载。" -ForegroundColor Green
    Write-Host "注意：项目代码和 storage/ 数据未被删除，如需彻底清理请手动删除项目目录。"
}

function Do-Update {
    Write-Host ""
    Write-Host "===== 开始更新部署 =====" -ForegroundColor Cyan
    Write-Host "[1/5] 拉取最新代码..."
    Set-Location $PROJECT_DIR
    git pull origin dev
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[警告] git pull 失败，请检查网络或手动处理冲突" -ForegroundColor Yellow
        Read-Host "按回车继续"
        return
    }

    Write-Host "[2/5] 安装依赖..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] npm install 失败" -ForegroundColor Red
        Read-Host "按回车继续"
        return
    }

    Write-Host "[3/5] 构建前后端..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] npm run build 失败" -ForegroundColor Red
        Read-Host "按回车继续"
        return
    }

    Write-Host "[4/5] 停止服务..."
    nssm stop $SERVICE_NAME
    Write-Host "[5/5] 启动服务..."
    nssm start $SERVICE_NAME
    Write-Host ""
    Write-Host "[完成] 部署更新完毕。" -ForegroundColor Green
    Show-HealthCheck
}

function Do-Backup {
    Write-Host ""
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = "$PROJECT_DIR\..\backups"
    $backupFile = "$backupDir\storage-$timestamp.zip"
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
    Write-Host "正在备份 storage/ 到 $backupFile ..."
    Set-Location $PROJECT_DIR
    Compress-Archive -Path storage\* -DestinationPath $backupFile -Force
    if ($?) {
        Write-Host "[完成] 备份已保存: $backupFile" -ForegroundColor Green
    } else {
        Write-Host "[错误] 备份失败" -ForegroundColor Red
    }
}

while ($true) {
    Show-Header
    Write-Host "请选择操作:"
    Write-Host "  [1] 安装服务（首次部署）"
    Write-Host "  [2] 启动服务"
    Write-Host "  [3] 停止服务"
    Write-Host "  [4] 重启服务"
    Write-Host "  [5] 查看状态"
    Write-Host "  [6] 查看日志"
    Write-Host "  [7] 编辑配置"
    Write-Host "  [8] 更新部署 (git pull + 构建 + 重启)"
    Write-Host "  [9] 备份数据"
    Write-Host "  [10] 卸载服务（删除 Windows 服务登记）"
    Write-Host "  [0] 退出"
    Write-Host ""
    $choice = Read-Host "请输入数字 (0-10)"

    switch ($choice) {
        "1" { Do-Install; Read-Host "按回车返回菜单" }
        "2" { Write-Host ""; Write-Host "正在启动服务..."; nssm start $SERVICE_NAME; Show-HealthCheck; Read-Host "按回车返回菜单" }
        "3" { Write-Host ""; Write-Host "正在停止服务..."; nssm stop $SERVICE_NAME; Show-Status; Read-Host "按回车返回菜单" }
        "4" { Write-Host ""; Write-Host "正在重启服务..."; nssm restart $SERVICE_NAME; Show-HealthCheck; Read-Host "按回车返回菜单" }
        "5" {
            Write-Host ""; Show-Status; Write-Host ""
            Write-Host "最近 5 条 stdout 日志:"
            if (Test-Path "$LOG_DIR\stdout.log") { Get-Content "$LOG_DIR\stdout.log" -Tail 5 } else { Write-Host "  （暂无日志）" }
            Read-Host "按回车返回菜单"
        }
        "6" {
            Write-Host ""
            if (Test-Path $LOG_DIR) { Write-Host "已打开日志目录: $LOG_DIR"; explorer $LOG_DIR }
            else { Write-Host "日志目录不存在: $LOG_DIR" }
            Read-Host "按回车返回菜单"
        }
        "7" { Write-Host ""; Write-Host "打开 NSSM 配置窗口（关闭窗口后继续）..."; nssm edit $SERVICE_NAME; Read-Host "按回车返回菜单" }
        "8" { Do-Update; Read-Host "按回车返回菜单" }
        "9" { Do-Backup; Read-Host "按回车返回菜单" }
        "10" { Do-Uninstall; Read-Host "按回车返回菜单" }
        "0" { exit 0 }
        default { Write-Host "无效选项，请重新选择。" -ForegroundColor Yellow; Start-Sleep -Seconds 1 }
    }
}
