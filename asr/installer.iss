; Native Windows installer. Runtime/model downloads are performed by setup-runtime.ps1.
#ifndef AppVersion
  #define AppVersion "1.3.5"
#endif

[Setup]
AppId={{0D9B5EE6-9B9D-4266-9342-7E099B93508A}
AppName=Vid2Notes 本地转写
AppVersion={#AppVersion}
AppPublisher=Vid2Notes
DefaultDirName={localappdata}\Vid2Notes-ASR
DefaultGroupName=Vid2Notes
DisableProgramGroupPage=yes
DisableWelcomePage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
RestartApplications=no
ExtraDiskSpaceRequired=2147483648
Compression=lzma2
SolidCompression=yes
OutputDir=..\downloads
OutputBaseFilename=vid2notes-asr-setup
UninstallDisplayName=Vid2Notes 本地转写

[Languages]
Name: "zhcn"; MessagesFile: "languages\ChineseSimplified.isl"

[Messages]
WelcomeLabel2=此向导将在所选目录中安装 Vid2Notes 本地转写组件。%n%n安装时联网下载 Python、转写依赖和 small 模型，模型约 461 MiB。选择 GPU 时还会下载约 1.3 GiB 的运行库。%n%n更新已有组件时，请先关闭原来的服务窗口，并选择原安装目录。
FinishedLabel=本地转写组件已安装完成。%n%n复制下方连接码，在工作台“本地转写”页面连接组件。以后可从开始菜单启动本地转写。

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked

[Files]
Source: "server.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "start-local-asr.cmd"; DestDir: "{app}"; DestName: "启动本地转写.cmd"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup-runtime.ps1"; Flags: dontcopy
Source: "download_model.py"; Flags: dontcopy

[Icons]
Name: "{group}\启动本地转写"; Filename: "{app}\启动本地转写.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\启动本地转写"; Filename: "{app}\启动本地转写.cmd"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{group}\卸载本地转写"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\启动本地转写.cmd"; Description: "立即启动本地转写组件"; Flags: shellexec postinstall nowait skipifsilent

[UninstallDelete]
; Only installer-owned runtime folders; connection configuration is retained.
Type: filesandordirs; Name: "{app}\.venv"
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\model"
Type: filesandordirs; Name: "{app}\cache"
Type: filesandordirs; Name: "{app}\tmp"
Type: files; Name: "{app}\.vid2notes-asr"

[Code]
var
  ModePage: TInputOptionWizardPage;
  ProgressPage: TOutputProgressWizardPage;
  DetailMemo: TNewMemo;
  DetailButton, CopyButton: TNewButton;
  CodeEdit: TNewEdit;
  StepName, LastError, CompletedDirectory, CompletedMode: String;

procedure ToggleDetails(Sender: TObject);
begin
  DetailMemo.Visible := not DetailMemo.Visible;
  if DetailMemo.Visible then DetailButton.Caption := '收起详细日志'
  else DetailButton.Caption := '查看详细日志';
end;

procedure CopyConnectionCode(Sender: TObject);
begin
  CodeEdit.SelectAll;
  SendMessage(CodeEdit.Handle, $0301, 0, 0);
  CopyButton.Caption := '已复制';
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then begin
    CodeEdit.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(12);
    CopyButton.Top := CodeEdit.Top;
    WizardForm.RunList.Top := CodeEdit.Top + CodeEdit.Height + ScaleY(16);
    WizardForm.RunList.Height := WizardForm.FinishedPage.Height - WizardForm.RunList.Top;
  end;
end;

function SelectedMode: String;
begin
  if ModePage.SelectedValueIndex = 1 then Result := 'gpu'
  else Result := 'cpu';
end;

procedure InitializeWizard;
begin
  ModePage := CreateInputOptionPage(wpSelectDir, '选择运行方式',
    '选择 CPU 或 NVIDIA GPU', '所有运行环境、模型和缓存都放在所选安装目录中', True, False);
  ModePage.Add('CPU：无需独立显卡，建议预留 3 GB 磁盘空间');
  ModePage.Add('NVIDIA GPU：额外下载约 1.3 GiB，建议预留 8 GB 磁盘空间');
  if GetPreviousData('RuntimeMode', 'cpu') = 'gpu' then ModePage.SelectedValueIndex := 1
  else ModePage.SelectedValueIndex := 0;
  ProgressPage := CreateOutputProgressPage('安装运行环境与模型', '安装过程中请保持此窗口打开');
  DetailButton := TNewButton.Create(WizardForm);
  DetailButton.Parent := ProgressPage.Surface;
  DetailButton.SetBounds(0, ScaleY(88), ScaleX(120), ScaleY(25));
  DetailButton.Caption := '查看详细日志';
  DetailButton.OnClick := @ToggleDetails;
  DetailMemo := TNewMemo.Create(WizardForm);
  DetailMemo.Parent := ProgressPage.Surface;
  DetailMemo.SetBounds(0, ScaleY(124), ProgressPage.SurfaceWidth, ProgressPage.SurfaceHeight - ScaleY(124));
  DetailMemo.ReadOnly := True;
  DetailMemo.ScrollBars := ssVertical;
  DetailMemo.Visible := False;

  CodeEdit := TNewEdit.Create(WizardForm);
  CodeEdit.Parent := WizardForm.FinishedPage;
  CodeEdit.SetBounds(WizardForm.FinishedLabel.Left, ScaleY(145),
    WizardForm.FinishedLabel.Width - ScaleX(100), ScaleY(23));
  CodeEdit.ReadOnly := True;
  CopyButton := TNewButton.Create(WizardForm);
  CopyButton.Parent := WizardForm.FinishedPage;
  CopyButton.SetBounds(CodeEdit.Left + CodeEdit.Width + ScaleX(8), CodeEdit.Top, ScaleX(92), ScaleY(25));
  CopyButton.Caption := '复制连接码';
  CopyButton.OnClick := @CopyConnectionCode;
  WizardForm.RunList.Top := ScaleY(194);
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'RuntimeMode', SelectedMode);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Target: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then begin
    Target := RemoveBackslashUnlessRoot(ExpandFileName(WizardDirValue));
    if Length(Target) <= 3 then begin
      MsgBox('请在磁盘中选择一个文件夹，不要直接安装到磁盘根目录', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo + NewLine + NewLine + '运行方式：' + NewLine;
  if SelectedMode = 'gpu' then Result := Result + Space + 'NVIDIA GPU'
  else Result := Result + Space + 'CPU';
  Result := Result + NewLine + NewLine + MemoTasksInfo;
end;

procedure RuntimeOutput(const S: String; const Error, FirstLine: Boolean);
var
  Number: Integer;
begin
  if Copy(S, 1, 5) = 'STEP|' then begin
    Number := StrToIntDef(Copy(S, 6, Length(S)), 0);
    case Number of
      1: StepName := '下载运行环境安装工具';
      2: StepName := '安装独立 Python 3.12';
      3: StepName := '安装转写依赖';
      4: StepName := '下载 small 转写模型';
      5: if SelectedMode = 'gpu' then StepName := '安装 NVIDIA GPU 运行库'
         else StepName := '配置 CPU 转写';
      6: StepName := '检查运行环境并生成连接配置';
    end;
    ProgressPage.SetText(StepName, Format('第 %d / 6 步', [Number]));
    ProgressPage.SetProgress(Number - 1, 6);
  end else if S = 'DONE' then ProgressPage.SetProgress(6, 6)
  else begin
    if Copy(S, 1, 6) = 'ERROR|' then LastError := Copy(S, 7, Length(S));
    DetailMemo.Lines.Add(S);
    Log(S);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Params, Target, Mode, ResultFile: String;
  CodeData: AnsiString;
  Retry: Boolean;
begin
  Result := '';
  Target := WizardDirValue;
  Mode := SelectedMode;
  if (CompletedDirectory = Target) and (CompletedMode = Mode) then Exit;
  ExtractTemporaryFile('setup-runtime.ps1');
  ExtractTemporaryFile('download_model.py');
  ResultFile := ExpandConstant('{tmp}\connection-code.txt');
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\setup-runtime.ps1') + '" -InstallDir "' + Target +
    '" -Mode ' + Mode + ' -ResultFile "' + ResultFile + '"';
  repeat
    Retry := False;
    LastError := '';
    ResultCode := 0;
    DetailMemo.Lines.Clear;
    ProgressPage.SetText('准备安装', Target);
    ProgressPage.SetProgress(0, 6);
    ProgressPage.Show;
    try
      if not ExecAndLogOutput(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
        Params, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode, @RuntimeOutput) then
        LastError := '无法启动运行环境安装程序';
      if (ResultCode <> 0) and (LastError = '') then LastError := '安装未完成，请查看详细日志';
      if LastError <> '' then begin
        DetailMemo.Visible := True;
        DetailButton.Caption := '收起详细日志';
        if not WizardSilent then Retry := MsgBox(StepName + '失败' + #13#10 + LastError + #13#10#13#10 +
          '点击“重试”继续安装，已下载的文件会保留', mbError, MB_RETRYCANCEL) = IDRETRY;
        if not Retry then Result := LastError;
      end else if not LoadStringFromFile(ResultFile, CodeData) then
        Result := '无法读取连接配置，请重新运行安装程序'
      else begin
        CodeEdit.Text := Trim(String(CodeData));
        CompletedDirectory := Target;
        CompletedMode := Mode;
      end;
    finally
      ProgressPage.Hide;
    end;
  until not Retry;
end;
