@echo off
REM Remove Git bash linker from PATH that conflicts with MSVC link.exe
set PATH=%PATH:C:\Program Files\Git\usr\bin;=%
set PATH=%PATH:C:\Program Files\Git\mingw64\bin;=%

REM Find and run Visual Studio environment setup
for /f "tokens=*" %%i in ('dir /b /s "C:\Program Files*\Microsoft Visual Studio\*\*\VC\Auxiliary\Build\vcvarsall.bat" 2^>nul ^| head -1') do (
    echo Found vcvarsall.bat: %%i
    call "%%i" x64
    goto build
)

REM If not found, try with vswhere
for /f "tokens=*" %%i in ('where vswhere') do (
    for /f "tokens=*" %%j in ('%%i -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath') do (
        echo Found Visual Studio at: %%j
        call "%%j\VC\Auxiliary\Build\vcvarsall.bat" x64
        goto build
    )
)

:build
echo.
echo Building Arbitrage Bot...
echo.
cargo clean
cargo build --bin arbitrage-bot
echo.
if %ERRORLEVEL% EQU 0 (
    echo Build succeeded!
) else (
    echo Build failed with error code: %ERRORLEVEL%
)
pause
