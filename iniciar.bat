@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PYTHON=C:\Users\paulo\AppData\Local\Programs\Python\Python313\python.exe"
set "PORT=8080"
set "URL=http://127.0.0.1:%PORT%/"

if not exist "%PYTHON%" (
  echo Nao encontrei o Python em:
  echo %PYTHON%
  pause
  exit /b 1
)

echo.
echo Gestao de Contratos — SET / IDT
echo %URL%
echo Feche esta janela para encerrar o servidor.
echo.

start "" /b cmd /c "timeout /t 1 /nobreak >nul & start %URL%"
"%PYTHON%" -m http.server %PORT% --bind 127.0.0.1
echo.
echo O servidor foi encerrado.
pause
