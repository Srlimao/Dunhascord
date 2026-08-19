Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node src/server/server.js", 0, False
