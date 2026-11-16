@echo off
title ARCHMAGE - Tenth Circle
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if errorlevel 1 pause
