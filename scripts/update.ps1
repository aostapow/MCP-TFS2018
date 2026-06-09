# Updates MCP-TFS2018 from git (fetch, pull, npm ci, build).
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $ScriptDir "..")
node (Join-Path $ScriptDir "update.mjs")
