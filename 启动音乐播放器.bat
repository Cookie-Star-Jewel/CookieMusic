@echo off
title CookieMusic 音乐播放器（隧道歌词）

rem 一键启动：双击本文件即可。关闭本窗口 = 停止服务器。
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\next" (
    echo 首次运行：正在安装依赖（约 1-2 分钟）...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

rem 若 3000 端口已有服务器在跑，直接打开浏览器
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient('localhost',3000);$c.Close();exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 (
    echo 服务器已在运行，直接打开浏览器。
    start "" "http://localhost:3000/"
    timeout /t 3 /nobreak >nul
    exit /b 0
)

echo 正在启动服务器...（关闭本窗口即停止）
start "" cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3000/"
call npm run dev
echo.
echo 服务器已停止。
pause
