@echo off
title Dance Pro Festival - Servidor Local
cd /d "d:\Documentos\Dance Pro Festival"
echo.
echo  ================================================
echo   DANCE PRO FESTIVAL - Iniciando servidor...
echo   Acesse: http://localhost:3000
echo   Rede:   http://192.168.15.6:3000
echo  ================================================
echo.
npm run dev -- --host
pause
