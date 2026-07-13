import { ENGINE_API_VERSION, type RoomEngine } from "@praser/roomba-core";
import { VimmRoomSource } from "./source.js";

export { VimmRoomSource } from "./source.js";

const engine: RoomEngine = {
  id: "vimm",
  name: "Vimm's Lair",
  apiVersion: ENGINE_API_VERSION,
  version: "1.0.0",
  create: (ctx) => new VimmRoomSource({ fetcher: ctx.fetcher }),
};

export default engine;
