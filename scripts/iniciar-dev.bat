@echo off
setlocal
set "DIR=C:\Users\swami\Desktop\Dietetica\Dietetica-Supabase"
set "LOG=%DIR%\scripts\dev-server.log"

rem Si el puerto 3000 ya responde, el server ya corre: salir sin tocar nada.
netstat -ano | findstr LISTENING | findstr /c:":3000 " >nul
if %errorlevel%==0 (
  echo [%date% %time%] Puerto 3000 ya activo, no se relanza.>> "%LOG%"
  echo El server ya esta corriendo en http://localhost:3000
  exit /b 0
)

echo [%date% %time%] Arrancando dev server...>> "%LOG%"
cd /d "%DIR%"
start "Dietetica Dev Server" cmd /k "npm run dev"
exit /b 0
