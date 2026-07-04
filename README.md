# MCP TFS 2018

Servidor **Model Context Protocol** para **Microsoft Team Foundation Server 2018**, que expone work items, test cases, builds y source control (TFVC / Git) como tools que Claude Desktop puede invocar.

## Contenido del paquete

```
mcp-tfs2018/
├── src/                          Codigo fuente TypeScript (auditable y modificable)
├── dist/                         Codigo compilado a JavaScript (lo que ejecuta node)
├── package.json
├── package-lock.json
├── tsconfig.json
├── .env.example                  Plantilla de configuracion - copiala a .env
├── claude_desktop_config.example.json   Snippet listo para mergear en Claude Desktop
└── README.md
```

> El bundle no incluye `node_modules` (~141 MB). Se instala con `npm install` (ver mas abajo).

## Requisitos

- Node.js 20 o superior.
- Acceso de red al servidor TFS.
- Credenciales: PAT (recomendado), NTLM o Basic.

## Instalacion (Windows, paso a paso)

1. **Extraer el zip** donde quieras instalar. Recomendado: fuera de carpetas sincronizadas con OneDrive/Dropbox/Google Drive (las dependencias rompen con sync). Por ejemplo:

   ```
   C:\Users\<tu-usuario>\AppData\Local\mcp-tfs2018\
   ```

2. **Configurar `.env`:**

   ```powershell
   cd "C:\Users\<tu-usuario>\AppData\Local\mcp-tfs2018"
   copy .env.example .env
   notepad .env
   ```

   Completa al menos:
   - `TFS_BASE_URL` — ej. `http://tfs2018:8080/tfs`
   - `TFS_COLLECTION` — ej. `Default`
   - `TFS_PROJECT` — proyecto por defecto
   - `TFS_AUTH_TYPE` — `pat` recomendado
   - `TFS_PAT` — generalo en TFS desde la web

3. **Instalar dependencias:**

   ```powershell
   npm install
   ```

   (Tarda 30-60 segundos. Se descargan ~520 paquetes.)

4. **(Opcional) Recompilar el codigo TypeScript a JavaScript:**

   El bundle ya viene con `dist/` compilado, asi que este paso es opcional. Si modificas algo en `src/`:

   ```powershell
   npm run build
   ```

5. **Probar arranque manual:**

   ```powershell
   npm start
   ```

   (Equivale a `node scripts/launcher.mjs`, que aplica auto-update y arranca el servidor.)

   Tiene que mostrar (en stderr):

   ```
   [info] Initializing MCP TFS 2018 server
   [info] MCP server initialized - all tools registered
   [info] Starting MCP server on stdio transport
   [info] MCP TFS 2018 server running - waiting for requests
   ```

   Queda esperando JSON-RPC por stdin. Cerralo con `Ctrl+C`.

6. **Registrar en Claude Desktop / Cursor:**

   Edita `%APPDATA%\Claude\claude_desktop_config.json` o `%USERPROFILE%\.cursor\mcp.json` y agrega (o mergea) el bloque `mcpServers` de `claude_desktop_config.example.json`, **ajustando la ruta absoluta** a `scripts\launcher.mjs` y completando el bloque `env`.

   El launcher aplica actualizaciones zip automaticamente (si `MCP_TFS_AUTO_UPDATE=true`) y luego arranca el servidor MCP.

   **Importante:** cerrá Claude Desktop completamente antes de editar (Quit desde la bandeja). Si la app esta corriendo, sobreescribe el archivo al cerrarlo.

   Despues de guardar, reabrir Claude Desktop. En el chat principal, pedile: *"Hace `tfs_ping`"*. Si responde con la info del servidor, esta funcionando.

## Variables de entorno

