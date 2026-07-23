@echo off
title GokBall Server (Host)
echo ============================================
echo        GokBall Server Baslatiliyor...
echo ============================================
echo.
echo Once oyunu build edelim...
call npm run build
if %errorlevel% neq 0 (
    echo Build basarisiz oldu!
    pause
    exit /b 1
)
echo.
echo Build basarili!
echo.
echo ============================================
echo  Sunucu baslatiliyor...
echo  Port: 3001
echo.
echo  IP adresinizi ogrenmek icin:
echo    - CMD'ye "ipconfig" yazin
echo    - Ayarlar - WiFi - Ozellikler
echo.
echo  Arkadaslariniz tarayicidan su adrese girsin:
echo    http://SIZIN_IP:3001
echo.
echo  Kendi bilgisayarinizdan:
echo    http://localhost:3001
echo ============================================
echo.
node server/index.js
pause
