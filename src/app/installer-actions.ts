/** Acciones de actualización y desinstalación mediante el instalador común. */
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import pkg from "../../package.json";

const REPOSITORY = "jotredev/forge614-engines";

/** Error estable de las acciones del instalador. */
export class InstallerActionError extends Error {
  /** Código estable para la envoltura de error JSON. */
  readonly code: string;
  /** Crea el error visible por CLI. */
  constructor(code: string, message: string) { super(message); this.name = "InstallerActionError"; this.code = code; }
}

/** Dependencias sustituibles para las pruebas aisladas del instalador. */
export interface InstallerActionOptions {
  /** Entorno de la acción. */
  env?: Record<string, string | undefined>;
  /** Descargador de activos. */
  fetcher?: typeof fetch;
  /** Directorio de trabajo para proteger la carpeta que se borraría. */
  cwd?: string;
}

/** Resuelve y valida la carpeta común de Forge614. */
function forgeHome(env: Record<string, string | undefined>): string {
  const configured = env.FORGE614_HOME ?? join(env.HOME ?? env.USERPROFILE ?? homedir(), ".forge614");
  if (!configured || !isAbsolute(configured)) throw new InstallerActionError("INVALID_FORGE614_HOME", "FORGE614_HOME debe ser una ruta absoluta.");
  return configured;
}

/** Merges child environments and collapses Windows PATH aliases into one key. */
function childEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const entries = Object.entries({ ...process.env, ...env }).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (process.platform !== "win32") return Object.fromEntries(entries);
  const path = entries.find(([key]) => key.toLocaleLowerCase("en-US") === "path")?.[1];
  const withoutAliases = entries.filter(([key]) => key.toLocaleLowerCase("en-US") !== "path");
  if (path !== undefined) withoutAliases.push(["Path", path]);
  return Object.fromEntries(withoutAliases);
}

/** Detecta nodos dependientes instalados en la carpeta compartida. */
export function detectInstalledDependents(env: Record<string, string | undefined> = process.env): string[] {
  const root = forgeHome(env);
  const found: string[] = [];
  for (const node of ["shell", "workers", "atlas", "engram"]) {
    const directory = join(root, node);
    if (!existsSync(directory)) continue;
    const active = existsSync(join(directory, ".active-version"));
    const launcher = node === "engram"
      ? existsSync(join(directory, ".bin-dir"))
      : existsSync(join(directory, "bin", `forge614-${node}`)) || existsSync(join(directory, "bin", `forge614-${node}.exe`)) || existsSync(join(directory, "bin", `forge614-${node}.cmd`));
    if (active || launcher) found.push(node);
  }
  return found;
}

/** Replaces temporary or home paths in an error before it reaches stderr. */
function safeMessage(message: string, env: Record<string, string | undefined>): string {
  const paths = ["HOME", "USERPROFILE", "FORGE614_HOME", "TMP", "TMPDIR", "TEMP"].flatMap((key) => {
    const path = env[key];
    if (!path) return [];
    try { return [path, realpathSync.native(path)]; } catch { return [path]; }
  });
  try { paths.push(realpathSync.native(tmpdir())); } catch { paths.push(tmpdir()); }
  const insensitive = process.platform === "win32";
  return [...new Set(paths)].sort((a, b) => b.length - a.length).reduce((text, path) => {
    if (!insensitive) return text.split(path).join("<ruta>");
    const lower = text.toLocaleLowerCase("en-US");
    const needle = path.toLocaleLowerCase("en-US");
    let cursor = 0;
    let output = "";
    while (true) {
      const index = lower.indexOf(needle, cursor);
      if (index < 0) return output + text.slice(cursor);
      output += text.slice(cursor, index) + "<ruta>";
      cursor = index + path.length;
    }
  }, message);
}

