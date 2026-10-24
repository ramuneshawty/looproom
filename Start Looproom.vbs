Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
runtime = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Python\pythoncore-3.14-64\pythonw.exe"
If Not files.FileExists(runtime) Then runtime = "pythonw.exe"
shell.Run Chr(34) & runtime & Chr(34) & " " & Chr(34) & folder & "\app.py" & Chr(34), 0, False
