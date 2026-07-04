# Updates MCP-TFS2018 from the latest GitHub release zip (download, extract, npm ci).
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $ScriptDir "..")
node (Join-Path $ScriptDir "update.mjs")
