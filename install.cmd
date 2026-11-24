@echo off
rem Double-click to install Playerbots. Asks whether EveJS runs in Docker or natively.
where py >nul 2>nul
if %errorlevel%==0 (py -3 "%~dp0install.py" %*) else (python "%~dp0install.py" %*)
echo.
pause
