@echo off
setlocal
where node >nul 2>nul || (echo Node.js 18+ is required. & pause & exit /b 1)
if not exist node_modules call npm install
npm start
