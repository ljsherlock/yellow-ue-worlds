#!/usr/bin/env node
/**
 * rc-bridge CLI — drive a live Unreal world over Remote Control.
 *
 * Prereqs: UE running with -RCWebControlEnable on the VM, and an SSH tunnel so
 * 30010 is reachable locally:
 *     (from ue/)   npm run ue:run:rc   &&   npm run ue:rc-tunnel
 *
 * Examples (from packages/rc-bridge/):
 *   pnpm cli -- ping
 *   pnpm cli -- preset --name sunset
 *   pnpm cli -- time --hours 18
 *   pnpm cli -- fog --density 0.05 --falloff 0.2
 *   pnpm cli -- cloud --coverage 0.8
 *   pnpm cli -- camera --view aerial
 *   pnpm cli -- ground --r 0.3 --g 0.35 --b 0.18
 *   pnpm cli -- call --fn SetColorGrade --params '{"WhiteTemp":3200,"Saturation":1.2,"Contrast":1.05}'
 *
 * Overrides:  --url http://127.0.0.1:30010   --path <UObject path>
 *             (or env RC_BASE_URL / RC_OBJECT_PATH)
 */
import type { RCResponse } from "./contract.js";
import { HttpRCBridge } from "./http.js";
import { WORLD_DIRECTOR_PATH } from "./mapping.js";

// pnpm/npm may forward a literal `--` separator; drop a leading one.
const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
const cmd = argv[0];

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
function num(name: string, def: number): number {
  const v = flag(name);
  if (v === undefined) return def;
  const n = Number(v);
  if (Number.isNaN(n)) {
    console.error(`Invalid number for ${name}: ${v}`);
    process.exit(2);
  }
  return n;
}
function str(name: string, def: string): string {
  return flag(name) ?? def;
}

const baseUrl =
  flag("--url") ?? process.env.RC_BASE_URL ?? "http://127.0.0.1:30010";
const objectPath =
  flag("--path") ?? process.env.RC_OBJECT_PATH ?? WORLD_DIRECTOR_PATH;

function report(res: RCResponse): never {
  const tag = res.ok ? "OK" : "FAIL";
  console.log(
    `[${tag}] ${res.wire.method} ${res.wire.url}  ${res.httpStatus} (${res.latencyMs}ms)`,
  );
  console.log(`  body: ${JSON.stringify(res.wire.body)}`);
  if (res.ok) {
    console.log(`  returnValue: ${JSON.stringify(res.returnValue)}`);
  } else {
    console.log(`  error: ${res.error}`);
  }
  process.exit(res.ok ? 0 : 1);
}

function usage(): never {
  console.error(
    [
      "usage: rc-bridge <command> [flags]",
      "",
      "connectivity:",
      "  ping                                   GET /remote/info",
      "",
      "atmosphere & framing (Tier 1):",
      "  preset   --name <clear|cloudy|storm|sunset|night|dusty|misty>",
      "  time     --hours <0..24>",
      "  sun      [--lux 100000] [--kelvin 6500]",
      "  skylight --intensity <n>",
      "  fog      [--density 0.02] [--falloff 0.2]",
      "  fogcolor --r <0..1> --g <0..1> --b <0..1>",
      "  vfog     --on | --off",
      "  cloud    --coverage <0..1>",
      "  wind     [--dir 0] [--strength 0.5] [--speed 0.1]",
      "  ground   --r <0..1> --g <0..1> --b <0..1>",
      "  exposure --ev <bias>",
      "  grade    [--kelvin 6500] [--sat 1.0] [--contrast 1.0]",
      "  camera   --view <aerial|ground|wide|closeup|default>",
      "  fov      --deg <degrees>",
      "",
      "escape hatch:",
      "  sky      [--pitch -35] [--cloud 0.2] [--fog 0.02]   (back-compat SetSkyState)",
      "  call     --fn <Name> [--params '<json>']            any BlueprintCallable fn",
      "",
      "global flags:  --url <baseUrl>   --path <UObject path>",
    ].join("\n"),
  );
  process.exit(2);
}

