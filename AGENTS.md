# Guia para agentes de IA — MCP TFS 2018

Checklist ejecutable para instalar, migrar o reparar este MCP sin intervencion humana innecesaria. Documentacion ampliada: [`README.md`](README.md).

## Reglas criticas

1. **Entry point MCP:** siempre `scripts/launcher.mjs` (ruta absoluta en `args`). **Nunca** `dist/index.js` directo — sin launcher no hay auto-update ni carga consistente de `.env`.
2. **Dependencias desde release zip:** `npm ci` (respeta lockfile). `npm install` solo en clones de desarrollo.
3. **stdout reservado:** el protocolo MCP usa stdout; logs van a stderr. No agregar `console.log` en el servidor.
4. **No commitear** `.env` ni PATs en configs versionadas.
5. **Reiniciar cliente** (Cursor / Claude Desktop) despues de cambiar `mcp.json` o aplicar un update en disco.

## Instalacion nueva (desde zip)

Repositorio: `https://github.com/aostapow/MCP-TFS2018`

| # | Accion | Comando / detalle |
|---|--------|-------------------|
| 1 | Descargar ultimo release | `MCP-TFS2018-vX.Y.Z.zip` desde [releases/latest](https://github.com/aostapow/MCP-TFS2018/releases/latest) |
| 2 | Extraer | Fuera de OneDrive/Dropbox. Ej: `C:\Users\<user>\AppData\Local\mcp-tfs2018\` |
| 3 | Instalar deps | `cd <install-dir>` → `npm ci` |
| 4 | Configurar TFS | Copiar `.env.example` → `.env` y completar vars requeridas (ver abajo), **o** `npm run setup` si hay usuario interactivo |
| 5 | Probar arranque | `npm start` — debe mostrar `Initializing MCP TFS 2018 server` en stderr y quedar esperando stdin |
| 6 | Registrar MCP | Editar `%USERPROFILE%\.cursor\mcp.json` o `%APPDATA%\Claude\claude_desktop_config.json` |
| 7 | Verificar | Tras reiniciar cliente: invocar tool `tfs_ping` o `tfs_get_server_info` |

### Variables minimas en `.env`

```
TFS_BASE_URL=http://<host>:8080/tfs
TFS_COLLECTION=DefaultCollection
TFS_PROJECT=<nombre-proyecto>
TFS_AUTH_TYPE=pat
TFS_PAT=<token>
```

Opcional en redes internas con cert autofirmado: `TFS_TLS_REJECT_UNAUTHORIZED=false`

### Snippet MCP (Cursor / Claude)

Ajustar rutas y credenciales. Plantilla: `claude_desktop_config.example.json`

```json
{
  "mcpServers": {
    "tfs2018": {
      "command": "node",
      "args": ["C:\\Users\\<user>\\AppData\\Local\\mcp-tfs2018\\scripts\\launcher.mjs"],
      "env": {
        "TFS_BASE_URL": "http://<host>:8080/tfs",
        "TFS_COLLECTION": "DefaultCollection",
        "TFS_PROJECT": "<proyecto>",
        "TFS_AUTH_TYPE": "pat",
        "TFS_PAT": "<token>"
      }
    }
  }
}
```

**Config vs `.env`:** el launcher lee `.env` de la carpeta de instalacion. Variables en el bloque `env` del JSON se fusionan al proceso Node y tienen prioridad. Para agentes: escribir `.env` es suficiente si no queres duplicar secretos en `mcp.json`.

## Migracion (instalacion existente pre-v1.3.0)

| # | Accion |
|---|--------|
| 1 | En `mcp.json`, cambiar `args` de `...\dist\index.js` a `...\scripts\launcher.mjs` |
| 2 | Confirmar `MCP_TFS_AUTO_UPDATE=true` en `.env` (es el default) |
| 3 | Reiniciar Cursor / Claude Desktop |
| 4 | `tfs_get_server_info` debe mostrar `launcherEntryPoint`, `autoUpdateEnabled: true` |

## Actualizacion

| Modo | Cuando | Como |
|------|--------|------|
| Automatica | Default con launcher | Al iniciar MCP: descarga zip, merge, `npm ci`, arranca |
| Manual | Red restringida o preferencia usuario | `npm run update` o `scripts\update.ps1`, luego reiniciar cliente |
| Desactivada | Maquina offline | `MCP_TFS_AUTO_UPDATE=false` en `.env` |

Cache de update: `%LOCALAPPDATA%\mcp-tfs2018\`

## Verificacion de exito

- `npm start` → stderr con `MCP TFS 2018 server running - waiting for requests`
- Tool `tfs_ping` → respuesta con URL TFS y latencia
- Tool `tfs_get_server_info` → `version`, `autoUpdateEnabled`, `lastAppliedVersion`, `zipAssetUrl`

## Errores frecuentes

| Sintoma | Causa probable | Fix |
|---------|----------------|-----|
| `Unexpected non-whitespace character after JSON` | Salida en stdout | No usar `dist/index.js` con logs en stdout; usar launcher |
| `401 Unauthorized` | PAT invalido o sin scope | Regenerar PAT en TFS |
| `ECONNREFUSED` / `ENOTFOUND` | Host TFS incorrecto | FQDN o IP en `TFS_BASE_URL` |
| Certificado TLS | CA interna | `TFS_TLS_REJECT_UNAUTHORIZED=false` |
| Config se revierte | Cliente MCP abierto | Cerrar app, editar, reabrir |
| Update no aplica | Sin launcher o auto-update off | `scripts/launcher.mjs` + `MCP_TFS_AUTO_UPDATE=true` |

## Requisitos

- Node.js **20+** (LTS 24 recomendado)
- Acceso de red al servidor TFS y (para auto-update) a `api.github.com`
- Windows es el entorno documentado; el servidor Node es multiplataforma

## Archivos de referencia

| Archivo | Uso |
|---------|-----|
| `README.md` | Documentacion completa |
| `.env.example` | Todas las variables con comentarios |
| `claude_desktop_config.example.json` | Snippet MCP listo para mergear |
| `CHANGELOG.md` | Cambios por version |
| `package.json` → `version` | Version instalada actual |
