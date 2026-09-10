@echo off
cd /d "%~dp0"
echo [1/4] Building H5 bundle...
call npm run build:h5 || goto :err
echo [2/4] Installing desktop dependencies...
cd desktop
if not exist node_modules ( call npm install || goto :err )
echo [3/4] Running sync logic self-tests...
call npm run selftest || goto :err
echo [4/4] Packaging Windows EXE...
call npm run dist || goto :err
echo.
echo Done. Installer + portable EXE are in: desktop\release\
pause
exit /b 0
:err
echo.
echo Build failed. See messages above.
pause
exit /b 1
