#!/usr/bin/env node
/**
 * MCP TFS 2018 - Interactive Setup Wizard
 *
 * Run with:  npm run setup
 *
 * Flujo:
 *   1. URL del servidor TFS
 *   2. Autenticacion (NTLM / Basic / PAT / Kerberos)
 *   3. Red (proxy, TLS)
 *   4. Test + descubrimiento de Collections
 *   5. Elegir Collection
 *   6. Descubrimiento y seleccion de Proyecto
 *   7. Logging
 *   -> Escribe .env y genera snippets para Claude Desktop / Cursor
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { NtlmClient } from 'axios-ntlm';
import type { TfsProjectCollection } from './types/tfs.js';

const ROOT = path.resolve(process.cwd());
const ENV_PATH = path.join(ROOT, '.env');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.js');

// ─── Colores ANSI ─────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  blue:   '\x1b[34m',
};

const bold  = (s: string) => c.bold + s + c.reset;
const dim   = (s: string) => c.dim + s + c.reset;
const green = (s: string) => c.green + s + c.reset;
const red   = (s: string) => c.red + s + c.reset;

function print(msg = ''): void { process.stdout.write(msg + '\n'); }
function ok(s: string):   void { print(green('[OK]  ') + s); }
function warn(s: string): void { print(c.yellow + '[!]   ' + c.reset + s); }
function fail(s: string): void { print(red('[ERR] ') + s); }
function info(s: string): void { print(c.cyan + '[>]   ' + c.reset + s); }

function separator(): void { print(dim('─'.repeat(56))); }

function stepHeader(n: number, total: number, label: string): void {
  print('');
  print(c.bold + c.blue + 'Paso ' + n + '/' + total + ': ' + label + c.reset);
  separator();
}

// ─── Readline helpers ─────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultValue = ''): Promise<string> {
  const hint = defaultValue ? dim(' [' + defaultValue + ']') : '';
  return new Promise((resolve) => {
    rl.question(bold('  ? ') + question + hint + ': ', (ans) => {
      resolve(ans.trim() !== '' ? ans.trim() : defaultValue);
    });
  });
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(bold('  ? ') + question + dim(' [oculto]') + ': ');
    let password = '';
    const isTTY = process.stdin.isTTY;
    if (isTTY) (process.stdin as NodeJS.ReadStream).setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (chunk: Buffer) => {
      const ch = chunk.toString();
      if (ch === '\n' || ch === '\r') {
        if (isTTY) (process.stdin as NodeJS.ReadStream).setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(password);
      } else if (ch === '') {
        process.exit(0);
      } else if (ch === '\b' || ch === '') {
        if (password.length > 0) { password = password.slice(0, -1); }
      } else {
        password += ch;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

async function choose(question: string, options: string[], defaultIdx = 0): Promise<number> {
  print(bold('  ? ') + question);
  options.forEach((opt, i) => {
    const marker = i === defaultIdx ? green(' > ') : '   ';
    print(marker + dim(String(i + 1) + ')') + ' ' + opt);
  });
  const ans = await ask('Ingresa el numero', String(defaultIdx + 1));
  const idx = parseInt(ans, 10) - 1;
  return (idx >= 0 && idx < options.length) ? idx : defaultIdx;
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'S/n' : 's/N';
  const ans = await ask(question + ' (' + hint + ')');
  if (ans === '') return defaultYes;
  return ans.toLowerCase().startsWith('s') || ans.toLowerCase().startsWith('y');
}

// ─── HTTP client factory ──────────────────────────────────────────────────────

interface AuthParams {
  type: string;
  username?: string;
  password?: string;
  domain?: string;
  pat?: string;
  spn?: string;
}

async function buildClient(
  auth: AuthParams,
  tlsReject: boolean,
  proxyUrl?: string,
) {
  const { Agent } = await import('https');
  const agentOpts = { rejectUnauthorized: tlsReject };
  const httpsAgent = new Agent(agentOpts);

  const defaults = {
    timeout: 12_000,
    httpsAgent,
    headers: { Accept: 'application/json' },
    params: { 'api-version': '4.1' },
  };

  let instance;

  if (auth.type === 'ntlm') {
    instance = NtlmClient(
      {
        username: auth.username!,
        password: auth.password!,
        domain:   auth.domain ?? '',
        workstation: '',
      },
      defaults,
    );
  } else {
    instance = axios.create(defaults);

    if (auth.type === 'pat') {
      const token = Buffer.from(':' + auth.pat!).toString('base64');
      instance.defaults.headers.common['Authorization'] = 'Basic ' + token;

    } else if (auth.type === 'basic') {
      const token = Buffer.from(auth.username! + ':' + auth.password!).toString('base64');
      instance.defaults.headers.common['Authorization'] = 'Basic ' + token;

    } else if (auth.type === 'kerberos') {
      let kerberos: { initializeClient: (spn: string) => Promise<{ step: (s: string) => Promise<string> }> };
      try {
        kerberos = await import('kerberos') as typeof kerberos;
      } catch {
        throw new Error(
          'El paquete "kerberos" no esta instalado.\n' +
          'Instalalo con: npm install kerberos\n' +
          'En Linux/macOS tambien necesitas: sudo apt install libkrb5-dev (o equivalente)',
        );
      }
      // Derive SPN from auth.spn if set, otherwise from the URL passed in defaults
      const urlForSpn = (defaults as { baseURL?: string }).baseURL ?? '';
      let hostname = '';
      try { hostname = new URL(urlForSpn).hostname; } catch { /* use empty */ }
      const spn = auth.spn ?? ('HTTP/' + hostname);
      if (!hostname && !auth.spn) {
        throw new Error('No se puede derivar el SPN de Kerberos. Proporciona TFS_KERBEROS_SPN explicitamente.');
      }
      const client = await kerberos.initializeClient(spn);
      const token = await client.step('');
      instance.defaults.headers.common['Authorization'] = 'Negotiate ' + token;
    }
  }

  if (proxyUrl) {
    const u = new URL(proxyUrl);
    instance.defaults.proxy = {
      host: u.hostname,
      port: parseInt(u.port, 10) || 80,
      protocol: u.protocol,
    };
  }

  return instance;
}

