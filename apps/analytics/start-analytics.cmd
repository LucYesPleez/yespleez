@echo off
rem YesPleez Analytics v2 — double-click to start, or put a shortcut to
rem this file in shell:startup to run it on login. Local-only, :4100.
title YesPleez Analytics
cd /d "%~dp0"
node --env-file=.env server.js
pause
