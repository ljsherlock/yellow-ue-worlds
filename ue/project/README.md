# YellowWorld — minimal UE 5.7 project (Track D spike)

A deliberately tiny Unreal project whose only job is to de-risk the streaming +
control pipeline. One project serves both spikes:

- **Spike 1a** — package it and stream the level to a browser (Pixel Streaming 2).
- **Spike 1b** — drive `AWorldDirector` from our `rc-bridge` over Remote Control
  and watch the sun move in the stream.

## Layout

```
YellowWorld.uproject            plugins: PixelStreaming2, RemoteControl
Config/
  DefaultEngine.ini             default map = /Game/Maps/Spike; RC bind 0.0.0.0
  DefaultGame.ini               cook the Spike map
Source/
  YellowWorld.Target.cs         Game target
  YellowWorldEditor.Target.cs   Editor target (needed to run the map commandlet)
  YellowWorld/
    YellowWorld.Build.cs
    YellowWorld.{h,cpp}         primary game module
    WorldDirector.{h,cpp}       AActor with SetSkyState() exposed to Remote Control
Scripts/
  make_map.py                   headless level generator (no editor GUI)
```

## Why a Python map generator?

A `.umap` is a binary asset normally authored in the editor GUI. To stay
fully headless on a Linux GPU VM, `Scripts/make_map.py` builds the level via
the editor's Python commandlet — ground plane, sun, sky, the `WorldDirector`,
and a `PlayerStart`. That's why the binary map is `.gitignore`d: it's a build
artifact, regenerated each time.

## Build order (runs in the dev-5.7 container — scripts coming next)

1. Generate the level (uses the **editor** build, `-nullrhi`, no GUI):

   ```bash
   UnrealEditor-Cmd /project/YellowWorld.uproject \
     -run=pythonscript -script="Scripts/make_map.py" -unattended -nullrhi
   ```

2. Cook + package a Linux **Game** build (`RunUAT BuildCookRun ... -platform=Linux`).

3. Run it headless with Pixel Streaming 2:

   ```bash
   ./YellowWorld.sh -RenderOffscreen -AudioMixer \
     -PixelStreamingSignallingURL=ws://127.0.0.1:8888
   ```

   Add `-RCWebControlEnable` for Spike 1b so the brain can reach Remote Control
   (HTTP 30010 / WS 30020).

> Status: **unverified until it cooks in the container.** I can't compile UE
> from here, so treat the C++/ini as a first draft to validate on the VM. The
> two most likely fix-ups: the exact Python API names in `make_map.py`, and any
> missing module dependency surfaced by the first build.

## Remote Control call (Spike 1b preview)

Once running with `-RCWebControlEnable`, the brain calls `SetSkyState` by object
path, e.g.:

```
PUT http://<VM_IP>:30010/remote/object/call
{
  "objectPath": "/Game/Maps/Spike.Spike:PersistentLevel.WorldDirector_0",
  "functionName": "SetSkyState",
  "parameters": { "SunPitchDegrees": 10.0, "CloudCover": 0.6, "FogDensity": 0.05 }
}
```
