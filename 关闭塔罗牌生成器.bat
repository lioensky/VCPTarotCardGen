@echo off
chcp 65001 >nul
setlocal

echo ========================================
echo 关闭 VCPTarotCardGen 塔罗牌生成器
echo ========================================
echo.

set "PORT=3107"

echo 正在查找占用端口 %PORT% 的进程...
set "FOUND="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "FOUND=1"
  echo 正在结束 PID %%P ...
  taskkill /F /PID %%P
)

if not defined FOUND (
  echo 未发现正在监听 http://localhost:%PORT% 的服务器进程。
) else (
  echo.
  echo 关闭完成。
)

echo.
pause