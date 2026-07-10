import { URL } from "node:url";
import { parse } from "node-html-parser";
import type { Console, RoomSource } from "@roomba/core";

export const VIMM_BASE_URL = "https://vimm.net";

/**
 * Data source backed by Vimm's Lair (https://vimm.net).
 */
export class VimmRoomSource implements RoomSource {
  readonly id = "vimm";
  readonly baseURL

  constructor(baseURL: string = VIMM_BASE_URL) {
    this.baseURL = new URL(baseURL);
  }

  /** Build the vault URL for a console alias (e.g. "PS2" -> https://vimm.net/vault/PS2). */
  resolve(alias: string): URL {
    return new URL(`/vault/${alias}`, this.baseURL);
  }

  async loadConsoles(): Promise<Console[]> {
    const vaultUrl = new URL("/vault", this.baseURL);

    const response = await fetch(vaultUrl, {
      headers: { "user-agent": "roomba (+https://vimm.net)" },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${vaultUrl.href}: ${response.status} ${response.statusText}`,
      );
    }

    const root = parse(await response.text());
    const subMenu = root.querySelector("#subMenu");
    if (!subMenu) {
      throw new Error(`Could not find #subMenu at ${vaultUrl.href}`);
    }

    return subMenu.querySelectorAll("a").flatMap((anchor) => {
      const href = anchor.getAttribute("href");
      const name = anchor.text.trim();
      if (!href || !name) return [];
      // On Vimm the vault slug (last path segment) is the console's alias.
      const alias = new URL(href, this.baseURL).pathname.split("/").filter(Boolean).pop();
      if (!alias) return [];
      return [{ name, alias }];
    });
  }
}