async function main() {
  const bridge = new HttpRCBridge({ baseUrl });
  const call = (functionName: string, parameters: Record<string, unknown>) =>
    bridge.callFunction({ objectPath, functionName, parameters });

  switch (cmd) {
    case "ping": {
      try {
        const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/remote/info`);
        const body = await res.text();
        console.log(
          `[${res.ok ? "OK" : "FAIL"}] GET ${baseUrl}/remote/info  ${res.status}`,
        );
        console.log(body.slice(0, 400));
        process.exit(res.ok ? 0 : 1);
      } catch (e) {
        console.error(
          `[FAIL] could not reach ${baseUrl}: ${e instanceof Error ? e.message : e}`,
        );
        console.error(
          "  Is UE running with -RCWebControlEnable, and the tunnel up (ue:rc-tunnel)?",
        );
        process.exit(1);
      }
      break;
    }

    case "preset":
      report(await call("SetWeatherPreset", { Preset: str("--name", "clear") }));
      break;
    case "time":
      report(await call("SetTimeOfDay", { Hours: num("--hours", 12) }));
      break;
    case "sun": {
      // Two independent setters; send whichever flags were provided (default both).
      const res = await call("SetSunIntensity", { Lux: num("--lux", 100000) });
      if (!res.ok) report(res);
      report(await call("SetSunTemperature", { Kelvin: num("--kelvin", 6500) }));
      break;
    }
    case "skylight":
      report(await call("SetSkyLightIntensity", { Intensity: num("--intensity", 1) }));
      break;
    case "fog":
      report(
        await call("SetFog", {
          Density: num("--density", 0.02),
          HeightFalloff: num("--falloff", 0.2),
        }),
      );
      break;
    case "fogcolor":
      report(
        await call("SetFogColor", {
          R: num("--r", 0.5),
          G: num("--g", 0.5),
          B: num("--b", 0.5),
        }),
      );
      break;
    case "vfog":
      report(
        await call("SetVolumetricFog", {
          bEnabled: argv.includes("--off") ? false : true,
        }),
      );
      break;
    case "cloud":
      report(await call("SetCloudiness", { Coverage: num("--coverage", 0.5) }));
      break;
    case "wind":
      report(
        await call("SetWind", {
          DirectionDegrees: num("--dir", 0),
          Strength: num("--strength", 0.5),
          Speed: num("--speed", 0.1),
        }),
      );
      break;
    case "ground":
      report(
        await call("SetGroundColor", {
          R: num("--r", 0.52),
          G: num("--g", 0.42),
          B: num("--b", 0.26),
        }),
      );
      break;
    case "exposure":
      report(await call("SetExposure", { ExposureBias: num("--ev", 0) }));
      break;
    case "grade":
      report(
        await call("SetColorGrade", {
          WhiteTemp: num("--kelvin", 6500),
          Saturation: num("--sat", 1),
          Contrast: num("--contrast", 1),
        }),
      );
      break;
    case "camera":
      report(await call("SetCameraView", { Preset: str("--view", "default") }));
      break;
    case "fov":
      report(await call("SetCameraFOV", { FOV: num("--deg", 90) }));
      break;

    case "sky":
      report(
        await call("SetSkyState", {
          SunPitchDegrees: num("--pitch", -35),
          CloudCover: num("--cloud", 0.2),
          FogDensity: num("--fog", 0.02),
        }),
      );
      break;
    case "call": {
      const functionName = flag("--fn");
      if (!functionName) {
        console.error("call requires --fn <FunctionName>");
        process.exit(2);
      }
      let parameters: Record<string, unknown> = {};
      const raw = flag("--params");
      if (raw) {
        try {
          parameters = JSON.parse(raw);
        } catch (e) {
          console.error(
            `--params is not valid JSON: ${e instanceof Error ? e.message : e}`,
          );
          process.exit(2);
        }
      }
      report(await call(functionName, parameters));
      break;
    }

    default:
      usage();
  }
}

main();
