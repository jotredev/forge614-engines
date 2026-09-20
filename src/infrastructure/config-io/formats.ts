import type { ConfigFormat } from "../../modules/agents/types";
import type { ConfigFormatIO } from "./config-format";
import { jsonConfigFormat } from "./json-format";
import { tomlConfigFormat } from "./toml-format";

export const configFormats: Record<ConfigFormat, ConfigFormatIO> = {
  json: jsonConfigFormat,
  toml: tomlConfigFormat,
};
