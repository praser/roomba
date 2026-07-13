/** Fetches the latest version and installs an update. Injected for testability. */
export interface Updater {
  /** Return the latest published version string for a package. */
  latest(pkg: string): Promise<string>;
  /** Install a package spec (e.g. "@praser/roomba@latest") globally. */
  install(spec: string): Promise<void>;
}

/**
 * Update the CLI to its latest published version. Compares the running
 * version against the latest and only installs when they differ.
 */
export async function updateCli(
  pkg: string,
  current: string,
  updater: Updater,
  log: (message: string) => void = console.log,
): Promise<void> {
  const latest = (await updater.latest(pkg)).trim();
  if (!latest) {
    throw new Error(`Could not determine the latest version of ${pkg}.`);
  }
  if (latest === current) {
    log(`roomba is already up to date (${current}).`);
    return;
  }
  log(`Updating roomba ${current} → ${latest} …`);
  await updater.install(`${pkg}@latest`);
  log(`Updated to ${latest}. Run \`roomba --version\` to confirm.`);
}