/** Returns the loopback test server when explicitly configured. */
function testBase(env: Record<string, string | undefined>, code = "UPDATE_FAILED"): string | undefined {
  const raw = env.FORGE614_INSTALL_TEST_BASE_URL;
  if (!raw) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { throw new InstallerActionError(code, "FORGE614_INSTALL_TEST_BASE_URL solo acepta HTTP loopback."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "::1"].includes(url.hostname) || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new InstallerActionError(code, "FORGE614_INSTALL_TEST_BASE_URL solo acepta HTTP loopback.");
  }
  return url.origin;
}

/** Builds a release asset URL without permitting a user-supplied remote test host. */
function assetUrl(base: string | undefined, tag: string, file: string): string {
  return base ? `${base}/repos/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${file}` : `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${file}`;
}

/** Resolves a release tag and rejects malformed GitHub responses. */
async function resolveTag(base: string | undefined, fetcher: typeof fetch, version?: string, failureCode = "UPDATE_FAILED"): Promise<string> {
  if (version) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new InstallerActionError("INVALID_VERSION", "La versión debe tener el formato X.Y.Z.");
    return `v${version}`;
  }
  let response: Response;
  try { response = await fetcher(base ? `${base}/repos/${REPOSITORY}/releases/latest` : `https://api.github.com/repos/${REPOSITORY}/releases/latest`); }
  catch (error) { throw new InstallerActionError(failureCode, error instanceof Error ? error.message : "No se pudo consultar la publicación."); }
  if (!response.ok) throw new InstallerActionError(failureCode, `No se pudo consultar la última versión (HTTP ${response.status}).`);
  const tag = (await response.json() as { tag_name?: unknown }).tag_name;
  if (typeof tag !== "string" || !/^v?\d+\.\d+\.\d+$/.test(tag)) throw new InstallerActionError(failureCode, "La publicación devolvió una etiqueta inválida.");
  return `v${tag.replace(/^v/, "")}`;
}

/** Confirms exactly one strict GNU manifest entry and its SHA-256 digest. */
function verifyChecksum(name: string, bytes: Uint8Array, sums: string, code = "UPDATE_FAILED"): void {
  const lines = sums.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const entries = lines.map((line) => /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line));
  if (!entries.length || entries.some((entry) => entry === null)) throw new InstallerActionError(code, "SHA256SUMS no usa el formato GNU estricto.");
  const matches = entries.filter((entry) => entry?.[2] === name);
  if (matches.length !== 1 || !matches[0]?.[1] || createHash("sha256").update(bytes).digest("hex") !== matches[0][1]) {
    throw new InstallerActionError(code, `La huella de ${name} no coincide con SHA256SUMS.`);
  }
}

/** Moves the running Windows executable out of the directory being replaced. */
function parkWindowsLauncher(action: "update" | "uninstall", env: Record<string, string | undefined>): { original: string; parked: string } | undefined {
  if (process.platform !== "win32") return undefined;
  const original = join(forgeHome(env), "engines", "bin", "forge614-engines.exe");
  if (!existsSync(original)) return undefined;
  const parked = action === "update" ? `${original}.old-${randomUUID()}` : join(forgeHome(env), `.forge614-engines-old-${randomUUID()}.exe`);
  renameSync(original, parked);
  return { original, parked };
}

/** Removes stale Windows launchers left by a prior update or uninstall. */
function cleanupStaleWindowsLaunchers(env: Record<string, string | undefined>): void {
  if (process.platform !== "win32") return;
  for (const directory of [join(forgeHome(env), "engines", "bin"), forgeHome(env)]) {
    let names: string[];
    try { names = readdirSync(directory); } catch { continue; }
    for (const name of names) {
      if (/^forge614-engines\.exe\.old-.+$/i.test(name) || /^\.forge614-engines-old-.+\.exe$/i.test(name)) {
        try { rmSync(join(directory, name), { force: true }); } catch { /* Stale files are best-effort cleanup. */ }
      }
    }
  }
}

