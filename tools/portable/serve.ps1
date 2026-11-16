# ARCHMAGE launcher: serves the "game" folder next to this script on a local port and opens it in
# the default browser. Nothing is installed and nothing is reachable from other machines (loopback only).
# The game is a static site, but browsers refuse to load its modules from a file:// path, hence this.
param([int]$Port = 5199, [switch]$NoBrowser)

$root = Join-Path $PSScriptRoot 'game'
if (-not (Test-Path (Join-Path $root 'index.html'))) { Write-Host "Cannot find the game folder at $root"; exit 1 }

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public static class ArchmageServer {
  static string root;
  static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
    { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".mjs", "text/javascript; charset=utf-8" },
    { ".css", "text/css; charset=utf-8" }, { ".json", "application/json" }, { ".wasm", "application/wasm" },
    { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".png", "image/png" }, { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
    { ".mp3", "audio/mpeg" }, { ".ogg", "audio/ogg" }, { ".wav", "audio/wav" }, { ".glb", "model/gltf-binary" },
    { ".hdr", "application/octet-stream" }, { ".md", "text/plain; charset=utf-8" }, { ".txt", "text/plain; charset=utf-8" }
  };

  // returns the port it is listening on, or -1
  public static int Start(string rootDir, int port) {
    root = Path.GetFullPath(rootDir).TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
    TcpListener listener = null; int p = port;
    for (; p < port + 30; p++) {
      try { listener = new TcpListener(IPAddress.Loopback, p); listener.Start(256); break; }
      catch (SocketException) { listener = null; }
    }
    if (listener == null) return -1;
    TcpListener l = listener;
    Thread t = new Thread(delegate() {
      while (true) {
        try { TcpClient c = l.AcceptTcpClient(); ThreadPool.QueueUserWorkItem(delegate(object o) { Handle((TcpClient)o); }, c); }
        catch { }
      }
    });
    t.IsBackground = true; t.Start();
    return p;
  }

  static void Send(NetworkStream s, string status, string type, byte[] body, string extra, bool headOnly) {
    string h = "HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + (body == null ? 0 : body.Length) +
               "\r\nCache-Control: no-cache\r\nConnection: close\r\n" + extra + "\r\n";
    byte[] hb = Encoding.ASCII.GetBytes(h);
    s.Write(hb, 0, hb.Length);
    if (body != null && !headOnly) s.Write(body, 0, body.Length);
    s.Flush();
  }

  static void Handle(TcpClient c) {
    try {
      using (c) {
        c.NoDelay = true;
        NetworkStream s = c.GetStream(); s.ReadTimeout = 15000; s.WriteTimeout = 120000;
        // read the request head
        byte[] buf = new byte[16384]; int n = 0; int end = -1;
        while (n < buf.Length) {
          int r = s.Read(buf, n, buf.Length - n); if (r <= 0) return; n += r;
          for (int i = 3; i < n; i++) if (buf[i] == 10 && buf[i - 1] == 13 && buf[i - 2] == 10 && buf[i - 3] == 13) { end = i; break; }
          if (end >= 0) break;
        }
        if (end < 0) return;
        string[] lines = Encoding.ASCII.GetString(buf, 0, end).Split(new string[] { "\r\n" }, StringSplitOptions.None);
        string[] parts = lines[0].Split(' ');
        if (parts.Length < 2) return;
        bool head = parts[0] == "HEAD";
        if (parts[0] != "GET" && !head) { Send(s, "405 Method Not Allowed", "text/plain", null, "", false); return; }
        string since = null;
        for (int i = 1; i < lines.Length; i++) if (lines[i].StartsWith("If-Modified-Since:", StringComparison.OrdinalIgnoreCase)) since = lines[i].Substring(18).Trim();
        string path = parts[1]; int q = path.IndexOf('?'); if (q >= 0) path = path.Substring(0, q);
        path = Uri.UnescapeDataString(path).Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        if (path.Length == 0) path = "index.html";
        string full = Path.GetFullPath(Path.Combine(root, path));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) {
          Send(s, "404 Not Found", "text/plain", Encoding.ASCII.GetBytes("not found"), "", head); return;
        }
        string stamp = File.GetLastWriteTimeUtc(full).ToString("R");
        if (since != null && since == stamp) { Send(s, "304 Not Modified", "text/plain", null, "Last-Modified: " + stamp + "\r\n", true); return; }
        string type; if (!Mime.TryGetValue(Path.GetExtension(full), out type)) type = "application/octet-stream";
        Send(s, "200 OK", type, File.ReadAllBytes(full), "Last-Modified: " + stamp + "\r\n", head);
      }
    } catch { }
  }
}
'@

$port = [ArchmageServer]::Start($root, $Port)
if ($port -lt 0) { Write-Host 'Could not open a local port for the game.'; exit 1 }
$url = "http://127.0.0.1:$port/"
Write-Host ''
Write-Host '  ARCHMAGE - Tenth Circle'
Write-Host "  running at $url"
Write-Host ''
Write-Host '  Keep this window open while you play. Close it to stop.'
Write-Host '  First load takes a few seconds (about 150 MB of textures and sounds).'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }
while ($true) { Start-Sleep -Seconds 3600 }
