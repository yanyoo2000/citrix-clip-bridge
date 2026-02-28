@echo off
set "SOURCE_FILE=\\Client\C$\Users\Public\Documents\clipboard-sync\clipboard.txt"
set "PASTE_POLL_MS=500"
node paste.js
pause