/** Schedules removal of the parked executable with WMI after this process exits. */
function scheduleWindowsRemoval(file: string): void {
  const file64 = Buffer.from(file, "utf8").toString("base64");
  const script = `$file=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${file64}'));try{Wait-Process -Id ${process.pid} -Timeout 30 -ErrorAction SilentlyContinue}catch{};for($i=0;$i -lt 30;$i++){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue;if(-not(Test-Path -LiteralPath $file)){break};Start-Sleep -Milliseconds 250}`;
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  const commandLine = `"$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -NonInteractive -EncodedCommand ${encodedScript}`;
  const command64 = Buffer.from(commandLine, "utf8").toString("base64");
  const create = `$line=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${command64}'));$result=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$line};if($result.ReturnValue -ne 0){exit 1}`;
  const encodedCreate = Buffer.from(create, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-NonInteractive", "-EncodedCommand", encodedCreate], { stdio: "ignore", windowsHide: true, timeout: 10_000 });
  if (result.status !== 0) throw new Error(`WMI did not schedule deletion of ${file}`);
}

/** Downloads, verifies and runs the shared installer for a resolved tag. */
async function runGatekeeper(action: "update" | "uninstall", env: Record<string, string | undefined>, fetcher: typeof fetch, tag: string): Promise<void> {
  const code = `${action.toUpperCase()}_FAILED`;
  const base = testBase(env, code);
  const windows = process.platform === "win32";
  const installerName = windows ? "install.ps1" : "install.sh";
  let response: Response;
  try { response = await fetcher(assetUrl(base, tag, installerName)); }
  catch (error) { throw new InstallerActionError(`${action.toUpperCase()}_FAILED`, safeMessage(error instanceof Error ? error.message : "No se pudo descargar el portero.", env)); }
  if (!response.ok) throw new InstallerActionError(`${action.toUpperCase()}_FAILED`, `No se pudo descargar ${installerName} (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let sums: Response;
  try { sums = await fetcher(assetUrl(base, tag, "SHA256SUMS")); }
  catch (error) { throw new InstallerActionError(`${action.toUpperCase()}_FAILED`, safeMessage(error instanceof Error ? error.message : "No se pudo descargar SHA256SUMS.", env)); }
  if (!sums.ok) throw new InstallerActionError(`${action.toUpperCase()}_FAILED`, `No se pudo descargar SHA256SUMS (${sums.status}).`);
  verifyChecksum(installerName, bytes, await sums.text(), code);
  const temp = mkdtempSync(join(tmpdir(), "forge614-engines-installer-"));
  const file = join(temp, installerName);
  try {
    writeFileSync(file, bytes, { mode: 0o600 });
    if (!windows) chmodSync(file, 0o700);
    const envForChild = childEnvironment(env);
    const args = action === "update" ? ["--version", tag] : ["--uninstall"];
    const command = windows ? "powershell.exe" : "sh";
    const parked = parkWindowsLauncher(action, env);
    try {
      const result = spawnSync(command, windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args] : [file, ...args], { env: envForChild, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      if (result.error || result.status !== 0) throw new InstallerActionError(`${action.toUpperCase()}_FAILED`, safeMessage((result.stderr || result.error?.message || "El instalador terminó con error.").trim(), env));
      if (action === "uninstall" && parked) {
        try { scheduleWindowsRemoval(parked.parked); }
        catch {
          const english = (env.FORGE614_LOCALE ?? process.env.FORGE614_LOCALE ?? "es").toLowerCase().startsWith("en");
          const warning = english
            ? `Warning: deferred deletion could not be scheduled for ${parked.parked}. Remove it after Engines exits.`
            : `Aviso: no se pudo programar el borrado de ${parked.parked}. Elimínalo cuando cierre Engines.`;
          process.stderr.write(`${warning}\n`);
        }
      }
    } catch (error) {
      if (parked && existsSync(parked.parked) && !existsSync(parked.original)) renameSync(parked.parked, parked.original);
      throw error;
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

/** Updates Engines and reads the installed launcher version after installation. */
export async function updateEngines(version?: string, options: InstallerActionOptions = {}): Promise<{ updated: boolean; currentVersion: string; latestVersion: string; installedVersion: string; note: string }> {
  const env = options.env ?? process.env;
  cleanupStaleWindowsLaunchers(env);
  const fetcher = options.fetcher ?? fetch;
  const currentVersion = pkg.version;
  try {
    const tag = await resolveTag(testBase(env), fetcher, version);
    await runGatekeeper("update", env, fetcher, tag);
    const root = forgeHome(env);
    const launcher = join(root, "engines", "bin", `forge614-engines${process.platform === "win32" ? ".exe" : ""}`);
    let installedVersion = currentVersion;
    const output = execFileSync(launcher, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const match = /^forge614-engines (\d+\.\d+\.\d+)$/.exec(output);
    if (!match?.[1]) throw new Error("El lanzador devolvió una versión inválida.");
    installedVersion = match[1];
    const latestVersion = tag.slice(1);
    return { updated: installedVersion !== currentVersion, currentVersion, latestVersion, installedVersion, note: "La actualización se completó con el instalador común." };
  } catch (error) {
    if (error instanceof InstallerActionError) throw new InstallerActionError(error.code, safeMessage(error.message, env));
    throw new InstallerActionError("UPDATE_FAILED", safeMessage(error instanceof Error ? error.message : String(error), env));
  }
}

/** Checks the working directory and dependent nodes before any uninstall side effect. */
export function assertUninstallAllowed(options: InstallerActionOptions & { force?: boolean } = {}): string[] {
  const env = options.env ?? process.env;
  const root = forgeHome(env);
  const directory = join(root, "engines");
  const cwd = options.cwd ?? process.cwd();
  try {
    const realRoot = realpathSync.native(directory);
    const realCwd = realpathSync.native(cwd);
    const rel = relative(realRoot, realCwd);
    if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) throw new InstallerActionError("UNINSTALL_FROM_INSTALLATION", "Sal de la carpeta de Engines antes de desinstalarlo.");
  } catch (error) {
    if (error instanceof InstallerActionError) throw error;
    if (existsSync(directory)) throw new InstallerActionError("UNINSTALL_FAILED", "No se pudo verificar el directorio actual antes de desinstalar.");
  }
  const dependents = detectInstalledDependents(env);
  if (dependents.length && !options.force) throw new InstallerActionError("DEPENDENT_NODES_INSTALLED", `No se puede retirar Engines mientras estén instalados: ${dependents.join(", ")}. Usa --force para continuar.`);
  return dependents;
}

/** Removes the Engines installation after checking dependencies and working directory. */
export async function uninstallEngines(options: InstallerActionOptions & { force?: boolean } = {}): Promise<{ removed: true; dependents: string[] }> {
  const env = options.env ?? process.env;
  cleanupStaleWindowsLaunchers(env);
  const root = forgeHome(env);
  const directory = join(root, "engines");
  const dependents = assertUninstallAllowed(options);
  const fetcher = options.fetcher ?? fetch;
  try {
    const tag = await resolveTag(testBase(env, "UNINSTALL_FAILED"), fetcher, undefined, "UNINSTALL_FAILED");
    await runGatekeeper("uninstall", env, fetcher, tag);
    if (existsSync(directory)) throw new InstallerActionError("UNINSTALL_FAILED", "No se pudo retirar la carpeta de Engines.");
    return { removed: true, dependents };
  } catch (error) {
    if (error instanceof InstallerActionError) throw new InstallerActionError(error.code, safeMessage(error.message, env));
    throw new InstallerActionError("UNINSTALL_FAILED", safeMessage(error instanceof Error ? error.message : String(error), env));
  }
}
