@echo off
REM One-time setup. Windows. Safe to re-run: every step is idempotent.
setlocal
cd /d "%~dp0"

REM .npmrc engine-strict: npm ci refuses Node < 26.
call npm ci || exit /b 1
call npm rebuild better-sqlite3 || exit /b 1
call npm run prepare || exit /b 1
call npm run db:migrate || exit /b 1

REM LLM scoring is optional - a missing Ollama is a note, not a failure.
set FAST=gemma4:26b-a4b-it-qat
set DEEP=gemma4:31b-it-qat
where ollama >nul 2>nul
if errorlevel 1 (
  echo.
  echo Ollama not found - job scoring will use keywords only.
  echo For AI scoring: install from https://ollama.com, then re-run setup.bat
) else (
  call ollama pull %FAST% || exit /b 1
  call ollama pull %DEEP% || exit /b 1
  findstr /b /c:"LLM_MODEL=" .env >nul 2>nul || (
    echo.>> .env
    echo LLM_MODEL=%FAST%>> .env
  )
)

echo.
echo Done. Start it with: npm run dev
