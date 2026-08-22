# PyInstaller spec para o BakersWhisper.exe
# Usado pelo GitHub Actions (.github/workflows/build-windows.yml).
# Para compilar localmente:  pyinstaller wim_bridge.spec

# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

hiddenimports = []
hiddenimports += collect_submodules("winrt")
hiddenimports += collect_submodules("winrt.windows")
hiddenimports += collect_submodules("mss")
hiddenimports += [
    "winocr",
    "winrt.windows.foundation",
    "winrt.windows.foundation.collections",
    "winrt.windows.globalization",
    "winrt.windows.graphics.imaging",
    "winrt.windows.media.ocr",
    "winrt.windows.storage.streams",
    "mss",
    "PIL",
    "PIL.Image",
    "win32gui",
    "win32con",
    "win32api",
    "win32process",
    "win32ui",
    "pywintypes",
    "pydirectinput",
    "requests",
    "tkinter",
    "tkinter.ttk",
    "tkinter.scrolledtext",
    "tkinter.messagebox",
]

datas = []
datas += collect_data_files("winocr")
datas += collect_data_files("winrt")

a = Analysis(
    ["public/downloads/wim_bridge_ocr.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "matplotlib",
        "numpy.tests",
        "scipy",
        "pandas",
        "IPython",
        "jupyter",
        "pytest",
    ],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="BakersWhisper",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # sem janela preta
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # ícone=optional, deixar None por enquanto
)