// ─── TFS discovery ────────────────────────────────────────────────────────────

// Use centralized types
type TfsCollection = TfsProjectCollection;
interface TfsProject { id: string; name: string; state: string; }

async function discoverCollections(
  baseUrl: string,
  auth: AuthParams,
  tlsReject: boolean,
  proxyUrl?: string,
): Promise<{ ok: boolean; collections?: TfsCollection[]; error?: string }> {
  try {
    const client = await buildClient(auth, tlsReject, proxyUrl);
    const url = baseUrl.replace(/\/+$/, '') + '/_apis/projectcollections';
    const res = await client.get<{ value: TfsCollection[] }>(url);
    const collections = (res.data?.value ?? []).filter((c) => c.state === 'Started');
    return { ok: true, collections };
  } catch (e) {
    return { ok: false, error: mapHttpError(e) };
  }
}

async function discoverProjects(
  baseUrl: string,
  collection: string,
  auth: AuthParams,
  tlsReject: boolean,
  proxyUrl?: string,
): Promise<{ ok: boolean; projects?: TfsProject[]; error?: string }> {
  try {
    const client = await buildClient(auth, tlsReject, proxyUrl);
    const url = baseUrl.replace(/\/+$/, '') + '/' + collection + '/_apis/projects?$top=200';
    const res = await client.get<{ value: TfsProject[] }>(url);
    const projects = (res.data?.value ?? []).filter((p) => p.state === 'wellFormed');
    return { ok: true, projects };
  } catch (e) {
    return { ok: false, error: mapHttpError(e) };
  }
}

function mapHttpError(e: unknown): string {
  const ax = e as { response?: { status: number }; code?: string; message?: string };
  if (ax.response?.status === 401) return 'Autenticacion rechazada (401). Verificar credenciales.';
  if (ax.response?.status === 403) return 'Sin permisos (403). El usuario no tiene acceso.';
  if (ax.code === 'ECONNREFUSED') return 'Conexion rechazada. Verificar URL y que TFS este corriendo.';
  if (ax.code === 'ENOTFOUND')    return 'Host no encontrado. Verificar la URL del servidor.';
  if (ax.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || ax.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return 'Certificado TLS no valido. Activa la opcion de ignorar certificados autofirmados.';
  }
  if (ax.code === 'ETIMEDOUT') return 'Timeout. El servidor no respondio en 12 segundos.';
  return ax.message ?? 'Error desconocido';
}

