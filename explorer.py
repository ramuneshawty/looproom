"""Open a folder through the Windows shell, optionally selecting an export."""
import ctypes
from ctypes import wintypes
from pathlib import Path
import subprocess
import sys

def request_open(folder,selected=None):
    """Keep a blocked Windows shell request from hanging the app's server."""
    args=[sys.executable,str(Path(__file__).resolve()),str(folder)]
    if selected: args.append(str(selected))
    try:
        result=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW,timeout=5)
    except subprocess.TimeoutExpired:
        raise OSError('Windows did not respond to the folder request. Use the folder path below.') from None
    if result.returncode:
        raise OSError(result.stderr.strip() or 'Windows could not open File Explorer.')

def open_folder(folder, selected=None):
    folder=Path(folder).resolve()
    if not folder.is_dir():
        raise ValueError('The export folder no longer exists.')
    ole=ctypes.OleDLL('ole32')
    shell=ctypes.WinDLL('shell32')
    shell.SHParseDisplayName.argtypes=[wintypes.LPCWSTR,ctypes.c_void_p,ctypes.POINTER(ctypes.c_void_p),wintypes.DWORD,ctypes.c_void_p]
    shell.SHParseDisplayName.restype=ctypes.c_long
    shell.SHOpenFolderAndSelectItems.argtypes=[ctypes.c_void_p,wintypes.UINT,ctypes.POINTER(ctypes.c_void_p),wintypes.DWORD]
    shell.SHOpenFolderAndSelectItems.restype=ctypes.c_long
    shell.ILFindLastID.argtypes=[ctypes.c_void_p]
    shell.ILFindLastID.restype=ctypes.c_void_p
    ole.CoTaskMemFree.argtypes=[ctypes.c_void_p]
    ole.CoInitializeEx(None,2)
    folder_id=ctypes.c_void_p();file_id=ctypes.c_void_p()
    def check(result):
        if result<0: raise OSError(f'Windows could not open File Explorer (0x{result & 0xffffffff:08X}).')
    try:
        check(shell.SHParseDisplayName(str(folder),None,ctypes.byref(folder_id),0,None))
        items=None;count=0
        if selected and Path(selected).is_file():
            selected=Path(selected).resolve()
            if selected.parent!=folder: raise ValueError('The selected file is outside the export folder.')
            check(shell.SHParseDisplayName(str(selected),None,ctypes.byref(file_id),0,None))
            items=(ctypes.c_void_p*1)(shell.ILFindLastID(file_id));count=1
        check(shell.SHOpenFolderAndSelectItems(folder_id,count,items,0))
    finally:
        if file_id.value: ole.CoTaskMemFree(file_id)
        if folder_id.value: ole.CoTaskMemFree(folder_id)
        ole.CoUninitialize()

if __name__=='__main__':
    try:
        open_folder(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else None)
    except Exception as exc:
        sys.stderr.write(str(exc))
        sys.exit(1)
