ARCHMAGE - Tenth Circle
=======================

HOW TO PLAY (Windows)
  Double-click "Play Archmage.bat".
  A small window opens and your browser loads the game. Keep that window open while you play;
  close it to stop. If Windows asks whether to run a file from the network, choose Run.

  Use Chrome or Edge on a PC with a real graphics card. Click ENTER THE SANCTUM once it has loaded.

HOW TO PLAY (Mac / Linux, or if the .bat is blocked)
  Open a terminal in the "game" folder and run:   python3 -m http.server 5199
  then open http://127.0.0.1:5199/ in Chrome.

WHY A LAUNCHER
  The game is a plain web page, but browsers refuse to load it straight from a file, so the launcher
  serves the "game" folder to your own machine only (127.0.0.1). Nothing is installed.
  For a faster first load, copy the whole Archmage folder to a local disk and run it from there.

CONTROLS
  WASD / Shift / mouse   move, sprint, look
  Left mouse             cast the selected skill (hold to charge or channel)
  1 - 0                  choose a skill, Tab = second grimoire page, wheel cycles
  F                      Force Blast
  Right mouse or E       Telekinesis: hold to grab, release to hurl
  Q                      Cataclysm (charges as you destroy)
  G                      Blink to where you are looking
  V                      Skywalk: fly (Space / C to rise and sink, Shift to go fast)
  R                      rebuild the realm        H  hide the HUD
  B                      camera feel: steady (default, no motion blur) or cinematic

THINGS TO TRY
  - Fly north-east (V) to the Greywater dam and cut it open with the Annihilation Ray (key 5).
    The reservoir floods the valley and the capital's riverside quarter.
  - Tab, then 3: Deluge. Cast it on the lake next to Mirrormere, or on a town.
  - Winter's Grasp (9) on running water. Restoration (Tab, 0) puts everything back.

OPTIONS (add to the address)
  ?q=low        lower quality for slower machines        ?free   Cataclysm always charged
  ?mute         no sound                                 ?demo   watch the scripted showcase

The camera is steady by default (no motion blur, light shake). Press B for the cinematic camera.
If the frame rate is low the game lowers its resolution by itself; ?q=low helps further.
