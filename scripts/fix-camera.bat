@echo off
setlocal

:: Verifica se ja esta rodando como Administrador; se nao, relanca com elevacao (UAC)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Este script precisa de permissao de administrador. Solicitando...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================
echo  Corrigindo servico de camera do Windows
echo ============================================
echo.
echo Reiniciando FrameServer e FrameServerMonitor...

powershell -NoProfile -Command "Restart-Service -Name FrameServer -Force -ErrorAction SilentlyContinue; Restart-Service -Name FrameServerMonitor -Force -ErrorAction SilentlyContinue"

echo.
echo Concluido. Feche esta janela e tente ativar a camera de novo.
echo.
pause
