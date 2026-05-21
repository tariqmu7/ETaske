@echo off
echo ============================================
echo  ETaske Outlook Bridge - Build to EXE
echo ============================================
echo.

echo [1/3] Installing Python dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed. Make sure Python is installed.
    pause
    exit /b 1
)

echo.
echo [2/3] Installing PyInstaller...
pip install pyinstaller
if errorlevel 1 (
    echo ERROR: PyInstaller install failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Building standalone EXE...
pyinstaller ^
    --onefile ^
    --name "ETaske-OutlookBridge" ^
    --add-data "." ^
    --hidden-import win32com ^
    --hidden-import win32com.client ^
    --hidden-import pythoncom ^
    --hidden-import pywintypes ^
    outlook_bridge.py

if errorlevel 1 (
    echo ERROR: PyInstaller build failed. See output above.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  SUCCESS!
echo  Executable: dist\ETaske-OutlookBridge.exe
echo  Share this file with your team members.
echo  They just double-click it - no Python needed.
echo ============================================
pause
