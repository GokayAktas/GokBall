@echo off
title GokBall Okul LAN Sunucusu
echo ==========================================
echo GokBall Okul LAN Sunucu Baslaticisi
echo ==========================================
echo.
echo Arkadaslarinizin katilmasi icin ev sahibi IP adresiniz (IPv4):
echo.
ipconfig | findstr /i "IPv4"
echo.
echo ==========================================
echo Arkadaslariniz tarayicilarina su adresi yazarak katilabilir:
echo http://[Ev Sahibi IPv4 Adresiniz]:3001
echo ==========================================
echo.
echo Sunucu baslatiliyor...
echo.

if exist "node.exe" (
    node.exe server/index.js
) else (
    node server/index.js
)
pause
