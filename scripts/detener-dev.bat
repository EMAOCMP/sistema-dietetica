@echo off
setlocal
set "DIR=C:\Users\swami\Desktop\Dietetica\Dietetica-Supabase"
set "LOG=%DIR%\scripts\dev-server.log"

rem Busca el PID que escucha en el puerto 3000 y lo mata con todo su arbol.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr LISTENING ^| findstr /c:":3000 "') do (
  echo [%date% %time%] Deteniendo PID %%p puerto 3000 >> "%LOG%"
  taskkill /PID %%p /T /F >nul 2>&1
)

ping -n 3 127.0.0.1 >nul
netstat -ano | findstr LISTENING | findstr /c:":3000 " >nul
if %errorlevel%==0 (
  echo [%date% %time%] Puerto 3000 SIGUE ACTIVO tras taskkill.>> "%LOG%"
  echo El puerto 3000 sigue activo. Revisar manualmente.
  exit /b 1
)
echo [%date% %time%] Server detenido OK.>> "%LOG%"
echo Server detenido.
exit /b 0
