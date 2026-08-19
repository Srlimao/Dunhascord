@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" x64
if not exist "src\bin" mkdir "src\bin"
cl.exe /O2 /EHsc /std:c++17 /Fe:"src\bin\process_audio_capture.exe" src\native\process_audio_capturer.cpp Ole32.lib
if exist process_audio_capturer.obj del process_audio_capturer.obj
