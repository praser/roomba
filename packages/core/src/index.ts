export const VERSION = "0.0.0";

export interface Console {
  /** Human-readable console name, e.g. "PlayStation 2". */
  name: string;
  /** Stable, unique identifier used to resolve a console to a source URL, e.g. "PS2". */
  alias: string;
}

export interface RoomSource {
  id: string;
  baseURL: URL;
  /** List every console this source offers. */
  loadConsoles: () => Promise<Console[]>;
  /** Resolve a console alias to this source's URL for it. */
  resolve: (alias: string) => URL;
}