// ─── .env writer ──────────────────────────────────────────────────────────────

interface EnvConfig {
  baseUrl: string;
  collection: string;
  project: string;
  authType: string;
  username?: string;
  password?: string;
  domain?: string;
  pat?: string;
  spn?: string;
  proxyUrl?: string;
  tlsRejectUnauthorized: boolean;
  logLevel: string;
  logFormat: string;
}

function writeEnvFile(cfg: EnvConfig): void {
  const lines: string[] = [
    '# MCP TFS 2018 - Configuracion generada por el wizard',
    '# Generado: ' + new Date().toISOString(),
    '',
    '# --- Conexion TFS ---',
    'TFS_BASE_URL=' + cfg.baseUrl,
    'TFS_COLLECTION=' + cfg.collection,
    'TFS_PROJECT=' + cfg.project,
    'TFS_API_VERSION=4.1',
    'TFS_TIMEOUT_MS=30000',
    'TFS_MAX_PAGE_SIZE=200',
    '',
    '# --- Autenticacion ---',
    'TFS_AUTH_TYPE=' + cfg.authType,
  ];

  if (cfg.authType === 'ntlm' || cfg.authType === 'basic') {
    lines.push('TFS_USERNAME=' + (cfg.username ?? ''));
    lines.push('TFS_PASSWORD=' + (cfg.password ?? ''));
    if (cfg.domain) lines.push('TFS_DOMAIN=' + cfg.domain);
  }
  if (cfg.authType === 'pat') {
    lines.push('TFS_PAT=' + (cfg.pat ?? ''));
  }
  if (cfg.authType === 'kerberos' && cfg.spn) {
    lines.push('TFS_KERBEROS_SPN=' + cfg.spn);
  }

  lines.push('', '# --- Red ---');
  lines.push('TFS_TLS_REJECT_UNAUTHORIZED=' + String(cfg.tlsRejectUnauthorized));
  if (cfg.proxyUrl) lines.push('TFS_PROXY_URL=' + cfg.proxyUrl);

  lines.push('', '# --- Servidor MCP ---');
  lines.push('MCP_TRANSPORT=stdio');
  lines.push('MCP_PORT=3000');

  lines.push('', '# --- Logging ---');
  lines.push('LOG_LEVEL=' + cfg.logLevel);
  lines.push('LOG_FORMAT=' + cfg.logFormat);

  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

// ─── Client snippet generator ─────────────────────────────────────────────────

function printClientSnippets(cfg: EnvConfig): void {
  const distPath = DIST_INDEX.replace(/\\/g, '/');

  const env: Record<string, string> = {
    TFS_BASE_URL:    cfg.baseUrl,
    TFS_COLLECTION:  cfg.collection,
    TFS_PROJECT:     cfg.project,
    TFS_AUTH_TYPE:   cfg.authType,
    TFS_API_VERSION: '4.1',
  };
  if (cfg.authType === 'ntlm' || cfg.authType === 'basic') {
    env.TFS_USERNAME = cfg.username ?? '';
    env.TFS_PASSWORD = '*** COMPLETAR ***';
    if (cfg.domain) env.TFS_DOMAIN = cfg.domain;
  }
  if (cfg.authType === 'pat')      env.TFS_PAT = '*** COMPLETAR ***';
  if (cfg.authType === 'kerberos' && cfg.spn) env.TFS_KERBEROS_SPN = cfg.spn;
  if (!cfg.tlsRejectUnauthorized)  env.TFS_TLS_REJECT_UNAUTHORIZED = 'false';
  if (cfg.proxyUrl)                env.TFS_PROXY_URL = cfg.proxyUrl;
  env.LOG_LEVEL = cfg.logLevel;

  const envJson = JSON.stringify(env, null, 6)
    .split('\n')
    .map((l, i) => (i === 0 ? l : '      ' + l))
    .join('\n');

  const snippet = `{
  "mcpServers": {
    "tfs2018": {
      "command": "node",
      "args": ["${distPath}"],
      "env": ${envJson}
    }
  }
}`;

  print('');
  print(bold(c.cyan + 'Snippet para Claude Desktop' + c.reset));
  print(dim('  Archivo: %APPDATA%\\Claude\\claude_desktop_config.json'));
  separator();
  print(snippet);

  print('');
  print(bold(c.cyan + 'Snippet para Cursor' + c.reset));
  print(dim('  Archivo: %USERPROFILE%\\.cursor\\mcp.json'));
  separator();
  print(snippet);

  if (cfg.authType !== 'kerberos') {
    print('');
    warn('La password/token aparece como "*** COMPLETAR ***". Reemplazala en el snippet antes de usarlo.');
  }
}

// ─── Wizard principal ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const TOTAL = 7;

  // Banner
  print('');
  print(c.bold + c.cyan + '  ╔══════════════════════════════════════════════════╗');
  print('  ║     MCP TFS 2018 - Wizard de Configuracion      ║');
  print('  ╚══════════════════════════════════════════════════╝' + c.reset);
  print(dim('  Configura el servidor MCP para conectarse a TFS 2018.'));
  print(dim('  Presiona Enter para aceptar el valor por defecto.\n'));

  // Cargar defaults de .env existente
  const d: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    warn('Ya existe un .env. Los valores actuales se usan como defaults.');
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) d[m[1]] = m[2];
    }
  }

  // ── PASO 1: URL del servidor ──────────────────────────────────────────────
  stepHeader(1, TOTAL, 'URL del servidor TFS');
  print(dim('  Ejemplos:'));
  print(dim('    http://tfs.empresa.com:8080/tfs'));
  print(dim('    https://tfs.empresa.com/tfs'));

  let baseUrl = '';
  while (!baseUrl) {
    const input = await ask('URL base del servidor TFS', d.TFS_BASE_URL ?? '');
    if (!input) { fail('La URL es obligatoria.'); continue; }
    try { new URL(input); baseUrl = input.replace(/\/+$/, ''); }
    catch { fail('URL invalida. Debe empezar con http:// o https://'); }
  }

  // ── PASO 2: Autenticacion ─────────────────────────────────────────────────
  stepHeader(2, TOTAL, 'Autenticacion');
  print(dim('  NTLM     - Usuario de dominio Windows. El mas comun en redes corporativas.'));
  print(dim('  Basic    - Usuario/password en texto. Requiere HTTPS.'));
  print(dim('  PAT      - Personal Access Token. Mas seguro, expira, se puede revocar.'));
  print(dim('  Kerberos - SSO transparente. Sin password si ya estas en el dominio.'));
  print('');

  const authTypes = ['ntlm', 'basic', 'pat', 'kerberos'];
  const defaultAuthIdx = Math.max(0, authTypes.indexOf(d.TFS_AUTH_TYPE ?? 'ntlm'));
  const authIdx = await choose('Tipo de autenticacion', authTypes, defaultAuthIdx);
  const authType = authTypes[authIdx];

  let username: string | undefined;
  let password: string | undefined;
  let domain:   string | undefined;
  let pat:      string | undefined;
  let spn:      string | undefined;

  if (authType === 'ntlm' || authType === 'basic') {
    if (authType === 'basic' && !baseUrl.startsWith('https://')) {
      warn('Basic sin HTTPS envia la password en texto plano. Considera HTTPS o NTLM.');
    }
    username = await ask('Usuario', d.TFS_USERNAME ?? '');
    password = await askSecret('Password');
    if (authType === 'ntlm') {
      domain = await ask('Dominio Windows (opcional)', d.TFS_DOMAIN ?? '');
      if (domain === '') domain = undefined;
    }
  } else if (authType === 'pat') {
    print('');
    print(dim('  Genera un PAT en TFS: Mi perfil > Seguridad > Tokens de acceso personal'));
    print(dim('  Permisos minimos necesarios: Work Items (R/W), Code (R), Build (R/Q)'));
    pat = await askSecret('Personal Access Token');
  } else if (authType === 'kerberos') {
    print('');
    info('Kerberos usa tu ticket de sesion actual. No se necesita password.');
    print(dim('  Linux/macOS: ejecuta "kinit usuario@DOMINIO" antes de iniciar el servidor.'));
    print(dim('  Windows:     basta con estar logueado en el dominio.'));
    const hostname = (() => { try { return new URL(baseUrl).hostname; } catch { return ''; } })();
    const defaultSpn = 'HTTP/' + hostname;
    const inputSpn = await ask('SPN del servidor (opcional)', d.TFS_KERBEROS_SPN ?? defaultSpn);
    spn = inputSpn === defaultSpn ? undefined : inputSpn;
  }

  // ── PASO 3: Red ──────────────────────────────────────────────────────────
  stepHeader(3, TOTAL, 'Configuracion de red');

  let proxyUrl: string | undefined;
  const useProxy = await confirm('El acceso a TFS pasa por un proxy corporativo?', !!(d.TFS_PROXY_URL));
  if (useProxy) {
    print(dim('  Ejemplo: http://proxy.empresa.com:8080'));
    const p = await ask('URL del proxy', d.TFS_PROXY_URL ?? '');
    if (p) proxyUrl = p;
  }

  let tlsRejectUnauthorized = true;
  if (baseUrl.startsWith('https://')) {
    const currentReject = d.TFS_TLS_REJECT_UNAUTHORIZED !== 'false';
    const skipVerify = await confirm(
      'TFS usa certificado autofirmado o CA interna (ignorar errores TLS)?',
      !currentReject,
    );
    tlsRejectUnauthorized = !skipVerify;
    if (!tlsRejectUnauthorized) {
      warn('Validacion de certificados TLS desactivada. Usar solo en redes de confianza.');
    }
  }

  const authParams: AuthParams = { type: authType, username, password, domain, pat, spn };

  // ── PASO 4: Descubrir Collections ─────────────────────────────────────────
  stepHeader(4, TOTAL, 'Collections disponibles');

  let collection: string;
  let collectionsOk = false;

  process.stdout.write(dim('  Conectando a ') + baseUrl + dim(' para listar collections... '));

  const colResult = await discoverCollections(baseUrl, authParams, tlsRejectUnauthorized, proxyUrl);

  if (colResult.ok && colResult.collections && colResult.collections.length > 0) {
    print(green('OK'));
    ok(String(colResult.collections.length) + ' collection(s) encontrada(s).');
    collectionsOk = true;

    const colNames = colResult.collections.map((c) => c.name);

    if (colNames.length === 1) {
      collection = colNames[0];
      info('Una sola collection disponible: ' + bold(collection));
    } else {
      print('');
      const defaultColIdx = Math.max(0, colNames.indexOf(d.TFS_COLLECTION ?? 'DefaultCollection'));
      const idx = await choose('Selecciona la collection', colNames, defaultColIdx);
      collection = colNames[idx];
    }
  } else {
    print(red('FALLO'));

    if (colResult.error) {
      fail(colResult.error);
    }

    // Si fallo por permisos puede ser que el usuario no tiene acceso a la lista de collections
    // pero si tenga acceso a una collection especifica
    if (colResult.error?.includes('401') || colResult.error?.includes('403')) {
      warn('Sin permiso para listar collections del servidor. Puedes ingresarla manualmente.');
      warn('Nota: Un admin puede otorgar permiso "View instance-level information" para listarlas.');
    }

    print('');
    print(dim('  Ingresa el nombre manualmente. Ejemplos:'));
    print(dim('    DefaultCollection'));
    print(dim('    Proyectos'));
    print(dim('    Desarrollo'));
    collection = await ask('Nombre de la collection', d.TFS_COLLECTION ?? 'DefaultCollection');

    // Reintentar la conexion con la collection ingresada manualmente
    process.stdout.write(dim('  Verificando acceso a collection "' + collection + '"... '));
    const verifyResult = await discoverProjects(baseUrl, collection, authParams, tlsRejectUnauthorized, proxyUrl);
    if (verifyResult.ok) {
      print(green('OK'));
      collectionsOk = true;
    } else {
      print(red('FALLO'));
      fail(verifyResult.error ?? 'No se pudo verificar la collection');
      const cont = await confirm('Continuar de todas formas?', false);
      if (!cont) {
        print('\nConfiguracion cancelada.');
        rl.close(); process.exit(1);
      }
    }
  }

  // ── PASO 5: Descubrir y elegir Proyecto ───────────────────────────────────
  stepHeader(5, TOTAL, 'Proyectos disponibles');

  let project: string;

  process.stdout.write(dim('  Listando proyectos en collection "' + collection + '"... '));
  const projResult = await discoverProjects(baseUrl, collection, authParams, tlsRejectUnauthorized, proxyUrl);

  if (projResult.ok && projResult.projects && projResult.projects.length > 0) {
    print(green('OK'));
    ok(String(projResult.projects.length) + ' proyecto(s) encontrado(s).');

    const projNames = projResult.projects.map((p) => p.name);

    if (projNames.length === 1) {
      project = projNames[0];
      info('Un solo proyecto disponible: ' + bold(project));
    } else {
      print('');
      const defaultProjIdx = Math.max(0, projNames.indexOf(d.TFS_PROJECT ?? ''));
      const idx = await choose('Selecciona el proyecto', projNames, defaultProjIdx);
      project = projNames[idx];
    }
  } else {
    if (!projResult.ok) {
      print(red('FALLO'));
      fail(projResult.error ?? 'No se pudo listar proyectos');
    } else {
      print(green('OK'));
      warn('La collection no tiene proyectos visibles para este usuario.');
    }
    print('');
    print(dim('  Ingresa el nombre del proyecto manualmente.'));
    project = await ask('Nombre del proyecto TFS', d.TFS_PROJECT ?? '');
  }

  // ── PASO 6: Logging ───────────────────────────────────────────────────────
  stepHeader(6, TOTAL, 'Configuracion de logging');

  const logLevels = ['info', 'debug', 'warn', 'error'];
  const defaultLogIdx = Math.max(0, logLevels.indexOf(d.LOG_LEVEL ?? 'info'));
  const logLevel = logLevels[await choose('Nivel de log', logLevels, defaultLogIdx)];

  const logFormats = ['pretty  (legible, para desarrollo)', 'json    (para produccion/logs estructurados)'];
  const defaultFmtIdx = (d.LOG_FORMAT ?? 'pretty') === 'json' ? 1 : 0;
  const logFormatRaw = logFormats[await choose('Formato de log', logFormats, defaultFmtIdx)];
  const logFormat = logFormatRaw.startsWith('json') ? 'json' : 'pretty';

  // ── PASO 7: Resumen y confirmacion ────────────────────────────────────────
  stepHeader(7, TOTAL, 'Resumen de configuracion');

  print('');
  print('  ' + bold('Servidor:')    + '  ' + baseUrl);
  print('  ' + bold('Collection:')  + '  ' + collection);
  print('  ' + bold('Proyecto:')    + '  ' + project);
  print('  ' + bold('Auth:')        + '      ' + authType.toUpperCase()
    + (username ? ' (' + username + ')' : ''));
  if (proxyUrl)             print('  ' + bold('Proxy:')       + '     ' + proxyUrl);
  if (!tlsRejectUnauthorized) print('  ' + bold('TLS:')        + '       Validacion desactivada');
  print('  ' + bold('Log:')         + '       ' + logLevel + ' / ' + logFormat);
  print('');

  const save = await confirm('Guardar esta configuracion?', true);
  if (!save) {
    print('\nConfiguracion cancelada.\n');
    rl.close(); process.exit(0);
  }

  // ── Guardar .env ──────────────────────────────────────────────────────────

  if (fs.existsSync(ENV_PATH)) {
    const backup = ENV_PATH + '.backup.' + Date.now();
    fs.copyFileSync(ENV_PATH, backup);
    print(dim('  Backup del .env anterior: ' + path.basename(backup)));
  }

  const cfg: EnvConfig = {
    baseUrl, collection, project,
    authType, username, password, domain, pat, spn,
    proxyUrl, tlsRejectUnauthorized,
    logLevel, logFormat,
  };

  writeEnvFile(cfg);
  ok('.env guardado en: ' + ENV_PATH);

  // ── Snippets para clientes MCP ────────────────────────────────────────────
  print('');
  print(bold('Snippets listos para copiar en tu cliente MCP:'));
  printClientSnippets(cfg);

  // ── Instrucciones finales ─────────────────────────────────────────────────
  print('');
  separator();
  print(bold(c.green + 'Configuracion completada.' + c.reset));

  if (!fs.existsSync(DIST_INDEX)) {
    print('');
    warn('El proyecto aun no esta compilado. Ejecuta primero:');
    print(bold('  npm run build'));
  }

  print('');
  print('Para iniciar el servidor:  ' + bold('npm start'));
  print('Para reconfigurar:         ' + bold('npm run setup'));
  print('');

  if (!collectionsOk) {
    warn('La conexion no fue verificada completamente. Revisa URL, credenciales y red.');
  }

  rl.close();
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write('\nError fatal en el wizard: ' + msg + '\n');
  rl.close();
  process.exit(1);
});