| Variable | Default | Descripcion |
|---|---|---|
| `TFS_BASE_URL` | _(requerido)_ | URL base del servidor TFS sin barra al final |
| `TFS_COLLECTION` | `DefaultCollection` | Nombre de la collection |
| `TFS_PROJECT` | _(requerido)_ | Proyecto TFS por defecto |
| `TFS_AUTH_TYPE` | `ntlm` | `ntlm`, `basic`, `pat` o `kerberos` |
| `TFS_PAT` | — | Personal Access Token (si `TFS_AUTH_TYPE=pat`) |
| `TFS_USERNAME` | — | Usuario (si NTLM o Basic). Para NTLM puede ser `DOMINIO\usuario` |
| `TFS_PASSWORD` | — | Password (si NTLM o Basic) |
| `TFS_DOMAIN` | — | Dominio Windows (opcional si ya esta en `TFS_USERNAME`) |
| `TFS_API_VERSION` | `4.1` | Version de la REST API (TFS 2018 soporta 1.0 a 4.1) |
| `TFS_TIMEOUT_MS` | `30000` | Timeout de cada request HTTP |
| `TFS_MAX_PAGE_SIZE` | `200` | Maximo items por pagina |
| `TFS_TLS_REJECT_UNAUTHORIZED` | `true` | Poner `false` para aceptar certificados autofirmados |
| `TFS_PROXY_URL` | — | Proxy HTTP/HTTPS corporativo |
| `MCP_TRANSPORT` | `stdio` | `stdio` (Claude Desktop) o `http` |
| `MCP_PORT` | `3000` | Puerto si `MCP_TRANSPORT=http` |
| `MCP_TFS_UPDATE_CHECK` | `true` | Chequear GitHub Releases al arrancar y avisar si hay version nueva |
| `MCP_TFS_AUTO_UPDATE` | `true` | Descargar y aplicar el zip del release antes de arrancar (requiere `scripts/launcher.mjs`) |
| `MCP_TFS_UPDATE_URL` | — | URL alternativa para el chequeo de releases (mirror interno) |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` o `debug` |
| `LOG_FORMAT` | `pretty` | `pretty` o `json`. Los logs salen por **stderr** (stdout queda libre para JSON-RPC) |

## Tools disponibles (306)

**Utilidades:** `tfs_ping`, `tfs_get_server_info`, `tfs_list_projects`, `tfs_get_project`, `tfs_list_teams`, `tfs_get_team_members`, `tfs_list_iterations`, `tfs_list_area_paths`, `tfs_search_identities`.

**Work Items:** `tfs_get_work_item`, `tfs_get_work_items`, `tfs_query_work_items`, `tfs_create_work_item`, `tfs_update_work_item`, `tfs_add_work_item_comment`, `tfs_add_work_item_link`, `tfs_remove_work_item_link`, `tfs_get_work_item_history`, `tfs_get_work_item_updates`, `tfs_get_work_item_revisions`, `tfs_get_work_item_revision`, `tfs_delete_work_item`, `tfs_list_deleted_work_items`, `tfs_get_deleted_work_item`, `tfs_restore_work_item`, `tfs_destroy_deleted_work_item`, `tfs_upload_work_item_attachment`, `tfs_get_work_item_attachment`, `tfs_add_work_item_attachment`, `tfs_remove_work_item_attachment`, `tfs_get_work_item_type`, `tfs_list_work_item_types`, `tfs_list_work_item_fields`, `tfs_list_work_item_relation_types`, `tfs_list_work_item_categories`, `tfs_get_work_item_category`, `tfs_list_work_item_tags`, `tfs_get_work_item_tag`, `tfs_create_work_item_tag`, `tfs_delete_work_item_tag`, `tfs_get_saved_queries`, `tfs_run_saved_query`, `tfs_create_saved_query`, `tfs_update_saved_query`, `tfs_delete_saved_query`, `tfs_get_classification_node`, `tfs_create_classification_node`, `tfs_update_classification_node`, `tfs_delete_classification_node`.

**Test:** `tfs_list_test_plans`, `tfs_create_test_plan`, `tfs_update_test_plan`, `tfs_get_test_plan`, `tfs_create_test_suite`, `tfs_get_test_suite`, `tfs_update_test_suite`, `tfs_delete_test_suite`, `tfs_create_requirement_test_suite`, `tfs_create_query_test_suite`, `tfs_list_test_suites`, `tfs_create_test_case`, `tfs_list_test_cases`, `tfs_add_test_case_to_suite`, `tfs_remove_test_case_from_suite`, `tfs_get_test_points`, `tfs_get_test_point`, `tfs_update_test_point`, `tfs_list_test_runs`, `tfs_get_test_run`, `tfs_delete_test_run`, `tfs_get_test_run_results`, `tfs_get_test_result`, `tfs_get_test_result_history`, `tfs_get_test_run_statistics`, `tfs_get_test_configurations`, `tfs_get_test_configuration`, `tfs_create_test_configuration`, `tfs_update_test_configuration`, `tfs_delete_test_configuration`, `tfs_create_test_run`, `tfs_update_test_run`, `tfs_update_test_results`, `tfs_add_test_run_attachment`, `tfs_list_test_run_attachments`, `tfs_delete_test_run_attachment`, `tfs_add_test_result_attachment`, `tfs_list_test_result_attachments`, `tfs_delete_test_result_attachment`.

**Builds:** `tfs_list_build_definitions`, `tfs_get_build_definition`, `tfs_get_build_definition_revisions`, `tfs_create_build_definition`, `tfs_update_build_definition`, `tfs_delete_build_definition`, `tfs_list_builds`, `tfs_get_build`, `tfs_get_build_changes`, `tfs_queue_build`, `tfs_cancel_build`, `tfs_get_build_logs`, `tfs_get_build_log_text`, `tfs_get_build_timeline`, `tfs_get_build_artifacts`, `tfs_download_build_artifact`, `tfs_get_build_work_items`, `tfs_get_build_tags`, `tfs_add_build_tag`, `tfs_delete_build_tag`, `tfs_list_all_build_tags`, `tfs_list_build_queues`, `tfs_list_agent_pools`, `tfs_get_agent_pool`, `tfs_list_agents`, `tfs_get_agent`, `tfs_list_agent_requests`, `tfs_get_agent_request`, `tfs_list_task_definitions`, `tfs_list_variable_groups`, `tfs_get_variable_group`, `tfs_create_variable_group`, `tfs_update_variable_group`, `tfs_delete_variable_group`.

**Release:** `tfs_list_release_definitions`, `tfs_get_release_definition`, `tfs_create_release_definition`, `tfs_update_release_definition`, `tfs_delete_release_definition`, `tfs_list_releases`, `tfs_get_release`, `tfs_create_release`, `tfs_update_release`, `tfs_abandon_release`, `tfs_get_release_environment`, `tfs_update_release_environment`, `tfs_list_release_deployments`, `tfs_get_release_deployment`, `tfs_list_release_approvals`, `tfs_get_release_approval`, `tfs_update_release_approval`, `tfs_approve_release`, `tfs_reject_release`, `tfs_get_release_logs`.

**TFVC:** `tfs_get_item`, `tfs_list_items`, `tfs_get_file_content`, `tfs_get_tfvc_file_content_binary`, `tfs_get_changeset`, `tfs_list_changesets`, `tfs_get_tfvc_changeset_changes`, `tfs_get_tfvc_changeset_work_items`, `tfs_get_tfvc_changeset_policy_details`, `tfs_get_label`, `tfs_list_labels`, `tfs_create_tfvc_label`, `tfs_update_tfvc_label`, `tfs_delete_tfvc_label`, `tfs_list_shelvesets`, `tfs_get_shelveset`, `tfs_delete_shelveset`, `tfs_list_branches`, `tfs_get_tfvc_branch`, `tfs_get_tfvc_item_batch`, `tfs_get_tfvc_items_batch`.

**Git:** `tfs_list_git_repos`, `tfs_create_git_repo`, `tfs_update_git_repo`, `tfs_delete_git_repo`, `tfs_list_git_refs`, `tfs_get_git_ref`, `tfs_update_git_refs`, `tfs_list_git_branches`, `tfs_create_git_branch`, `tfs_delete_git_branch`, `tfs_list_git_items`, `tfs_get_git_file_content`, `tfs_get_git_blob`, `tfs_get_git_tree`, `tfs_download_git_zip`, `tfs_list_git_commits`, `tfs_get_git_commit`, `tfs_get_git_commit_changes`, `tfs_get_git_diffs`, `tfs_list_git_pushes`, `tfs_get_git_push`, `tfs_create_git_push`, `tfs_list_git_pull_requests`, `tfs_get_git_pull_request`, `tfs_create_pull_request`, `tfs_update_pull_request`, `tfs_complete_pull_request`, `tfs_abandon_pull_request`, `tfs_list_pull_request_threads`, `tfs_get_pull_request_thread`, `tfs_create_pull_request_thread`, `tfs_update_pull_request_thread`, `tfs_add_pull_request_comment`, `tfs_update_pull_request_comment`, `tfs_delete_pull_request_comment`, `tfs_add_pull_request_reviewer`, `tfs_remove_pull_request_reviewer`, `tfs_vote_pull_request`, `tfs_get_pull_request_work_items`, `tfs_add_pull_request_work_item`.

**Work/Boards:** `tfs_list_boards`, `tfs_get_board`, `tfs_get_board_columns`, `tfs_update_board_columns`, `tfs_get_board_rows`, `tfs_update_board_rows`, `tfs_get_board_card_fields`, `tfs_update_board_card_fields`, `tfs_get_board_card_rules`, `tfs_update_board_card_rules`, `tfs_get_board_charts`, `tfs_get_board_chart`, `tfs_update_board_chart`, `tfs_list_backlogs`, `tfs_get_backlog`, `tfs_get_backlog_work_items`, `tfs_get_process_configuration`, `tfs_get_team_settings`, `tfs_update_team_settings`, `tfs_get_team_field_values`, `tfs_update_team_field_values`, `tfs_get_team_iterations`, `tfs_add_team_iteration`, `tfs_remove_team_iteration`, `tfs_get_team_capacity`, `tfs_get_team_member_capacity`, `tfs_update_team_member_capacity`, `tfs_get_team_days_off`, `tfs_update_team_days_off`.

**Admin/Identity:** `tfs_create_project`, `tfs_update_project`, `tfs_delete_project`, `tfs_get_project_properties`, `tfs_update_project_properties`, `tfs_create_team`, `tfs_update_team`, `tfs_delete_team`, `tfs_add_team_member`, `tfs_remove_team_member`, `tfs_get_identity`, `tfs_list_identities`, `tfs_read_identity_memberships`, `tfs_get_identity_descriptors`, `tfs_list_groups`.

**Policy:** `tfs_list_policy_types`, `tfs_get_policy_type`, `tfs_list_policy_configurations`, `tfs_get_policy_configuration`, `tfs_create_policy_configuration`, `tfs_update_policy_configuration`, `tfs_delete_policy_configuration`, `tfs_evaluate_policy`.

**Integraciones:** `tfs_list_service_endpoint_types`, `tfs_list_service_endpoints`, `tfs_get_service_endpoint`, `tfs_create_service_endpoint`, `tfs_update_service_endpoint`, `tfs_delete_service_endpoint`, `tfs_execute_service_endpoint_request`, `tfs_list_service_hook_publishers`, `tfs_get_service_hook_publisher`, `tfs_list_service_hook_event_types`, `tfs_list_service_hook_consumers`, `tfs_get_service_hook_consumer`, `tfs_list_service_hook_actions`, `tfs_list_service_hook_subscriptions`, `tfs_get_service_hook_subscription`, `tfs_create_service_hook_subscription`, `tfs_update_service_hook_subscription`, `tfs_delete_service_hook_subscription`, `tfs_test_service_hook_subscription`.

**Security:** `tfs_list_security_namespaces`, `tfs_get_security_namespace`, `tfs_query_access_control_lists`, `tfs_set_access_control_lists`, `tfs_remove_access_control_lists`, `tfs_set_access_control_entries`, `tfs_remove_access_control_entries`, `tfs_evaluate_permissions`, `tfs_set_inherit_flag`.

**Dashboards/Packaging:** `tfs_list_dashboards`, `tfs_get_dashboard`, `tfs_create_dashboard`, `tfs_update_dashboard`, `tfs_delete_dashboard`, `tfs_list_widgets`, `tfs_get_widget`, `tfs_add_widget`, `tfs_update_widget`, `tfs_delete_widget`, `tfs_list_feeds`, `tfs_get_feed`, `tfs_create_feed`, `tfs_update_feed`, `tfs_delete_feed`, `tfs_list_packages`, `tfs_get_package`, `tfs_list_package_versions`, `tfs_get_package_version`, `tfs_update_package_version`, `tfs_delete_package_version`, `tfs_list_feed_permissions`, `tfs_update_feed_permissions`.

**REST genérico:** `tfs_rest_request` permite invocar endpoints REST TFS 2018 que todavía no tienen una tool dedicada. Las operaciones de escritura (`POST`, `PATCH`, `PUT`, `DELETE`) requieren `confirmWrite=true` y `reason`; `DELETE` además requiere `confirmDelete=true`.

## Scripts npm

```powershell
npm run build       # Compila TypeScript a dist/ (usando esbuild)
npm run dev         # Corre directo con ts-node (sin compilar)
npm start           # launcher: auto-update zip + node dist/index.js
npm run update      # descarga zip del ultimo release + npm ci (manual)
npm run typecheck   # tsc --noEmit (solo chequeo de tipos)
npm test            # jest
npm run lint        # eslint
npm run clean       # borra dist/
```

> **Nota sobre build:** el build usa `esbuild` para evitar el alto consumo de memoria de `tsc` al emitir `dist/`. `npm run typecheck` usa hasta 12 GB de heap; puede tardar varios minutos en equipos con muchos tools.

## Actualizaciones

### Auto-update (recomendado)

Con `MCP_TFS_AUTO_UPDATE=true` (default) y el entry point `scripts/launcher.mjs`, cada vez que Cursor o Claude Desktop inicia el MCP:

1. Consulta GitHub Releases
2. Si hay una version mas nueva, descarga `MCP-TFS2018-vX.Y.Z.zip`
3. Extrae sobre la carpeta de instalacion (conserva tu `.env`)
4. Ejecuta `npm ci`
5. Arranca el servidor MCP

**Migracion (usuarios existentes):** cambia una sola vez el `args` en tu config MCP de `dist/index.js` a `scripts/launcher.mjs`.

**Reinicio de Cursor:** el disco queda actualizado al terminar el launcher, pero la sesion MCP activa sigue con el proceso anterior hasta reiniciar Cursor o el servidor MCP.

**Desactivar auto-update:** `MCP_TFS_AUTO_UPDATE=false` en `.env`.

### Aviso en logs

Si hay version nueva y el auto-update no pudo aplicarse (o esta desactivado), el servidor escribe un aviso en **stderr** una sola vez por version nueva.

**Ver version instalada:**
- Logs de arranque del MCP
- Tool `tfs_get_server_info` (version, auto-update, ultima version aplicada, update disponible)

### Update manual

```powershell
cd C:\ruta\a\mcp-tfs2018
npm run update
```

Tambien podes usar `scripts\update.ps1`. Reinicia Claude Desktop / Cursor despues de actualizar.

**Instalacion inicial via zip:** descarga desde [GitHub Releases](https://github.com/aostapow/MCP-TFS2018/releases/latest), extrae, configura `.env`, ejecuta `npm ci`, y registra `scripts/launcher.mjs` en tu cliente MCP.

**Desactivar solo el chequeo de releases:** `MCP_TFS_UPDATE_CHECK=false` en `.env`.

## Publicar una nueva version (maintainers)

1. Actualizar `CHANGELOG.md` y bump `version` en `package.json`
2. `git commit -m "chore: release v1.1.0"`
3. `git tag v1.1.0 && git push origin main --tags`
4. GitHub Actions publica el release con zip adjunto

Convencion SemVer:
- **PATCH** — bugfixes sin cambios en tools
- **MINOR** — tools nuevos o parametros opcionales
- **MAJOR** — breaking changes (rename de tools, cambios requeridos en `.env`)

## Troubleshooting

**`MCP tfs2018: Unexpected non-whitespace character after JSON ...`** — Hay texto saliendo por stdout que rompe el protocolo. El logger por defecto manda todo a stderr; si modificaste `src/utils/logger.ts` y lo rompiste, revertilo.

**`ECONNREFUSED` o `ENOTFOUND` en `tfs_ping`** — La maquina no resuelve el hostname del TFS. Usá FQDN o IP en `TFS_BASE_URL`.

**`401 Unauthorized`** — PAT mal copiado, expirado o sin scope suficiente. Regeneralo desde la web de TFS con scope amplio (Work Items / Build / Code / Test).

**`certificate has expired` / `self-signed`** — Pone `TFS_TLS_REJECT_UNAUTHORIZED=false` (solo en redes corporativas internas).

**El JSON de Claude Desktop se revierte al guardar** — La app esta corriendo. Cerrala con Quit desde la bandeja, verificá con Task Manager que no quede ningun proceso `Claude.exe`, y recien ahi editá el archivo.

## Licencia

MIT
