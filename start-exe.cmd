@echo off
rem 开发运行：先构建 H5，再用 Electron 直接加载（不打包），便于快速验证桌面端。
cd /d "%~dp0"
call npm run build:h5 || goto :err
cd desktop
if not exist node_modules ( call npm install || goto :err )
call npm start
exit /b 0
:err
echo.
echo Failed. See messages above.
pause
exit /b 1
