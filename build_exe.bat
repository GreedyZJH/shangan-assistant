@echo off
cd /d %~dp0
echo ============================================
echo   上岸助手 打包脚本（生成 dist\上岸助手.exe）
echo ============================================
py -3.12 -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple || goto :err
py -3.12 -m PyInstaller --noconfirm --clean --onefile --windowed ^
  --name 上岸助手 ^
  --paths desktop --paths . ^
  --add-data "desktop\web;web" ^
  --collect-all webview ^
  --collect-all pythonnet ^
  --collect-all clr_loader ^
  --collect-submodules xhtml2pdf ^
  --hidden-import html5lib.treebuilders ^
  --hidden-import html5lib.treebuilders.etree ^
  --hidden-import html5lib.treebuilders.etree_lxml ^
  --hidden-import html5lib.treewalkers ^
  --hidden-import html5lib.serializer ^
  desktop\app.py || goto :err
echo.
echo 打包完成: dist\上岸助手.exe
pause
exit /b 0
:err
echo.
echo 打包失败，请检查上方报错信息。
pause
exit /b 1
