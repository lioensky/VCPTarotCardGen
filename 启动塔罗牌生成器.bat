@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo ========================================
echo VCPTarotCardGen 塔罗牌生成器
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js。
  echo 下载地址: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "server.js" (
  echo [错误] 未找到 server.js，请确认本 bat 位于项目根目录。
  echo.
  pause
  exit /b 1
)

if not exist "config.env" (
  echo [提示] 未找到 config.env。
  if exist "config.env.example" (
    echo 正在从 config.env.example 创建 config.env...
    copy "config.env.example" "config.env" >nul
    echo 已创建 config.env，请填写 API 配置后重新运行。
  ) else (
    echo 请手动创建 config.env 并填写 API 配置。
  )
  echo.
  pause
  exit /b 1
)

echo 服务即将启动：
echo http://localhost:3107
echo.
echo 启动后请不要关闭此窗口；关闭窗口将停止服务器。
echo.

start "" "http://localhost:3107"
node server.js

echo.
echo 服务器已退出。
pause