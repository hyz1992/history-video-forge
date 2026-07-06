@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set SERVICE_NAME=history-video-forge
set PROJECT_DIR=C:\work\ai\history-video-forge
set LOG_DIR=%PROJECT_DIR%\logs

echo ============================================
echo   History Video Forge - Windows Service Manager
echo ============================================
echo.

where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 找不到 nssm 命令，请确认已将 nssm.exe 所在目录加入 PATH 环境变量
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 找不到 node 命令，请先安装 Node.js
    pause
    exit /b 1
)

:menu
echo.
echo 请选择操作:
echo   [1] 安装服务（首次部署）
echo   [2] 启动服务
echo   [3] 停止服务
echo   [4] 重启服务
echo   [5] 查看状态
echo   [6] 查看日志
echo   [7] 编辑配置
echo   [8] 更新部署（git pull + 构建 + 重启）
echo   [9] 备份数据
echo   [10] 卸载服务（删除 Windows 服务登记）
echo   [0] 退出
echo.
set /p choice=请输入数字 (0-10): 

if "%choice%"=="1" goto install
if "%choice%"=="2" goto start
if "%choice%"=="3" goto stop
if "%choice%"=="4" goto restart
if "%choice%"=="5" goto status
if "%choice%"=="6" goto logs
if "%choice%"=="7" goto edit
if "%choice%"=="8" goto update
if "%choice%"=="9" goto backup
if "%choice%"=="10" goto uninstall
if "%choice%"=="0" goto end

echo 无效选项，请重新选择。
goto menu

:install
echo.
echo [1/5] 创建日志目录...
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo [2/5] 注册 Windows 服务...
nssm install %SERVICE_NAME% node "%PROJECT_DIR%"
nssm set %SERVICE_NAME% AppDirectory "%PROJECT_DIR%"
nssm set %SERVICE_NAME% AppParameters "scripts/start-prod.mjs"

echo [3/5] 设置开机自启...
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START

echo [4/5] 设置崩溃自动重启（延迟 10 秒）...
nssm set %SERVICE_NAME% AppExit Default Restart
nssm set %SERVICE_NAME% AppRestartDelay 10000

echo [5/5] 设置日志输出...
nssm set %SERVICE_NAME% AppStdout "%LOG_DIR%\stdout.log"
nssm set %SERVICE_NAME% AppStderr "%LOG_DIR%\stderr.log"
nssm set %SERVICE_NAME% AppStdoutCreationDisposition 4
nssm set %SERVICE_NAME% AppStderrCreationDisposition 4

echo.
echo [完成] 服务已安装。正在启动...
nssm start %SERVICE_NAME%

echo.
call :check_health
goto menu

:start
echo.
echo 正在启动服务...
nssm start %SERVICE_NAME%
call :check_health
goto menu

:stop
echo.
echo 正在停止服务...
nssm stop %SERVICE_NAME%
call :show_status
goto menu

:restart
echo.
echo 正在重启服务...
nssm restart %SERVICE_NAME%
call :check_health
goto menu

:status
echo.
call :show_status
echo.
echo 最近 5 条 stdout 日志:
if exist "%LOG_DIR%\stdout.log" (
    powershell -Command "Get-Content '%LOG_DIR%\stdout.log' -Tail 5"
) else (
    echo   （暂无日志）
)
goto menu

:logs
echo.
echo 已打开日志目录: %LOG_DIR%
explorer "%LOG_DIR%"
goto menu

:edit
echo.
echo 打开 NSSM 配置窗口（关闭窗口后继续）...
nssm edit %SERVICE_NAME%
goto menu

:update
echo.
echo ===== 开始更新部署 =====
echo [1/5] 拉取最新代码...
cd /d "%PROJECT_DIR%"
git pull origin dev
if %errorlevel% neq 0 (
    echo [警告] git pull 失败，请检查网络或手动处理冲突
    pause
    goto menu
)

echo [2/5] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] npm install 失败
    pause
    goto menu
)

echo [3/5] 构建前后端...
call npm run build
if %errorlevel% neq 0 (
    echo [错误] npm run build 失败
    pause
    goto menu
)

echo [4/5] 停止服务...
nssm stop %SERVICE_NAME%

echo [5/5] 启动服务...
nssm start %SERVICE_NAME%

echo.
echo [完成] 部署更新完毕。
call :check_health
goto menu

:backup
echo.
set BACKUP_NAME=storage-%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%
set BACKUP_NAME=%BACKUP_NAME: =0%
set BACKUP_DIR=%PROJECT_DIR%\..\backups
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo 正在备份 storage/ 到 %BACKUP_DIR%\%BACKUP_NAME%.zip ...
cd /d "%PROJECT_DIR%"
powershell -Command "Compress-Archive -Path storage\* -DestinationPath '%BACKUP_DIR%\%BACKUP_NAME%.zip' -Force"

if %errorlevel% equ 0 (
    echo [完成] 备份已保存: %BACKUP_DIR%\%BACKUP_NAME%.zip
) else (
    echo [错误] 备份失败
)
goto menu

:uninstall
echo.
echo ===== 卸载服务 =====
echo 警告：这将从 Windows 服务列表中移除 %SERVICE_NAME%。
echo 服务会在卸载前自动停止。
echo.
set /p confirm=确认卸载？(输入 YES 继续): 
if not "%confirm%"=="YES" (
    echo 已取消。
    goto menu
)

echo.
echo [1/2] 停止服务...
nssm stop %SERVICE_NAME%

echo [2/2] 删除服务登记...
nssm remove %SERVICE_NAME% confirm

echo.
echo [完成] 服务已卸载。
echo 注意：项目代码和 storage/ 数据未被删除，如需彻底清理请手动删除项目目录。
goto menu

:end
exit /b 0

:check_health
echo.
echo 等待服务就绪（5 秒）...
timeout /t 5 /nobreak >nul
echo 验证健康检查...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/healthz' -UseBasicParsing -TimeoutSec 3; Write-Host '  [OK]' $r.Content } catch { Write-Host '  [等待中] 服务可能还在启动，稍后访问 http://服务器IP:3000/healthz 验证' }"
exit /b 0

:show_status
echo 服务状态:
sc query %SERVICE_NAME% | findstr STATE
exit /b 0
