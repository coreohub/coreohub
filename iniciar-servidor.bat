@echo off
title CoreoHub - Servidor Local
cd /d "d:\Documentos\CoreoHub"
echo.
echo  ================================================
echo   COREOHUB - Iniciando servidor...
echo   Acesse: http://localhost:3000
echo   Rede:   http://192.168.15.6:3000
echo  ================================================
echo.
npm run dev -- --host
pause
